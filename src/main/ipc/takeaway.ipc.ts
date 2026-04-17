import { ipcMain } from 'electron';
import { ProjectService } from '../services/project.service';
import { loadConfig } from '../core/config';
import { ask, askForJson } from '../core/claude';
import { buildWikiContext } from '../core/wiki-context';
import { bm25RankWithIndex } from '../core/search';
import { extractKeywords } from '../core/keywords';
import { today, toPageId, isSystemPage } from '../core/vault';
import { requireRootPrefix } from '../core/pathSafety';
import { TAKEAWAY_DISCUSS_PROMPT, TAKEAWAY_SYNTHESIZE_PROMPT } from '../core/prompts/index';
import { buildBrandContextBlock } from '../services/brand.service';
import { basename } from 'path';

const MAX_CONTEXT_CHARS = 40_000;
const CONTEXT_PAGE_LIMIT = 8;

export interface TakeawayMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface TakeawayDiscussInput {
  projectName: string;
  takeaway: string;
  sourceFile?: string;
  history: TakeawayMessage[];
  question: string;
}

export interface TakeawaySynthesizeInput {
  projectName: string;
  takeaway: string;
  sourceFile?: string;
  history: TakeawayMessage[];
}

function formatHistory(history: TakeawayMessage[]): string {
  if (history.length === 0) return '(bisher kein Austausch)';
  return history
    .map((m) => `**${m.role === 'user' ? 'Nutzer' : 'Assistent'}:**\n${m.content}`)
    .join('\n\n');
}

export function registerTakeawayHandlers(): void {
  ipcMain.handle('takeaway:discuss', async (_event, input: TakeawayDiscussInput): Promise<string> => {
    const { projectName, takeaway, sourceFile, history, question } = input;
    const vault = ProjectService.getVault(projectName);
    const config = await loadConfig(ProjectService.getProjectPath(projectName));

    const { index, pages: allPages } = await vault.getSearchIndex();
    const contentPages = allPages.filter((p) => !isSystemPage(basename(p.relativePath, '.md')));
    const keywords = extractKeywords(`${takeaway}\n\n${question}`, 20);
    const relevant = keywords.length > 0
      ? bm25RankWithIndex(contentPages, keywords, index, { limit: CONTEXT_PAGE_LIMIT })
      : contentPages.slice(0, CONTEXT_PAGE_LIMIT);
    const wikiContext = buildWikiContext(relevant, MAX_CONTEXT_CHARS);

    const allowList = contentPages.map((p) => toPageId(p.relativePath)).sort();
    const brandBlock = await buildBrandContextBlock(projectName);

    const prompt = `${brandBlock}## Kontext

Themenfeld: ${config.domain || 'Allgemein'}
Sprache: ${config.language === 'de' ? 'Deutsch' : 'English'}
Heutiges Datum: ${today()}

## Takeaway

${takeaway}${sourceFile ? `\n\nQuelldatei: ${sourceFile}` : ''}

## Verfuegbare Wiki-Seiten (Allow-List fuer Wikilinks)

${allowList.join(', ') || '(keine Seiten)'}

## Relevante Wiki-Seiten

${wikiContext}

## Bisheriger Austausch

${formatHistory(history)}

## Neue Frage / Impuls des Nutzers

${question}

Antworte direkt — knapp, markant, mit Wikilinks wo sinnvoll.`;

    const response = await ask({
      system: TAKEAWAY_DISCUSS_PROMPT,
      prompt,
      model: config.models.query,
      maxTokens: 4096,
    });

    return response.text;
  });

  ipcMain.handle('takeaway:synthesize', async (_event, input: TakeawaySynthesizeInput): Promise<{ path: string; title: string }> => {
    const { projectName, takeaway, sourceFile, history } = input;
    const vault = ProjectService.getVault(projectName);
    const config = await loadConfig(ProjectService.getProjectPath(projectName));

    const allPages = await vault.loadAllWikiPages();
    const contentPages = allPages.filter((p) => !isSystemPage(basename(p.relativePath, '.md')));
    const allowList = contentPages.map((p) => toPageId(p.relativePath)).sort();
    const brandBlock = await buildBrandContextBlock(projectName);

    const prompt = `${brandBlock}## Kontext

Themenfeld: ${config.domain || 'Allgemein'}
Sprache: ${config.language === 'de' ? 'Deutsch' : 'English'}
Heutiges Datum: ${today()}

## Ursprung

Takeaway: ${takeaway}${sourceFile ? `\nQuelldatei: ${sourceFile}` : ''}

## Existierende Wiki-Seiten (fuer Wikilinks)

${allowList.join(', ') || '(keine Seiten)'}

## Diskussion

${formatHistory(history)}

## Aufgabe

Fasse die Erkenntnisse aus der Diskussion zu einer Synthese-Seite unter \`wiki/syntheses/\` zusammen. Nutze nur Inhalt aus der Diskussion.`;

    const { result } = await askForJson<{ path: string; title: string; content: string }>({
      system: TAKEAWAY_SYNTHESIZE_PROMPT,
      prompt,
      model: config.models.query,
      maxTokens: 8192,
    });

    if (!result || !result.path || !result.content) {
      throw new Error('Synthese-Generierung fehlgeschlagen — kein gueltiges Ergebnis von Claude.');
    }

    const safePath = requireRootPrefix(result.path, 'wiki/syntheses');
    await vault.writeFile(safePath, result.content);
    await vault.appendLog(
      `\n## [${today()}] synthesis | ${safePath}\nSynthese aus Takeaway erstellt: ${result.title}\n`
    );
    await ProjectService.commitIfNeeded(projectName, `Synthese aus Takeaway: ${result.title}`);

    return { path: safePath, title: result.title };
  });
}
