import { ipcMain, BrowserWindow } from 'electron';
import path, { basename } from 'path';
import { ProjectService } from '../services/project.service';
import { ConvertService } from '../services/convert.service';
import { loadConfig } from '../core/config';
import { askForJson, type ImageBlock } from '../core/claude';
import {
  generateWikilinkMap,
  updateIndexes,
  slugify,
  today,
  rankPagesByKeywords,
  isSystemPage,
  toPageId,
  type WikiPage,
  type PendingStub,
} from '../core/vault';
import { extractWikilinks, linkTargetAliases, pageAliases } from '../core/wikilinks';
import { extractKeywords } from '../core/keywords';
import { buildWikiContext } from '../core/wiki-context';
import { requireRootPrefix, toScopedRelativePath } from '../core/pathSafety';
import { INGEST_PROMPT } from '../core/prompts/index';
import { buildBrandContextBlock } from '../services/brand.service';
import { checkAndRegenerateOutputs } from './output.ipc';

const BINARY_EXTENSIONS = new Set(['.pdf', '.docx']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

const RELEVANT_PAGE_LIMIT = 12;
const MAX_EXISTING_CONTEXT_CHARS = 80_000;
const MAX_PAGE_ALLOW_LIST = 800;

interface IngestResult {
  sourceFile?: string;
  takeaways: string[];
  operations: Array<{
    action: 'create' | 'update';
    path: string;
    content: string;
  }>;
  summary: {
    created: string[];
    updated: string[];
    contradictions: string[];
    superseded: Array<{ old: string; new: string }>;
  };
}

function sendProgress(file: string, step: string, message: string): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send('ingest:progress', { file, step, message });
  }
}

/**
 * Wrapt ein Promise und emittiert alle 3 s ein `thinking`-Progress-Event,
 * damit das UI waehrend langer Claude-Calls nicht eingefroren wirkt.
 */
async function withHeartbeat<T>(file: string, label: string, task: () => Promise<T>): Promise<T> {
  const start = Date.now();
  const tick = () => {
    const seconds = Math.round((Date.now() - start) / 1000);
    sendProgress(file, 'thinking', `${label} (${seconds}s)`);
  };
  tick();
  const interval = setInterval(tick, 3000);
  try {
    return await task();
  } finally {
    clearInterval(interval);
  }
}

export async function runIngest(projectName: string, files?: string[]): Promise<IngestResult[]> {
  const vault = ProjectService.getVault(projectName);
    const config = await loadConfig(ProjectService.getProjectPath(projectName));
    const brandBlock = await buildBrandContextBlock(projectName);
    const results: IngestResult[] = [];

    let toProcess: string[];

    if (files && files.length > 0) {
      toProcess = files;
    } else {
      const allRaw = await vault.listRawFiles();
      const ingested = await vault.getIngestedSources();
      toProcess = allRaw.filter((f) => !ingested.has(f));
    }

    const pendingStubs = await vault.getPendingStubs();

    // Wenn report.pdf UND report.md existieren: nur die .pdf behalten, der Ingest liest
    // die konvertierte .md on-the-fly.
    const binaryBases = new Set(
      toProcess
        .filter((f) => BINARY_EXTENSIONS.has(path.extname(f).toLowerCase()))
        .map((f) => f.replace(/\.[^.]+$/, '')),
    );
    toProcess = toProcess.filter((f) => {
      if (path.extname(f).toLowerCase() !== '.md') return true;
      const base = f.replace(/\.md$/, '');
      return !binaryBases.has(base);
    });

    if (toProcess.length === 0) {
      sendProgress('__summary__', 'empty', 'Keine neuen Dateien zum Verarbeiten.');
      return [];
    }

    const totalFiles = toProcess.length;
    let processedCount = 0;
    let errorCount = 0;
    const allFilledStubPaths = new Set<string>();

    const pageCacheByRelative = new Map<string, WikiPage>();
    for (const p of await vault.loadAllWikiPages()) {
      pageCacheByRelative.set(p.relativePath, p);
    }

    const knownPageIds = new Set<string>(
      [...pageCacheByRelative.keys()]
        .map(toPageId)
        .filter((id) => !isSystemPage(basename(id))),
    );

    for (const file of toProcess) {
      sendProgress(file, 'analyzing', `Analysiere ${file}...`);

      try {
        const ext = path.extname(file).toLowerCase();
        let rawContent: string;
        let imageBlocks: ImageBlock[] | undefined;

        if (IMAGE_EXTENSIONS.has(ext)) {
          sendProgress(file, 'analyzing', `Lese Bild ${file} fuer Vision-Analyse...`);
          const imageBuffer = await vault.readBinary(toScopedRelativePath('raw', file));
          const base64 = imageBuffer.toString('base64');
          const mediaType = ConvertService.imageMediaType(file);
          imageBlocks = [{ data: base64, mediaType }];
          rawContent = `[Bild: ${file}]`;
        } else if (BINARY_EXTENSIONS.has(ext)) {
          const baseName = file.replace(/\.[^.]+$/, '');
          const mdName = `${baseName}.md`;
          const mdPath = toScopedRelativePath('raw', mdName);

          try {
            rawContent = await vault.readFile(mdPath);
            sendProgress(file, 'analyzing', `Nutze konvertierte Version: ${mdName}`);
          } catch {
            sendProgress(file, 'converting', `Konvertiere ${file} zu Markdown...`);
            const absPath = path.join(vault.root, 'raw', file);
            const conversion = await ConvertService.toMarkdown(absPath);

            if (!conversion.converted || !conversion.markdown) {
              sendProgress(file, 'error', conversion.error || `${file} konnte nicht konvertiert werden`);
              continue;
            }

            rawContent = conversion.markdown;
            await vault.writeFile(`raw/${mdName}`, rawContent);
          }
        } else {
          const rawPath = toScopedRelativePath('raw', file);
          rawContent = await vault.readFile(rawPath);
        }

        const sourceDate = await vault.getSourceDate(file);

        const keywords = extractKeywords(rawContent, 30);
        const relevantPages = rankPagesByKeywords(
          [...pageCacheByRelative.values()],
          keywords,
          RELEVANT_PAGE_LIMIT,
        );

        const existingContext = buildWikiContext(
          relevantPages,
          MAX_EXISTING_CONTEXT_CHARS,
          'Keine bestehenden Wiki-Seiten gefunden.'
        );

        let stubSection = '';
        if (pendingStubs.length > 0) {
          const stubLines = pendingStubs.map(
            (s) => `- **${s.title}** (${s.category}/${s.slug}) — referenziert von: ${s.referencedBy.join(', ')}`,
          );
          stubSection = `\n\n## Fehlende Wiki-Seiten (Stubs)\n\nDiese Seiten werden im Wiki referenziert, haben aber noch keinen Inhalt. Wenn die Quelle relevante Informationen zu diesen Themen enthaelt, erstelle oder aktualisiere die entsprechenden Seiten unter dem angegebenen Pfad.\n\n${stubLines.join('\n')}`;
        }

        // Ohne Allow-List produziert Claude bei jedem Ingest frische Broken Links.
        const allowList = [...knownPageIds].sort();
        const truncated = allowList.length > MAX_PAGE_ALLOW_LIST;
        const allowListText = truncated
          ? allowList.slice(0, MAX_PAGE_ALLOW_LIST).join(', ') + `, ... (${allowList.length - MAX_PAGE_ALLOW_LIST} weitere)`
          : allowList.join(', ') || '(noch keine Seiten vorhanden)';

        const prompt = `${brandBlock}## Kontext

Themenfeld: ${config.domain || 'Allgemein'}
Sprache: ${config.language === 'de' ? 'Deutsch' : 'English'}
Verfuegbare Tags: ${config.ingest.tags.join(', ') || 'frei waehlbar'}
Entitaets-Typen: ${config.ingest.entityTypes.join(', ')}
Konzept-Typen: ${config.ingest.conceptTypes.join(', ')}

## Verfuegbare Wiki-Seiten (Allow-List fuer Wikilinks)

Setze [[Wikilinks]] AUSSCHLIESSLICH auf Seiten aus dieser Liste oder auf Seiten die du selbst in \`operations\` erstellst. Alles andere bleibt Fettdruck.

${allowListText}

## Bestehende Wiki-Seiten (Inhaltsauszug)

${existingContext}${stubSection}

## Neue Quelle

Dateiname: ${file}
Quelldatum: ${sourceDate}

${rawContent}`;

        const { result, response, attempts, lastDiag } = await withHeartbeat(
          file,
          'KI analysiert',
          () =>
            askForJson<IngestResult>({
              system: INGEST_PROMPT,
              prompt,
              images: imageBlocks,
              model: config.models.ingest,
              maxTokens: 32768,
            }),
        );

        sendProgress(file, 'tokens', `${response.usage.inputTokens.toLocaleString('de')} Input / ${response.usage.outputTokens.toLocaleString('de')} Output Tokens`);

        if (response.truncated) {
          sendProgress(file, 'warning', `Antwort wurde abgeschnitten (Token-Limit) — versuche Reparatur...`);
        }

        if (attempts > 1 && result) {
          sendProgress(file, 'warning', `JSON erst nach ${attempts} Versuchen gueltig.`);
        }

        if (!result) {
          sendProgress(file, 'error', `JSON-Parsing fehlgeschlagen nach ${attempts} Versuch(en). ${lastDiag ?? ''}`);
          errorCount++;
          processedCount++;
          sendProgress('__summary__', 'progress', `${processedCount} von ${totalFiles} Dateien verarbeitet`);
          continue;
        }

        sendProgress(file, 'writing', 'Schreibe Wiki-Seiten...');

        if (result.operations) {
          for (const op of result.operations) {
            try {
              const safePath = requireRootPrefix(op.path, 'wiki');
              await vault.writeFile(safePath, op.content);

              const wikiRelative = toPageId(safePath);
              knownPageIds.add(wikiRelative);
              if (pendingStubs.some((s) => s.path === wikiRelative)) {
                allFilledStubPaths.add(wikiRelative);
              }

              // Cache aktualisieren, damit spaetere Dateien in rankPagesByKeywords die neue
              // Seite sehen und die Broken-Link-Analyse sie nicht als fehlend meldet.
              pageCacheByRelative.set(safePath, await vault.readWikiPage(safePath));
            } catch {
              /* Unsicherer Pfad */
            }
          }
        }

        const created = result.summary?.created?.length || 0;
        const updated = result.summary?.updated?.length || 0;
        const superseded = result.summary?.superseded?.length || 0;

        await vault.appendLog(
          `\n## [${today()}] ingest | ${file}\nVerarbeitet: ${file}\nErstellt: ${created} neue Seiten, aktualisiert: ${updated} bestehende Seiten, ${superseded} ersetzt.\n`
        );

        result.sourceFile = file;
        results.push(result);
        processedCount++;
        sendProgress(file, 'done', `${file} verarbeitet: ${created} erstellt, ${updated} aktualisiert`);
        sendProgress('__summary__', 'progress', `${processedCount} von ${totalFiles} Dateien verarbeitet`);
      } catch (err) {
        errorCount++;
        processedCount++;
        sendProgress(file, 'error', `Fehler bei ${file}: ${err instanceof Error ? err.message : String(err)}`);
        sendProgress('__summary__', 'progress', `${processedCount} von ${totalFiles} Dateien verarbeitet`);
      }
    }

    // Pending-Stubs pauschal leeren — die Broken-Link-Analyse unten regeneriert sie frisch.
    if (pendingStubs.length > 0) {
      const allStubPaths = new Set(pendingStubs.map((s) => s.path));
      await vault.removePendingStubs(allStubPaths);
      if (allFilledStubPaths.size > 0) {
        sendProgress('__summary__', 'committing', `${allFilledStubPaths.size} von ${pendingStubs.length} Stub-Seite(n) mit Inhalt gefuellt`);
      }
    }

    sendProgress('__summary__', 'committing', 'Broken Wikilinks analysieren...');
    const loadedWikiPages = [...pageCacheByRelative.values()].map((p) => {
      const id = toPageId(p.relativePath);
      return { id, name: basename(id), content: p.content };
    });

    const aliasToId = new Map<string, string>();
    for (const entry of loadedWikiPages) {
      if (isSystemPage(entry.name)) continue;
      for (const alias of pageAliases(entry.id, entry.name)) {
        aliasToId.set(alias, entry.id);
      }
    }

    const newStubs = new Map<string, PendingStub>();
    for (const entry of loadedWikiPages) {
      const links = extractWikilinks(entry.content);
      for (const link of links) {
        const aliases = linkTargetAliases(link.target);
        let found = false;
        for (const alias of aliases) {
          if (aliasToId.has(alias)) { found = true; break; }
        }
        if (found) continue;

        const slug = slugify(link.target);
        if (!slug) continue;
        const stubPath = `concepts/${slug}`;
        const prev = newStubs.get(stubPath);
        if (prev) {
          if (!prev.referencedBy.includes(entry.id)) prev.referencedBy.push(entry.id);
        } else {
          newStubs.set(stubPath, {
            slug,
            title: link.target,
            category: 'concepts',
            path: stubPath,
            referencedBy: [entry.id],
          });
        }
      }
    }

    if (newStubs.size > 0) {
      await vault.addPendingStubs([...newStubs.values()]);
      sendProgress('__summary__', 'committing', `${newStubs.size} fehlende Seite(n) als Stub markiert`);
    }

    sendProgress('__summary__', 'committing', 'Indexes und Wikilinks aktualisieren...');
    await generateWikilinkMap(vault.wikiDir);
    await updateIndexes(vault.wikiDir);
    await ProjectService.commitIfNeeded(projectName, `Ingest: ${toProcess.join(', ')}`);

    const successCount = processedCount - errorCount;
    sendProgress('__summary__', 'complete', `Ingest abgeschlossen: ${successCount} erfolgreich${errorCount > 0 ? `, ${errorCount} Fehler` : ''}`);

    if (successCount > 0) {
      checkAndRegenerateOutputs(projectName).catch(() => { /* Hintergrund */ });
    }

    return results;
}

export function registerIngestHandlers(): void {
  ipcMain.handle('ingest:run', async (_event, projectName: string, files?: string[]) => {
    return runIngest(projectName, files);
  });
}
