import { basename, dirname } from 'path';
import { extractWikilinks, pageAliases, linkTargetAliases } from './wikilinks';
import { isSystemPage, toPageId, WIKI_CATEGORIES } from './vault';
import type { WikiPage } from './vault';
import {
  computeEdgeWeight,
  cosineSimilarity,
  jaccardSimilarity,
  sparsifyEdgesTopK,
  tfNormSquared,
} from './graph-weights';
import { analyzeGraph, normalizePageRank } from './graph-analysis';
import type { GraphNode, GraphEdge } from '../../shared/api.types';
import type { SearchIndex } from './search-index';

export interface GraphBuildResult {
  nodes: GraphNode[];
  /** k-NN-sparsifizierte Kanten fuer die Darstellung (identisch zu wiki:get-graph-data). */
  edges: GraphEdge[];
  /** Vollstaendige Kantenliste (vor Sparsifizierung). */
  allEdges: GraphEdge[];
  /** id -> Roh-Seiteninhalt (Frontmatter + Body). */
  bodies: Map<string, string>;
  /** Ziel-id -> Liste der verlinkenden Quell-ids (Reverse-Index / Backlinks). */
  backlinks: Map<string, string[]>;
}

/**
 * Zentraler Graph-Aufbau: gewichtete Kanten (Reziprozitaet + Tag-Jaccard +
 * Content-Cosine), Louvain-Communities und normalisierter PageRank. Wird von
 * wiki:get-graph-data UND vom HTML-Export geteilt, damit beide nie divergieren.
 */
export function buildGraphData(allPages: WikiPage[], index: SearchIndex): GraphBuildResult {
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
    const group = ((WIKI_CATEGORIES as readonly string[]).includes(dir) ? dir : 'other') as GraphNode['group'];

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
    for (const link of extractWikilinks(content)) {
      let targetId: string | undefined;
      for (const alias of linkTargetAliases(link.target)) {
        targetId = aliasToId.get(alias);
        if (targetId) break;
      }
      if (!targetId || targetId === sourceId) continue;
      directed.add(`${sourceId}|${targetId}`);
    }
  }

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
    if (!existing) pairSignals.set(orderedKey, { source, target, reciprocal });
    else if (reciprocal) existing.reciprocal = true;
  }

  const edges: GraphEdge[] = [];
  for (const { source, target, reciprocal } of pairSignals.values()) {
    const tagSim = jaccardSimilarity(nodeTags.get(source) || [], nodeTags.get(target) || []);
    const a = getIndexLookup(source);
    const b = getIndexLookup(target);
    const contentSim = a && b ? cosineSimilarity(a.tf, b.tf, a.normSquared, b.normSquared) : 0;
    const weight = computeEdgeWeight({ reciprocal, tagJaccard: tagSim, contentSim });
    edges.push({ source, target, weight, reciprocal, tagSimilarity: tagSim, contentSimilarity: contentSim });
  }

  for (const edge of edges) {
    const src = nodeMap.get(edge.source);
    const tgt = nodeMap.get(edge.target);
    if (src) src.degree++;
    if (tgt) tgt.degree++;
  }

  const analysis = analyzeGraph({
    nodeIds: Array.from(nodeMap.keys()),
    edges: edges.map((e) => ({ source: e.source, target: e.target, weight: e.weight })),
  });
  const normalizedRank = normalizePageRank(analysis.pagerank);
  for (const [id, node] of nodeMap) {
    node.community = analysis.communities.get(id) ?? -1;
    node.pagerank = normalizedRank.get(id) ?? 0;
  }

  const backlinks = new Map<string, string[]>();
  for (const key of directed) {
    const [s, t] = key.split('|');
    const list = backlinks.get(t) || [];
    list.push(s);
    backlinks.set(t, list);
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges: sparsifyEdgesTopK(edges, 5),
    allEdges: edges,
    bodies: pageContents,
    backlinks,
  };
}
