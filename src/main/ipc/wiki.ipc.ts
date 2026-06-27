import { ipcMain } from 'electron';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { ProjectService } from '../services/project.service';
import { generateWikilinkMap, updateFrontmatter, updateIndexes } from '../core/vault';
import { applyWikiFrontmatterPatch } from '../core/wiki-frontmatter';
import { createWikiPageDraft } from '../core/wiki-page-draft';
import { buildWikiReviewQueue } from '../core/wiki-review';
import { buildGraphData } from '../core/graph-build';
import { findBacklinks } from '../core/wiki-relations';
import type { GraphData, WikiCreatePageInput, WikiFrontmatterPatch } from '../../shared/api.types';

export function registerWikiHandlers(): void {
  ipcMain.handle('wiki:list-pages', async (_event, projectName: string, subdir?: string) => {
    const vault = ProjectService.getVault(projectName);
    return vault.listWikiPages(subdir);
  });

  ipcMain.handle('wiki:read-page', async (_event, projectName: string, relativePath: string) => {
    const vault = ProjectService.getVault(projectName);
    return vault.readWikiPage(relativePath);
  });

  ipcMain.handle('wiki:create-page', async (_event, projectName: string, input: WikiCreatePageInput) => {
    const vault = ProjectService.getVault(projectName);
    const draft = createWikiPageDraft(input);
    const wikiRelativePath = join('wiki', draft.relativePath);

    if (await vault.fileExists(wikiRelativePath)) {
      throw new Error(`Wiki-Seite "${draft.relativePath}" existiert bereits.`);
    }

    await vault.writeFile(wikiRelativePath, draft.content);
    await vault.removePendingStubs(new Set([draft.stubPath]));
    await updateIndexes(vault.wikiDir);
    await generateWikilinkMap(vault.wikiDir);
    vault.clearSearchIndex();
    await ProjectService.commitIfNeeded(projectName, `Wiki-Seite angelegt: ${wikiRelativePath}`);

    return vault.readWikiPage(draft.relativePath);
  });

  ipcMain.handle(
    'wiki:set-reviewed',
    async (_event, projectName: string, relativePath: string, reviewed: boolean) => {
      const vault = ProjectService.getVault(projectName);
      const page = await vault.readWikiPage(relativePath);
      let changedFields: string[] = [];
      const updated = updateFrontmatter(page.content, (fm) => {
        changedFields = applyWikiFrontmatterPatch(fm, { reviewed });
      });
      if (!updated) {
        throw new Error(`Seite "${relativePath}" hat kein Frontmatter.`);
      }
      if (changedFields.length === 0) return page;
      const rel = relativePath.startsWith('wiki/') ? relativePath : join('wiki', relativePath);
      await vault.writeFile(rel, updated);
      await ProjectService.commitIfNeeded(
        projectName,
        `Review: ${rel} → reviewed=${reviewed}`,
      );
      return vault.readWikiPage(relativePath);
    },
  );

  ipcMain.handle(
    'wiki:update-frontmatter',
    async (_event, projectName: string, relativePath: string, patch: WikiFrontmatterPatch) => {
      const vault = ProjectService.getVault(projectName);
      const page = await vault.readWikiPage(relativePath);
      let changedFields: string[] = [];
      const updated = updateFrontmatter(page.content, (fm) => {
        changedFields = applyWikiFrontmatterPatch(fm, patch);
      });
      if (!updated) {
        throw new Error(`Seite "${relativePath}" hat kein Frontmatter.`);
      }
      if (changedFields.length === 0) return page;

      const rel = relativePath.startsWith('wiki/') ? relativePath : join('wiki', relativePath);
      await vault.writeFile(rel, updated);
      await ProjectService.commitIfNeeded(
        projectName,
        `Wiki-Metadaten aktualisiert: ${rel} (${changedFields.join(', ')})`,
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

  ipcMain.handle('wiki:list-backlinks', async (_event, projectName: string, relativePath: string) => {
    const vault = ProjectService.getVault(projectName);
    const pages = await vault.loadAllWikiPages();
    return findBacklinks(pages, relativePath);
  });

  ipcMain.handle('wiki:list-review-queue', async (_event, projectName: string) => {
    const vault = ProjectService.getVault(projectName);
    const pages = await vault.loadAllWikiPages();
    return buildWikiReviewQueue(pages);
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
    const { index } = await vault.getSearchIndex(allPages);
    const { nodes, edges } = buildGraphData(allPages, index);
    return { nodes, edges };
  });
}
