import { ipcMain, BrowserWindow } from 'electron';
import { readFile, writeFile, readdir, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { ProjectService } from '../services/project.service';
import { loadConfig } from '../core/config';
import { askStreaming, parseClaudeJson } from '../core/claude';
import { buildWikiContext } from '../core/wiki-context';
import { QUERY_PROMPT } from '../core/prompts/index';
import { buildBrandContextBlock } from '../services/brand.service';
import type { ChatSession } from '../../shared/api.types';

const RELEVANT_PAGE_LIMIT = 14;
const MAX_QUERY_CONTEXT_CHARS = 80_000;

interface QueryResult {
  answer: string;
  sources_used: string[];
  confidence: 'high' | 'medium' | 'low';
  confidence_reasoning?: string;
  staleness_warnings?: string[];
  save_as_synthesis: boolean;
  synthesis_title?: string;
}

function chatDir(projectName: string): string {
  return join(ProjectService.getProjectPath(projectName), '.chat');
}

async function ensureChatDir(projectName: string): Promise<string> {
  const dir = chatDir(projectName);
  await mkdir(dir, { recursive: true });
  return dir;
}

export function registerQueryHandlers(): void {
  ipcMain.handle('query:list-sessions', async (_event, projectName: string) => {
    const dir = chatDir(projectName);
    let files: string[];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
    } catch {
      return [];
    }

    const sessions: Array<{ id: string; title: string; created: string; updated: string; messageCount: number }> = [];
    for (const file of files) {
      try {
        const raw = await readFile(join(dir, file), 'utf-8');
        const session = JSON.parse(raw) as ChatSession;
        sessions.push({
          id: session.id,
          title: session.title,
          created: session.created,
          updated: session.updated,
          messageCount: session.messages.length,
        });
      } catch {
        // Korrupte Datei ignorieren
      }
    }

    return sessions.sort((a, b) => b.updated.localeCompare(a.updated));
  });

  ipcMain.handle('query:load-session', async (_event, projectName: string, sessionId: string) => {
    const filePath = join(chatDir(projectName), `${sessionId}.json`);
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as ChatSession;
  });

  ipcMain.handle('query:save-session', async (_event, projectName: string, session: ChatSession) => {
    const dir = await ensureChatDir(projectName);
    await writeFile(join(dir, `${session.id}.json`), JSON.stringify(session, null, 2), 'utf-8');
  });

  ipcMain.handle('query:delete-session', async (_event, projectName: string, sessionId: string) => {
    const filePath = join(chatDir(projectName), `${sessionId}.json`);
    await unlink(filePath);
  });

  ipcMain.handle('query:ask', async (_event, projectName: string, question: string) => {
    const vault = ProjectService.getVault(projectName);
    const config = await loadConfig(ProjectService.getProjectPath(projectName));

    const keywords = question
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .split(/\s+/)
      .filter((w) => w.length > 3);
    // Compound-Loop-Schutz: unreviewed Seiten sind Claude-Output.
    // Wir fragen mehr an und filtern, damit der Kontext mit reviewten Seiten aufgefuellt wird.
    const rawRelevant = await vault.findRelevantPages(keywords, {
      limit: RELEVANT_PAGE_LIMIT * 2,
    });
    const relevantPages = rawRelevant
      .filter((p) => p.frontmatter.reviewed !== false)
      .slice(0, RELEVANT_PAGE_LIMIT);

    let indexContent = '';
    try {
      indexContent = await vault.readFile('wiki/index.md');
    } catch {
      // Kein Index vorhanden
    }

    const wikiContext = buildWikiContext(relevantPages, MAX_QUERY_CONTEXT_CHARS);
    const brandBlock = await buildBrandContextBlock(projectName);

    const prompt = `${brandBlock}## Index
${indexContent}

## Relevante Wiki-Seiten
${wikiContext}

## Frage
${question}`;

    let fullResponse = '';
    const windows = BrowserWindow.getAllWindows();

    for await (const chunk of askStreaming({
      system: QUERY_PROMPT,
      prompt,
      model: config.models.query,
      maxTokens: 8192,
    })) {
      fullResponse += chunk;
      for (const win of windows) {
        win.webContents.send('query:stream-chunk', { chunk });
      }
    }

    const result = parseClaudeJson<QueryResult>(fullResponse);

    const finalResult = result || {
      answer: fullResponse,
      sources_used: [],
      confidence: 'medium' as const,
      save_as_synthesis: false,
    };

    for (const win of windows) {
      win.webContents.send('query:stream-end', { result: finalResult });
    }

    return finalResult;
  });
}
