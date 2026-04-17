import { ipcMain } from 'electron';
import { ProjectService } from '../services/project.service';
import { loadConfig } from '../core/config';
import { ask, parseClaudeJson } from '../core/claude';
import { generateWikilinkMap, today } from '../core/vault';
import { requireRootPrefix, toScopedRelativePath } from '../core/pathSafety';
import { FORGET_PROMPT } from '../core/prompts/index';

const RAW_PREFIX = 'raw/';

interface ForgetResult {
  operations: Array<{
    action: 'update' | 'delete';
    path: string;
    content?: string;
    reason: string;
  }>;
  delete_source_page: string | null;
  summary: string;
}

export function registerForgetHandlers(): void {
  // Vergessen: Ingest-Markierung zuruecksetzen (Datei bleibt, taucht wieder im Ingest auf)
  ipcMain.handle('forget:reset', async (_event, projectName: string, filename: string) => {
    const vault = ProjectService.getVault(projectName);
    await vault.forgetSource(filename);
    await ProjectService.commitIfNeeded(projectName, `Vergessen: ${filename} (wird beim naechsten Ingest neu verarbeitet)`);
  });

  ipcMain.handle('forget:preview', async (_event, projectName: string, filename: string) => {
    const vault = ProjectService.getVault(projectName);
    const rawPath = toScopedRelativePath('raw', filename);
    const normalizedFile = rawPath.slice(RAW_PREFIX.length);

    const allPages = await vault.listWikiPages();
    const pages = await Promise.all(allPages.map((p) => vault.readWikiPage(p)));
    const affectedPages = pages
      .filter((page) => page.content.includes(normalizedFile))
      .map((page) => page.relativePath);

    return { affectedPages };
  });

  ipcMain.handle('forget:execute', async (_event, projectName: string, filename: string) => {
    const vault = ProjectService.getVault(projectName);
    const config = await loadConfig(ProjectService.getProjectPath(projectName));
    const rawPath = toScopedRelativePath('raw', filename);
    const normalizedFile = rawPath.slice(RAW_PREFIX.length);

    const rawExists = await vault.fileExists(rawPath);
    if (!rawExists) {
      throw new Error(`Datei nicht gefunden: ${rawPath}`);
    }

    const allPages = await vault.listWikiPages();
    const pages = await Promise.all(allPages.map((p) => vault.readWikiPage(p)));
    const affectedPages = pages
      .filter((page) => page.content.includes(normalizedFile))
      .map((page) => ({ path: page.relativePath, content: page.content }));

    if (affectedPages.length === 0) {
      return { operations: [], summary: 'Keine Wiki-Seiten referenzieren diese Quelle.' };
    }

    const pagesContext = affectedPages
      .map((page) => `--- ${page.path} ---\n${page.content}`)
      .join('\n\n');

    const prompt = `## Zu vergessende Quelle
Dateiname: ${normalizedFile}

## Betroffene Wiki-Seiten
${pagesContext}

Entferne alle Informationen die AUSSCHLIESSLICH aus "${normalizedFile}" stammen.`;

    const response = await ask({
      system: FORGET_PROMPT,
      prompt,
      model: config.models.ingest,
      maxTokens: 16384,
    });

    const result = parseClaudeJson<ForgetResult>(response.text);
    if (!result) {
      throw new Error('Claude hat kein strukturiertes JSON zurueckgegeben.');
    }

    for (const op of result.operations) {
      try {
        const safePath = requireRootPrefix(op.path, 'wiki');
        if (op.action === 'update' && typeof op.content === 'string') {
          await vault.writeFile(safePath, op.content);
        } else if (op.action === 'delete') {
          await vault.deleteFile(safePath);
        }
      } catch {
        // Unsicherer Pfad, uebersprungen
      }
    }

    if (result.delete_source_page) {
      try {
        const safeSourcePath = requireRootPrefix(result.delete_source_page, 'wiki');
        await vault.deleteFile(safeSourcePath);
      } catch {
        // Source-Seite nicht geloescht
      }
    }

    await vault.appendLog(`\n## [${today()}] forget | ${normalizedFile}\n${result.summary}\n`);

    await generateWikilinkMap(vault.wikiDir);
    await ProjectService.commitIfNeeded(projectName, `Forget: ${normalizedFile}`);

    return result;
  });
}
