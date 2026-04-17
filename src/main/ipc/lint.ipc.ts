import { ipcMain, BrowserWindow } from 'electron';
import { basename } from 'path';
import { ProjectService } from '../services/project.service';
import {
  slugify,
  generateWikilinkMap,
  updateIndexes,
  today,
  updateFrontmatter,
  isSystemPage,
  toPageId,
} from '../core/vault';
import { extractWikilinks, pageAliases, linkTargetAliases } from '../core/wikilinks';
import { loadConfig } from '../core/config';
import { askForJson } from '../core/claude';
import { bm25RankWithIndex } from '../core/search';
import { requireRootPrefix } from '../core/pathSafety';
import { LINT_FIX_PROMPT, LINT_SUGGEST_PROMPT } from '../core/prompts/index';
import { buildBrandContextBlock } from '../services/brand.service';
import { checkAndRegenerateOutputs } from './output.ipc';
import type { LintResult, LintSuggestions } from '../../shared/api.types';
import type { WikiPage } from '../core/vault';

function sendLintProgress(step: string, message: string): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send('lint:progress', { step, message });
  }
}

interface LintFixAiResult {
  pages: Array<{ path: string; content: string }>;
  skipped: Array<{ target: string; reason: string }>;
}

function countTopTags(pages: WikiPage[], limit: number): string[] {
  const freq = new Map<string, number>();
  for (const page of pages) {
    const tags = page.frontmatter.tags;
    if (!Array.isArray(tags)) continue;
    for (const t of tags) {
      if (typeof t !== 'string') continue;
      const tag = t.trim().toLowerCase();
      if (!tag) continue;
      freq.set(tag, (freq.get(tag) || 0) + 1);
    }
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag]) => tag);
}

function emptySuggestions(): LintSuggestions {
  return { questions: [], gaps: [], sourceSuggestions: [], synthesisCandidates: [] };
}

export function registerLintHandlers(): void {
  ipcMain.handle('lint:run', async (_event, projectName: string) => {
    const vault = ProjectService.getVault(projectName);
    const allPageFiles = await vault.listWikiPages();
    const loadedPages = await Promise.all(
      allPageFiles.map(async (pagePath) => ({
        id: toPageId(pagePath),
        name: basename(pagePath, '.md'),
        page: await vault.readWikiPage(pagePath),
      }))
    );

    const aliasToPageIds = new Map<string, Set<string>>();
    const incomingLinksById = new Map<string, number>();

    for (const entry of loadedPages) {
      incomingLinksById.set(entry.id, 0);
      for (const alias of pageAliases(entry.id, entry.name)) {
        const ids = aliasToPageIds.get(alias) || new Set<string>();
        ids.add(entry.id);
        aliasToPageIds.set(alias, ids);
      }
    }

    // Broken Wikilinks
    const brokenLinks: Array<{ file: string; target: string }> = [];
    for (const entry of loadedPages) {
      const links = extractWikilinks(entry.page.content);
      for (const link of links) {
        const aliases = linkTargetAliases(link.target);
        let found = false;
        for (const alias of aliases) {
          const ids = aliasToPageIds.get(alias);
          if (ids && ids.size > 0) {
            found = true;
            for (const targetId of ids) {
              if (targetId !== entry.id) {
                incomingLinksById.set(targetId, (incomingLinksById.get(targetId) || 0) + 1);
              }
            }
            break;
          }
        }
        if (!found) {
          brokenLinks.push({ file: entry.id, target: link.target });
        }
      }
    }

    // Orphans
    const orphans = loadedPages
      .filter((e) => !isSystemPage(e.name))
      .filter((e) => (incomingLinksById.get(e.id) || 0) === 0)
      .map((e) => e.id);

    let indexMissing: string[] = [];
    try {
      const indexContent = await vault.readFile('wiki/index.md');
      const indexAliases = new Set<string>();
      for (const link of extractWikilinks(indexContent)) {
        for (const alias of linkTargetAliases(link.target)) indexAliases.add(alias);
      }
      for (const entry of loadedPages) {
        if (isSystemPage(entry.name)) continue;
        const hasMatch = pageAliases(entry.id, entry.name).some((a) => indexAliases.has(a));
        if (!hasMatch) indexMissing.push(entry.id);
      }
    } catch {
      indexMissing = loadedPages.filter((e) => !isSystemPage(e.name)).map((e) => e.id);
    }

    // Temporale Integritaet
    const stalePages: Array<{ file: string; status: string; age: number }> = [];
    const missingTemporalFields: string[] = [];
    const supersededNotStale: string[] = [];
    const seedWithMultipleSources: string[] = [];
    const unreviewedPages: string[] = [];
    const uncertainPages: string[] = [];
    const todayDate = new Date();

    for (const entry of loadedPages) {
      if (isSystemPage(entry.name)) continue;
      const fm = entry.page.frontmatter;

      if (!fm.confidence || !fm.status) {
        missingTemporalFields.push(entry.id);
      }

      if (fm.reviewed === false) unreviewedPages.push(entry.id);
      if (fm.confidence === 'uncertain') uncertainPages.push(entry.id);

      if (fm.status === 'seed' && typeof fm.created === 'string') {
        const created = new Date(fm.created);
        if (!Number.isNaN(created.getTime())) {
          const ageDays = Math.floor((todayDate.getTime() - created.getTime()) / 86400000);
          if (ageDays > 90) {
            stalePages.push({ file: entry.id, status: 'seed', age: ageDays });
          }
        }
      }

      if (fm.superseded_by && fm.status !== 'stale') {
        supersededNotStale.push(entry.id);
      }

      if (Array.isArray(fm.sources) && fm.sources.length >= 2 && fm.status === 'seed') {
        seedWithMultipleSources.push(entry.id);
      }
    }

    const errors = brokenLinks.length + supersededNotStale.length + seedWithMultipleSources.length;
    const warnings = orphans.length + indexMissing.length + stalePages.length + uncertainPages.length;

    return {
      brokenLinks,
      orphans,
      indexMissing,
      stalePages,
      supersededNotStale,
      seedWithMultipleSources,
      missingTemporalFields,
      unreviewedPages,
      uncertainPages,
      errors,
      warnings,
    } satisfies LintResult;
  });

  ipcMain.handle('lint:fix', async (_event, projectName: string) => {
    const vault = ProjectService.getVault(projectName);
    const config = await loadConfig(ProjectService.getProjectPath(projectName));
    const brandBlock = await buildBrandContextBlock(projectName);
    const allPageFiles = await vault.listWikiPages();

    const actions: Array<{ page: string; action: string }> = [];
    const skipped: Array<{ page: string; reason: string }> = [];

    sendLintProgress('init', `Lade ${allPageFiles.length} Wiki-Seiten...`);

    // Alle Seiten einmalig parallel lesen
    const loadedPages = await Promise.all(
      allPageFiles.map(async (pagePath) => ({
        pagePath,
        id: toPageId(pagePath),
        name: basename(pagePath, '.md'),
        page: await vault.readWikiPage(pagePath),
      }))
    );

    sendLintProgress('init', `${loadedPages.length} Seiten geladen.`);

    sendLintProgress('frontmatter', 'Frontmatter-Probleme reparieren...');

    for (const entry of loadedPages) {
      if (isSystemPage(entry.name)) continue;

      const pageActions: string[] = [];
      const updated = updateFrontmatter(entry.page.content, (fm) => {
        if (fm.superseded_by && fm.status !== 'stale') {
          fm.status = 'stale';
          pageActions.push(`Status → stale (ersetzt durch ${fm.superseded_by})`);
        }
        if (Array.isArray(fm.sources) && fm.sources.length >= 2 && fm.status === 'seed') {
          fm.status = 'confirmed';
          if (fm.confidence === 'low') fm.confidence = 'medium';
          pageActions.push(`Status seed → confirmed (${fm.sources.length} Quellen)`);
        }
        const added: string[] = [];
        if (!fm.status) { fm.status = 'seed'; added.push('status'); }
        if (!fm.confidence) { fm.confidence = 'low'; added.push('confidence'); }
        if (fm.reviewed === undefined) { fm.reviewed = false; added.push('reviewed'); }
        if (added.length > 0) pageActions.push(`Fehlende Felder ergaenzt: ${added.join(', ')}`);
      });

      if (updated && pageActions.length > 0) {
        const fullRelative = entry.pagePath.startsWith('wiki/') ? entry.pagePath : `wiki/${entry.pagePath}`;
        await vault.writeFile(fullRelative, updated);
        for (const action of pageActions) actions.push({ page: entry.id, action });
      }
    }

    // Iteriert, weil KI-generierte Seiten wiederum Broken Links enthalten koennen.
    const MAX_LINT_ITERATIONS = 3;
    let totalCreated = 0;
    let totalSkippedByAi = 0;

    for (let iter = 1; iter <= MAX_LINT_ITERATIONS; iter++) {
      const aliasToId = new Map<string, string>();
      for (const entry of loadedPages) {
        if (isSystemPage(entry.name)) continue;
        for (const alias of pageAliases(entry.id, entry.name)) {
          aliasToId.set(alias, entry.id);
        }
      }

      const missingTargets = new Map<
        string,
        { target: string; slug: string; referencedBy: string[]; contexts: string[] }
      >();
      for (const entry of loadedPages) {
        const links = extractWikilinks(entry.page.content);
        for (const link of links) {
          const aliases = linkTargetAliases(link.target);
          let found = false;
          for (const alias of aliases) {
            if (aliasToId.has(alias)) { found = true; break; }
          }
          if (found) continue;
          const slug = slugify(link.target);
          if (!slug) continue;
          const existing = missingTargets.get(slug);
          if (existing) {
            if (!existing.referencedBy.includes(entry.id)) existing.referencedBy.push(entry.id);
          } else {
            missingTargets.set(slug, { target: link.target, slug, referencedBy: [entry.id], contexts: [] });
          }
        }
      }

      if (missingTargets.size === 0) {
        if (iter === 1) sendLintProgress('context', 'Keine Broken Links gefunden.');
        else sendLintProgress('ai', `Iteration ${iter}: keine weiteren Broken Links — stabil.`);
        break;
      }

      sendLintProgress('context', `Iteration ${iter}/${MAX_LINT_ITERATIONS}: ${missingTargets.size} fehlende Seiten — sammle Kontext...`);

      for (const [, info] of missingTargets) {
        const targetLower = info.target.toLowerCase();
        const exactLink = `[[${info.target}]]`;
        for (const pageId of info.referencedBy.slice(0, 5)) {
          const page = loadedPages.find((p) => p.id === pageId);
          if (!page) continue;
          const paragraphs = page.page.content.split(/\n\n+/);
          for (const p of paragraphs) {
            if (p.toLowerCase().includes(targetLower) || p.includes(exactLink)) {
              info.contexts.push(`[${pageId}]: ${p.slice(0, 600)}`);
              if (info.contexts.length >= 6) break;
            }
          }
          if (info.contexts.length >= 6) break;
        }
      }

      const existingPageList = loadedPages
        .filter((e) => !isSystemPage(e.name))
        .map((e) => e.id)
        .join(', ');

      const BATCH_SIZE = 15;
      const MAX_CONTEXT_PER_BATCH = 60_000;
      const allTargets = [...missingTargets.values()];
      const batches: Array<typeof allTargets> = [];
      let currentBatch: typeof allTargets = [];
      let currentSize = 0;
      for (const target of allTargets) {
        const targetSize = target.contexts.join('\n').length + target.target.length + 200;
        if (currentBatch.length >= BATCH_SIZE || (currentSize + targetSize > MAX_CONTEXT_PER_BATCH && currentBatch.length > 0)) {
          batches.push(currentBatch);
          currentBatch = [];
          currentSize = 0;
        }
        currentBatch.push(target);
        currentSize += targetSize;
      }
      if (currentBatch.length > 0) batches.push(currentBatch);

      let batchIndex = 0;
      let iterCreated = 0;

      for (const batch of batches) {
        batchIndex++;
        sendLintProgress('ai', `Iter ${iter}, Batch ${batchIndex}/${batches.length} (${batch.length} Seiten)...`);

        const targetSections = batch.map((t) => {
          const contextBlock = t.contexts.length > 0
            ? t.contexts.join('\n')
            : `Keine direkten Kontext-Schnipsel verfuegbar. Referenziert von: ${t.referencedBy.join(', ')}`;
          return `### ${t.target}\nDateiname MUSS sein: \`${t.slug}.md\` (z.B. \`wiki/concepts/${t.slug}.md\` oder \`wiki/entities/${t.slug}.md\`)\nReferenziert von: ${t.referencedBy.join(', ')}\nKontext:\n${contextBlock}`;
        }).join('\n\n---\n\n');

        const prompt = `${brandBlock}## Konfiguration

Themenfeld: ${config.domain || 'Allgemein'}
Sprache: ${config.language === 'de' ? 'Deutsch' : 'English'}
Heutiges Datum: ${today()}

## Existierende Wiki-Seiten (fuer Wikilinks)

${existingPageList}

## Fehlende Seiten — bitte erstellen

${targetSections}`;

        try {
          const { result, response, attempts, lastDiag } = await askForJson<LintFixAiResult>({
            system: LINT_FIX_PROMPT,
            prompt,
            model: config.models.lint,
            maxTokens: 16384,
          });

          sendLintProgress('ai', `Iter ${iter}, Batch ${batchIndex}: ${response.usage.inputTokens.toLocaleString('de')} Input / ${response.usage.outputTokens.toLocaleString('de')} Output Tokens`);

          if (attempts > 1 && result) {
            sendLintProgress('ai', `Iter ${iter}, Batch ${batchIndex}: JSON erst nach ${attempts} Versuchen gueltig.`);
          }

          if (!result) {
            sendLintProgress('error', `Iter ${iter}, Batch ${batchIndex}: JSON-Parsing fehlgeschlagen nach ${attempts} Versuch(en). ${lastDiag ?? ''}`);
            skipped.push({ page: `Iter ${iter} Batch ${batchIndex}`, reason: `JSON-Parsing fehlgeschlagen nach ${attempts} Versuch(en)` });
            continue;
          }

          if (result.pages) {
            const expectedSlugs = new Map<string, string>();
            for (const t of batch) {
              expectedSlugs.set(slugify(t.target), t.slug);
            }

            for (const page of result.pages) {
              try {
                let safePath = requireRootPrefix(page.path, 'wiki');

                const actualFilename = basename(safePath, '.md');
                const actualSlug = slugify(actualFilename);
                const dirPart = safePath.replace(/[^/]+\.md$/, '');

                let matchedExpected: string | undefined;
                for (const [, expected] of expectedSlugs) {
                  if (actualSlug === expected || actualFilename === expected) {
                    matchedExpected = expected;
                    break;
                  }
                }
                if (!matchedExpected) {
                  for (const t of batch) {
                    const titleLower = t.target.toLowerCase();
                    if (page.content.toLowerCase().includes(titleLower)) {
                      matchedExpected = t.slug;
                      break;
                    }
                  }
                }
                if (matchedExpected && actualSlug !== matchedExpected) {
                  safePath = `${dirPart}${matchedExpected}.md`;
                  safePath = requireRootPrefix(safePath, 'wiki');
                }

                await vault.writeFile(safePath, page.content);
                iterCreated++;
                totalCreated++;
                const pageId = toPageId(safePath);
                actions.push({ page: pageId, action: `KI-generierte Seite erstellt (Iter ${iter})` });

                const newRelative = safePath.replace(/^wiki\//, '');
                if (!loadedPages.find((p) => p.id === pageId)) {
                  loadedPages.push({
                    pagePath: newRelative,
                    id: pageId,
                    name: basename(newRelative, '.md'),
                    page: await vault.readWikiPage(newRelative),
                  });
                }
              } catch {
                /* unsicherer Pfad */
              }
            }
          }

          if (result.skipped) {
            for (const s of result.skipped) {
              totalSkippedByAi++;
              skipped.push({ page: s.target, reason: s.reason });
            }
          }
        } catch (err) {
          sendLintProgress('error', `Iter ${iter}, Batch ${batchIndex} fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
          skipped.push({ page: `Iter ${iter} Batch ${batchIndex}`, reason: `API-Fehler: ${err instanceof Error ? err.message : String(err)}` });
        }
      }

      if (iterCreated === 0) {
        sendLintProgress('ai', `Iteration ${iter}: keine Seiten erstellt — Abbruch.`);
        break;
      }
    }

    sendLintProgress('ai', `KI-Reparatur abgeschlossen: ${totalCreated} Seiten erstellt, ${totalSkippedByAi} uebersprungen`);

    sendLintProgress('indexes', 'Indexes und Wikilinks aktualisieren...');

    await generateWikilinkMap(vault.wikiDir);
    const addedToIndex = await updateIndexes(vault.wikiDir);
    if (addedToIndex > 0) {
      actions.push({ page: 'index', action: `${addedToIndex} Eintraege zu Indexes hinzugefuegt` });
    }

    if (actions.length > 0) {
      await ProjectService.commitIfNeeded(projectName, `Gesundheitscheck: ${actions.length} Reparatur(en)`);
    }

    sendLintProgress('done', `Reparatur abgeschlossen: ${actions.length} Aktionen`);

    if (actions.length > 0) {
      checkAndRegenerateOutputs(projectName).catch(() => { /* Hintergrund */ });
    }

    return { fixed: actions.length, actions, skipped };
  });

  ipcMain.handle('lint:suggest', async (_event, projectName: string): Promise<LintSuggestions> => {
    const vault = ProjectService.getVault(projectName);
    const config = await loadConfig(ProjectService.getProjectPath(projectName));
    const brandBlock = await buildBrandContextBlock(projectName);
    const { index, pages: allPages } = await vault.getSearchIndex();
    const contentPages = allPages.filter((p) => !isSystemPage(basename(p.relativePath, '.md')));

    if (contentPages.length === 0) return emptySuggestions();

    const topTags = countTopTags(contentPages, 10);
    const sampleRanked = topTags.length > 0
      ? bm25RankWithIndex(contentPages, topTags, index, { limit: 20 })
      : contentPages.slice(0, 20);
    const sample = sampleRanked.length > 0 ? sampleRanked : contentPages.slice(0, 20);

    const indexContent = await vault.readFile('wiki/index.md').catch(() => '');
    const stubs = await vault.getPendingStubs().catch(() => []);
    const logContent = await vault.readFile('wiki/log.md').catch(() => '');
    const logTailLines = logContent.split('\n').filter((l) => l.trim()).slice(-20);

    const sampleBlocks = sample.map((p) => {
      const snippet = p.content.slice(0, 500).replace(/\n{2,}/g, '\n');
      const tags = Array.isArray(p.frontmatter.tags) ? p.frontmatter.tags.join(', ') : '';
      const status = typeof p.frontmatter.status === 'string' ? p.frontmatter.status : '';
      const sources = Array.isArray(p.frontmatter.sources) ? p.frontmatter.sources.length : 0;
      return `### ${toPageId(p.relativePath)}\nTags: ${tags} | Status: ${status} | Quellen: ${sources}\n${snippet}`;
    }).join('\n\n---\n\n');

    const stubBlock = stubs.length > 0
      ? stubs.slice(0, 30).map((s) => `- ${s.title} (${s.category}) — referenziert von: ${s.referencedBy.slice(0, 3).join(', ')}`).join('\n')
      : 'Keine offenen Stubs.';

    const indexBlock = indexContent ? indexContent.slice(0, 2000) : 'Kein Index vorhanden.';
    const logBlock = logTailLines.length > 0 ? logTailLines.join('\n') : 'Kein Log verfuegbar.';

    const prompt = `${brandBlock}## Konfiguration

Themenfeld: ${config.domain || 'Allgemein'}
Sprache: ${config.language === 'de' ? 'Deutsch' : 'English'}
Heutiges Datum: ${today()}

## Statistik

Gesamt: ${contentPages.length} Wiki-Seiten
Haeufigste Tags: ${topTags.join(', ') || '—'}
Offene Stubs: ${stubs.length}

## Index (Auszug)

${indexBlock}

## Letzte Aktivitaet (log-Tail)

${logBlock}

## Offene Stubs (bereits erkannte Luecken)

${stubBlock}

## Seiten-Stichprobe (Top ${sample.length} nach Relevanz)

${sampleBlocks}

## Auftrag

Analysiere die Stichprobe und schlage vor: sinnvolle Fragen an das Wiki, Wissensluecken, potentielle Quellen und Synthese-Kandidaten. Nur konkret, immer mit Bezug auf vorhandene Seiten.`;

    const { result } = await askForJson<LintSuggestions>({
      system: LINT_SUGGEST_PROMPT,
      prompt,
      model: config.models.lint,
      maxTokens: 8192,
    });

    if (!result) return emptySuggestions();
    return {
      questions: Array.isArray(result.questions) ? result.questions : [],
      gaps: Array.isArray(result.gaps) ? result.gaps : [],
      sourceSuggestions: Array.isArray(result.sourceSuggestions) ? result.sourceSuggestions : [],
      synthesisCandidates: Array.isArray(result.synthesisCandidates) ? result.synthesisCandidates : [],
    };
  });
}
