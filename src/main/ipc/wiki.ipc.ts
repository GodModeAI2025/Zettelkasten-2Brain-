import { ipcMain } from 'electron';
import { readFile } from 'fs/promises';
import { join, basename, dirname } from 'path';
import { ProjectService } from '../services/project.service';
import { extractWikilinks, pageAliases, linkTargetAliases } from '../core/wikilinks';
import { isSystemPage, toPageId, updateFrontmatter, today } from '../core/vault';
import {
  computeEdgeWeight,
  cosineSimilarity,
  jaccardSimilarity,
  sparsifyEdgesTopK,
  tfNormSquared,
} from '../core/graph-weights';
import { analyzeGraph, normalizePageRank } from '../core/graph-analysis';
import type { GraphNode, GraphEdge, GraphData } from '../../shared/api.types';

export function registerWikiHandlers(): void {
  ipcMain.handle('wiki:list-pages', async (_event, projectName: string, subdir?: string) => {
    const vault = ProjectService.getVault(projectName);
    return vault.listWikiPages(subdir);
  });

  ipcMain.handle('wiki:read-page', async (_event, projectName: string, relativePath: string) => {
    const vault = ProjectService.getVault(projectName);
    return vault.readWikiPage(relativePath);
  });

  ipcMain.handle(
    'wiki:set-reviewed',
    async (_event, projectName: string, relativePath: string, reviewed: boolean) => {
      const vault = ProjectService.getVault(projectName);
      const page = await vault.readWikiPage(relativePath);
      const updated = updateFrontmatter(page.content, (fm) => {
        fm.reviewed = reviewed;
        fm.updated = today();
      });
      if (!updated) {
        throw new Error(`Seite "${relativePath}" hat kein Frontmatter.`);
      }
      const rel = relativePath.startsWith('wiki/') ? relativePath : join('wiki', relativePath);
      await vault.writeFile(rel, updated);
      await ProjectService.commitIfNeeded(
        projectName,
        `Review: ${rel} → reviewed=${reviewed}`,
      );
      return vault.readWikiPage(relativePath);
    },
  );

  ipcMain.handle('wiki:get-wikilink-map', async (_event, projectName: string) => {
    const vault = ProjectService.getVault(projectName);
    try {
      const content = await readFile(join(vault.wikiDir, '.wikilinks.json'), 'utf-8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  });

  ipcMain.handle('wiki:list-pending-stubs', async (_event, projectName: string) => {
    const vault = ProjectService.getVault(projectName);
    return vault.getPendingStubs();
  });

  ipcMain.handle('wiki:delete-pending-stub', async (_event, projectName: string, slug: string) => {
    const vault = ProjectService.getVault(projectName);
    await vault.removePendingStubs(new Set([
      // Slug kann als path (category/slug) oder als reiner slug kommen
      ...await vault.getPendingStubs()
        .then((stubs) => stubs.filter((s) => s.slug === slug).map((s) => s.path)),
    ]));
  });

  ipcMain.handle('wiki:get-graph-data', async (_event, projectName: string): Promise<GraphData> => {
    const vault = ProjectService.getVault(projectName);
    const allPages = await vault.loadAllWikiPages();

    const wikiPages = allPages.filter((p) => !isSystemPage(basename(p.relativePath, '.md')));

    const nodeMap = new Map<string, GraphNode>();
    const nodeTags = new Map<string, string[]>();
    const aliasToId = new Map<string, string>();
    const idToIndexKey = new Map<string, string>();
    const pageContents = new Map<string, string>();

    for (const page of wikiPages) {
      const id = toPageId(page.relativePath);
      const name = basename(id);
      const dir = dirname(id);
      const group = (['sources', 'entities', 'concepts', 'synthesis'].includes(dir) ? dir : 'other') as GraphNode['group'];

      let tags: string[] = [];
      if (Array.isArray(page.frontmatter.tags)) {
        tags = page.frontmatter.tags.map((t: unknown) => String(t).toLowerCase().trim()).filter(Boolean);
      }

      nodeMap.set(id, {
        id,
        label: name.replace(/-/g, ' '),
        group,
        tags,
        degree: 0,
        hasContent: true,
        community: 0,
        pagerank: 0,
      });
      nodeTags.set(id, tags);
      pageContents.set(id, page.content);
      idToIndexKey.set(id, page.relativePath);

      for (const alias of pageAliases(id, name)) {
        aliasToId.set(alias, id);
      }
    }

    const directed = new Set<string>();
    for (const [sourceId, content] of pageContents) {
      const links = extractWikilinks(content);
      for (const link of links) {
        let targetId: string | undefined;
        for (const alias of linkTargetAliases(link.target)) {
          targetId = aliasToId.get(alias);
          if (targetId) break;
        }
        if (!targetId || targetId === sourceId) continue;
        directed.add(`${sourceId}|${targetId}`);
      }
    }

    const { index } = await vault.getSearchIndex(allPages);
    interface IndexLookup { tf: Record<string, number>; normSquared: number }
    const lookupCache = new Map<string, IndexLookup | null>();
    function getIndexLookup(id: string): IndexLookup | null {
      let cached = lookupCache.get(id);
      if (cached !== undefined) return cached;
      const key = idToIndexKey.get(id);
      const entry = key ? index.entries[key] : undefined;
      cached = entry ? { tf: entry.tf, normSquared: tfNormSquared(entry.tf) } : null;
      lookupCache.set(id, cached);
      return cached;
    }

    const pairSignals = new Map<string, { source: string; target: string; reciprocal: boolean }>();
    for (const directedKey of directed) {
      const [a, b] = directedKey.split('|');
      const [source, target] = a < b ? [a, b] : [b, a];
      const orderedKey = `${source}|${target}`;
      const reciprocal = directed.has(`${b}|${a}`);
      const existing = pairSignals.get(orderedKey);
      if (!existing) {
        pairSignals.set(orderedKey, { source, target, reciprocal });
      } else if (reciprocal) {
        existing.reciprocal = true;
      }
    }

    const edges: GraphEdge[] = [];
    for (const { source, target, reciprocal } of pairSignals.values()) {
      const tagSim = jaccardSimilarity(nodeTags.get(source) || [], nodeTags.get(target) || []);
      const a = getIndexLookup(source);
      const b = getIndexLookup(target);
      const contentSim = a && b
        ? cosineSimilarity(a.tf, b.tf, a.normSquared, b.normSquared)
        : 0;
      const weight = computeEdgeWeight({ reciprocal, tagJaccard: tagSim, contentSim });
      edges.push({
        source,
        target,
        weight,
        reciprocal,
        tagSimilarity: tagSim,
        contentSimilarity: contentSim,
      });
    }

    for (const edge of edges) {
      const src = nodeMap.get(edge.source);
      const tgt = nodeMap.get(edge.target);
      if (src) src.degree++;
      if (tgt) tgt.degree++;
    }

    // Analyse auf dem vollen Graphen — Community-Erkennung und PageRank
    // sollen alle Signale sehen, auch schwache.
    const analysis = analyzeGraph({
      nodeIds: Array.from(nodeMap.keys()),
      edges: edges.map((e) => ({ source: e.source, target: e.target, weight: e.weight })),
    });
    const normalizedRank = normalizePageRank(analysis.pagerank);
    for (const [id, node] of nodeMap) {
      node.community = analysis.communities.get(id) ?? -1;
      node.pagerank = normalizedRank.get(id) ?? 0;
    }

    // Rendering-Edges: k-NN-Sparsifizierung reduziert Linien drastisch,
    // ohne Cluster zu zerreissen. Jeder Knoten behaelt seine staerksten k.
    const visibleEdges = sparsifyEdgesTopK(edges, 5);

    return {
      nodes: Array.from(nodeMap.values()),
      edges: visibleEdges,
    };
  });
}
