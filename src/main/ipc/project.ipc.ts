import { ipcMain } from 'electron';
import { basename } from 'path';
import { ProjectService } from '../services/project.service';
import { loadConfig } from '../core/config';
import { askForJson } from '../core/claude';
import { isSystemPage } from '../core/vault';

type TaxonomyField = 'entityTypes' | 'conceptTypes' | 'tags';

const TAXONOMY_SYSTEM_PROMPT = `Du bist ein Taxonomie-Assistent fuer ein Zettelkasten-Wiki. Analysiere die gelieferten Rohdaten und Wiki-Inhalte und schlage eine knappe, praezise Taxonomie-Liste vor.

Regeln:
- Nur deutsche Begriffe, Kleinbuchstaben, ohne Leerzeichen (nutze Bindestriche).
- 4 bis 12 Eintraege. Keine Dubletten. Keine zu allgemeinen Begriffe wie "sonstiges".
- Die Liste muss sich direkt aus den gelieferten Inhalten ableiten lassen.

Antwort-Format (JSON in Codeblock):
\`\`\`json
{
  "suggestions": ["begriff-1", "begriff-2", "..."],
  "reasoning": "Ein Satz zur Begruendung"
}
\`\`\``;

function fieldLabel(field: TaxonomyField): string {
  if (field === 'entityTypes') return 'Entitaets-Typen (z.B. person, organization, product, tool)';
  if (field === 'conceptTypes') return 'Konzept-Typen (z.B. technique, framework, theory, pattern)';
  return 'Tags (thematische Schlagworte)';
}

export function registerProjectHandlers(): void {
  ipcMain.handle('project:list', async () => {
    return ProjectService.list();
  });

  ipcMain.handle('project:suggest-taxonomy', async (_event, projectName: string, field: TaxonomyField) => {
    const vault = ProjectService.getVault(projectName);
    const config = await loadConfig(ProjectService.getProjectPath(projectName));

    const rawFiles = await vault.listRawFiles();
    const rawSamples: string[] = [];
    for (const f of rawFiles.slice(0, 10)) {
      try {
        const content = await vault.readFile(`raw/${f}`);
        rawSamples.push(`### ${f}\n\n${content.slice(0, 4000)}`);
      } catch {
        /* skip binary */
      }
    }

    const wikiPages = await vault.loadAllWikiPages();
    const contentPages = wikiPages.filter((p) => !isSystemPage(basename(p.relativePath, '.md')));
    const wikiSummaries = contentPages
      .slice(0, 40)
      .map((p) => {
        const tags = Array.isArray(p.frontmatter.tags) ? (p.frontmatter.tags as string[]).join(', ') : '';
        const type = p.frontmatter.type || '';
        return `- ${p.relativePath} (type: ${type}, tags: ${tags})`;
      })
      .join('\n');

    const existing: string[] = field === 'tags'
      ? config.ingest.tags
      : field === 'entityTypes'
        ? config.ingest.entityTypes
        : config.ingest.conceptTypes;

    const prompt = `## Aufgabe

Schlage die Liste \`${field}\` neu vor — also: ${fieldLabel(field)}.

## Projekt-Kontext

Themenfeld: ${config.domain || '(keins)'}
Sprache: ${config.language === 'de' ? 'Deutsch' : 'English'}

## Bisherige Belegung von ${field}

${existing.length > 0 ? existing.join(', ') : '(leer)'}

## Rohdaten-Auszug (erste ${rawSamples.length} Dateien, je max. 4000 Zeichen)

${rawSamples.length > 0 ? rawSamples.join('\n\n---\n\n') : '(keine Rohdaten vorhanden)'}

## Bestehende Wiki-Seiten (${contentPages.length} gesamt)

${wikiSummaries || '(noch keine Wiki-Seiten)'}

Schlage nun die Liste vor. Bevorzuge Begriffe, die im Material wiederholt vorkommen.`;

    const { result } = await askForJson<{ suggestions: string[]; reasoning: string }>({
      system: TAXONOMY_SYSTEM_PROMPT,
      prompt,
      model: config.models.lint,
      maxTokens: 1024,
    });

    if (!result || !Array.isArray(result.suggestions)) {
      throw new Error('Kein gueltiger Vorschlag von Claude.');
    }

    const cleaned = result.suggestions
      .map((s) => String(s).trim().toLowerCase())
      .filter(Boolean);

    return { suggestions: cleaned, reasoning: result.reasoning ?? '' };
  });

  ipcMain.handle('project:create', async (_event, opts: { name: string; domain: string; language: string; tags: string[] }) => {
    return ProjectService.create(opts);
  });

  ipcMain.handle('project:delete', async (_event, name: string) => {
    return ProjectService.delete(name);
  });

  ipcMain.handle('project:get-config', async (_event, name: string) => {
    return ProjectService.getConfig(name);
  });

  ipcMain.handle('project:set-config', async (_event, name: string, cfg: Record<string, unknown>) => {
    return ProjectService.setConfig(name, cfg);
  });

  ipcMain.handle('project:get-status', async (_event, name: string) => {
    return ProjectService.getStatus(name);
  });
}
