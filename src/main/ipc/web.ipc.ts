import { ipcMain } from 'electron';
import { ProjectService } from '../services/project.service';
import {
  isSystemPage,
  toPageId,
  ensureFrontmatterType,
  updateFrontmatter,
  generateWikilinkMap,
  updateIndexes,
} from '../core/vault';
import { askWithTools, parseClaudeJson } from '../core/claude';
import { createWebState, DEFAULT_MAX_PAGES } from '../core/web-fetch';
import { WEB_FETCH_TOOL, makeFetchUrlHandler, buildWebEnrichPrompt } from '../core/web-enrich';
import { diffShrink, isLegitimateShrink } from '../core/wiki-additive-guard';
import { requireRootPrefix } from '../core/pathSafety';
import { INGEST_PROMPT, WEB_ENRICH_PREAMBLE } from '../core/prompts/index';
import { loadConfig } from '../core/config';
import type { WebEnrichResult } from '../../shared/api.types';

interface WebOp { action: 'create' | 'update'; path: string; content: string }

export function registerWebHandlers(): void {
  ipcMain.handle(
    'web:enrich',
    async (_event, projectName: string, opts: { seedUrls: string[]; maxPages?: number }): Promise<WebEnrichResult> => {
      const seedUrls = (opts?.seedUrls ?? []).map((u) => u.trim()).filter(Boolean);
      if (seedUrls.length === 0) return { error: 'Keine Seed-URLs angegeben.' };

      const vault = ProjectService.getVault(projectName);
      const config = await loadConfig(ProjectService.getProjectPath(projectName));
      const allPages = await vault.loadAllWikiPages();
      const existingIds = allPages
        .filter((p) => !isSystemPage(p.relativePath.split('/').pop()?.replace(/\.md$/, '') || ''))
        .map((p) => toPageId(p.relativePath));

      const state = createWebState(seedUrls, { maxPages: opts?.maxPages ?? DEFAULT_MAX_PAGES });
      const handler = makeFetchUrlHandler(state);

      let res;
      try {
        res = await askWithTools({
          system: WEB_ENRICH_PREAMBLE + INGEST_PROMPT,
          prompt: buildWebEnrichPrompt(seedUrls, existingIds),
          tools: [WEB_FETCH_TOOL],
          handler,
          model: config.models.ingest,
          maxTokens: 8192,
          maxToolTurns: state.config.maxPages + 4,
        });
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err), pagesFetched: state.fetched };
      }

      const parsed = parseClaudeJson<{ operations?: WebOp[] }>(res.text);
      const operations = parsed?.operations ?? [];

      let created = 0;
      let updated = 0;
      const pageCache = new Map(allPages.map((p) => [p.relativePath, p.content]));

      for (const op of operations) {
        try {
          const safePath = requireRootPrefix(op.path, 'wiki');
          let content = ensureFrontmatterType(op.content, safePath);

          if (op.action === 'update' && !isLegitimateShrink(content)) {
            const old = pageCache.get(safePath) ?? null;
            if (old && diffShrink(old, content).shrunk) {
              content = updateFrontmatter(content, (fm) => { fm.reviewed = false; }) ?? content;
            }
          }

          await vault.writeFile(safePath, content);
          if (op.action === 'create') created++; else updated++;
        } catch {
          /* unsicherer Pfad / Schreibfehler — Operation ueberspringen */
        }
      }

      if (created + updated > 0) {
        await generateWikilinkMap(vault.wikiDir);
        await updateIndexes(vault.wikiDir);
        await ProjectService.commitIfNeeded(projectName, `Web-Anreicherung: ${seedUrls.length} Seed(s), ${created + updated} Seite(n)`);
      }

      return { created, updated, pagesFetched: state.fetched };
    },
  );
}
