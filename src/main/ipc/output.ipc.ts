import { ipcMain, BrowserWindow } from 'electron';
import { readFile, writeFile, copyFile, mkdir, readdir } from 'fs/promises';
import { join, basename, extname } from 'path';
import { existsSync } from 'fs';
import { glob } from 'glob';
import { createHash } from 'crypto';
import AdmZip from 'adm-zip';
import { ProjectService } from '../services/project.service';
import { ask } from '../core/claude';
import { nowISO } from '../core/vault';
import { BUILTIN_SKILLS, installBuiltinSkills } from '../core/skills/builtin';
import { buildBrandContextBlock } from '../services/brand.service';
import type { OutputInfo, OutputSourceReadiness } from '../../shared/api.types';

interface SourceEntry {
  sf: string;
  content: string;
  isUnreviewed: boolean;
}

interface SkillInfo {
  name: string;
  description: string;
  preview: string;
}

function skillsDir(vault: { outputDir: string }): string {
  return join(vault.outputDir, '_skills');
}

interface ParsedPrompt {
  sources: string;
  format: string;
  model: string;
  skills: string[];
  body: string;
}

const PROMPT_DEFAULTS: ParsedPrompt = {
  sources: 'wiki/**/*.md',
  format: 'markdown',
  model: 'claude-sonnet-4-6',
  skills: [],
  body: '',
};

const EMPTY_SOURCE_READINESS: OutputSourceReadiness = {
  sourceCount: 0,
  includedCount: 0,
  skippedUnreviewedCount: 0,
  skippedUnreviewed: [],
};

function parsePromptFile(raw: string): ParsedPrompt {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) return { ...PROMPT_DEFAULTS, body: raw };

  const result = { ...PROMPT_DEFAULTS, body: fmMatch[2].trim() };
  for (const line of fmMatch[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key === 'sources') result.sources = value;
    else if (key === 'format') result.format = value;
    else if (key === 'model') result.model = value;
    else if (key === 'skills') result.skills = value.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return result;
}

function isUnreviewedWikiSource(content: string): boolean {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  return fmMatch ? /^reviewed:\s*false\b/m.test(fmMatch[1]) : false;
}

async function readSourceEntries(
  projectPath: string,
  sourcesPattern: string,
  opts: { strict?: boolean } = {},
): Promise<SourceEntry[]> {
  const sourceFiles = opts.strict
    ? await glob(sourcesPattern, { cwd: projectPath, nodir: true })
    : await glob(sourcesPattern, { cwd: projectPath, nodir: true }).catch(() => []);

  const loadEntry = async (sf: string): Promise<SourceEntry> => {
    const content = await readFile(join(projectPath, sf), 'utf-8');
    return { sf, content, isUnreviewed: isUnreviewedWikiSource(content) };
  };

  if (opts.strict) {
    return Promise.all(sourceFiles.map(loadEntry));
  }

  const entries = await Promise.all(
    sourceFiles.map(async (sf) => {
      try {
        return await loadEntry(sf);
      } catch {
        return null;
      }
    })
  );

  return entries.filter((entry): entry is SourceEntry => entry !== null);
}

async function inspectSourceReadiness(projectPath: string, sourcesPattern: string): Promise<OutputSourceReadiness> {
  const entries = await readSourceEntries(projectPath, sourcesPattern);
  const skippedUnreviewed = entries
    .filter((entry) => entry.isUnreviewed)
    .map((entry) => entry.sf)
    .sort((a, b) => a.localeCompare(b));

  return {
    sourceCount: entries.length,
    includedCount: entries.length - skippedUnreviewed.length,
    skippedUnreviewedCount: skippedUnreviewed.length,
    skippedUnreviewed,
  };
}

function formatSourceContents(entries: SourceEntry[]): string[] {
  return entries.map((entry) => `--- ${entry.sf} ---\n${entry.content}`);
}

function sendOutputProgress(outputName: string, phase: string, message: string): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send('output:progress', { outputName, phase, message });
  }
}

async function generateInBackground(projectName: string, outputName: string): Promise<void> {
  const projectPath = ProjectService.getProjectPath(projectName);
  const vault = ProjectService.getVault(projectName);
  const outputDir = join(vault.outputDir, outputName);
  const promptPath = join(outputDir, 'prompt.md');
  const configPath = join(outputDir, 'output.config.json');

  if (!existsSync(promptPath)) {
    throw new Error(`Output "${outputName}" nicht gefunden.`);
  }

  sendOutputProgress(outputName, 'generating', 'Lese Prompt und Quellen...');

  const parsed = parsePromptFile(await readFile(promptPath, 'utf-8'));
  const { sources: sourcesPattern, format, model, skills: attachedSkills, body: promptBody } = parsed;

  // Skills aufloesen
  const skillDir = skillsDir(vault);
  const skillContents: string[] = [];
  for (const skillName of attachedSkills) {
    for (const ext of ['.md', '.skill', '']) {
      const skillPath = join(skillDir, skillName + ext);
      if (existsSync(skillPath)) {
        const raw = await readFile(skillPath, 'utf-8');
        const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
        skillContents.push(`## Skill: ${skillName}\n\n${body}`);
        break;
      }
    }
  }

  const fullSystemPrompt = skillContents.length > 0
    ? `${skillContents.join('\n\n---\n\n')}\n\n---\n\n## Aufgabe\n\n${promptBody}`
    : promptBody;

  // Compound-Loop-Schutz: unreviewed Wiki-Seiten werden nicht in Outputs integriert.
  const readEntries = await readSourceEntries(projectPath, sourcesPattern, { strict: true });
  const kept = readEntries.filter((e) => !e.isUnreviewed);
  const skippedCount = readEntries.length - kept.length;
  const sourceFiles = kept.map((e) => e.sf);
  const sourceContents = formatSourceContents(kept);

  const skipNote = skippedCount > 0 ? ` (${skippedCount} unreviewed uebersprungen)` : '';
  sendOutputProgress(outputName, 'generating', `${sourceFiles.length} Quellen geladen${skipNote}. Warte auf Claude...`);

  const currentHash = createHash('md5').update(sourceContents.join('\n')).digest('hex');

  let outputConfig = { last_generated: null as string | null, source_hash: null as string | null, sources_used: [] as string[], archived_versions: 0 };
  try {
    outputConfig = JSON.parse(await readFile(configPath, 'utf-8'));
  } catch {
    // Neue Config
  }

  const brandBlock = await buildBrandContextBlock(projectName);
  const response = await ask({
    system: fullSystemPrompt,
    prompt: `${brandBlock}## Wiki-Kontext\n\n${sourceContents.join('\n\n')}\n\n## Aufgabe\n\nGeneriere den Output gemaess den obigen Anweisungen. Format: ${format}`,
    model,
    maxTokens: 16384,
  });

  sendOutputProgress(outputName, 'generating', 'Ergebnis schreiben...');

  const ext = format === 'html' ? 'html' : 'md';
  const resultPath = join(outputDir, `result.${ext}`);

  if (existsSync(resultPath)) {
    const archivDir = join(outputDir, 'archiv');
    if (!existsSync(archivDir)) await mkdir(archivDir, { recursive: true });
    await copyFile(resultPath, join(archivDir, `${nowISO()}.${ext}`));
    outputConfig.archived_versions++;
  }

  await writeFile(resultPath, response.text, 'utf-8');

  outputConfig.last_generated = new Date().toISOString();
  outputConfig.source_hash = currentHash;
  outputConfig.sources_used = sourceFiles;
  await writeFile(configPath, JSON.stringify(outputConfig, null, 2), 'utf-8');

  await ProjectService.commitIfNeeded(projectName, `Output generiert: ${outputName}`);

  sendOutputProgress(outputName, 'complete', `"${outputName}" generiert (${response.usage.inputTokens.toLocaleString('de')} Input / ${response.usage.outputTokens.toLocaleString('de')} Output Tokens)`);
}

/**
 * Prüft alle Outputs auf veraltete Quellen und regeneriert betroffene im Hintergrund.
 * Wird nach Ingest und Lint:fix aufgerufen.
 */
export async function checkAndRegenerateOutputs(projectName: string): Promise<void> {
  const vault = ProjectService.getVault(projectName);
  const projectPath = ProjectService.getProjectPath(projectName);
  const configs = await glob('*/output.config.json', { cwd: vault.outputDir }).catch(() => []);

  for (const configFile of configs) {
    const outputName = configFile.split('/')[0];
    try {
      const config = JSON.parse(await readFile(join(vault.outputDir, configFile), 'utf-8'));
      if (!config.source_hash) continue; // Noch nie generiert

      const promptPath = join(vault.outputDir, outputName, 'prompt.md');
      if (!existsSync(promptPath)) continue;

      const parsed = parsePromptFile(await readFile(promptPath, 'utf-8'));
      // Hash ignoriert unreviewed Seiten, damit Auto-Update nicht durch Claude-Output getriggert wird.
      const readEntries = await readSourceEntries(projectPath, parsed.sources, { strict: true });
      const reviewedContents = formatSourceContents(readEntries.filter((entry) => !entry.isUnreviewed));
      const currentHash = createHash('md5').update(reviewedContents.join('\n')).digest('hex');

      if (currentHash !== config.source_hash) {
        sendOutputProgress(outputName, 'generating', 'Auto-Update: Quellen haben sich geaendert...');
        generateInBackground(projectName, outputName).catch((err) => {
          sendOutputProgress(outputName, 'error', `Auto-Update fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    } catch {
      // Fehlerhafte Config ignorieren
    }
  }
}

export function registerOutputHandlers(): void {
  ipcMain.handle('output:list', async (_event, projectName: string) => {
    const vault = ProjectService.getVault(projectName);
    const projectPath = ProjectService.getProjectPath(projectName);
    const configs = await glob('*/output.config.json', { cwd: vault.outputDir }).catch(() => []);
    const results: OutputInfo[] = [];

    for (const configFile of configs) {
      const outputName = configFile.split('/')[0];
      try {
        const content = await readFile(join(vault.outputDir, configFile), 'utf-8');
        const config = JSON.parse(content);

        const promptPath = join(vault.outputDir, outputName, 'prompt.md');
        let parsed = PROMPT_DEFAULTS;
        try {
          parsed = parsePromptFile(await readFile(promptPath, 'utf-8'));
        } catch { /* Kein Prompt vorhanden */ }
        const sourceReadiness = await inspectSourceReadiness(projectPath, parsed.sources);

        results.push({
          name: outputName,
          lastGenerated: config.last_generated || null,
          format: parsed.format,
          promptPreview: parsed.body.slice(0, 200),
          sourcesPattern: parsed.sources,
          model: parsed.model,
          skills: parsed.skills,
          sourceReadiness,
        });
      } catch {
        results.push({ name: outputName, lastGenerated: null, format: 'markdown', promptPreview: '', sourcesPattern: 'wiki/**/*.md', model: 'claude-sonnet-4-6', skills: [], sourceReadiness: EMPTY_SOURCE_READINESS });
      }
    }

    return results;
  });

  ipcMain.handle('output:create', async (_event, projectName: string, opts: {
    name: string;
    sources: string;
    format: string;
    model: string;
    prompt: string;
  }) => {
    const vault = ProjectService.getVault(projectName);
    const outputDir = join(vault.outputDir, opts.name);
    await mkdir(join(outputDir, 'archiv'), { recursive: true });

    const promptContent = `---
name: ${opts.name}
sources: ${opts.sources}
format: ${opts.format}
model: ${opts.model}
---

${opts.prompt}
`;

    await writeFile(join(outputDir, 'prompt.md'), promptContent, 'utf-8');
    await writeFile(
      join(outputDir, 'output.config.json'),
      JSON.stringify({ last_generated: null, source_hash: null, sources_used: [], archived_versions: 0 }, null, 2),
      'utf-8'
    );

    await ProjectService.commitIfNeeded(projectName, `Skill erstellt: ${opts.name}`);

    return {
      name: opts.name,
      lastGenerated: null,
      format: opts.format,
      promptPreview: opts.prompt.slice(0, 200),
      sourcesPattern: opts.sources,
      model: opts.model,
      skills: [],
      sourceReadiness: await inspectSourceReadiness(ProjectService.getProjectPath(projectName), opts.sources),
    };
  });

  ipcMain.handle('output:generate', async (_event, projectName: string, outputName: string) => {
    // Fire-and-forget: Generierung im Hintergrund, Events ueber output:progress
    generateInBackground(projectName, outputName).catch((err) => {
      sendOutputProgress(outputName, 'error', `Generierung fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    });
    return { started: true };
  });

  ipcMain.handle('output:read-result', async (_event, projectName: string, outputName: string) => {
    const vault = ProjectService.getVault(projectName);
    const outputDir = join(vault.outputDir, outputName);

    for (const ext of ['md', 'html']) {
      const p = join(outputDir, `result.${ext}`);
      if (existsSync(p)) {
        return readFile(p, 'utf-8');
      }
    }

    throw new Error('Kein Ergebnis vorhanden. Bitte zuerst generieren.');
  });

  ipcMain.handle('output:read-prompt', async (_event, projectName: string, outputName: string) => {
    const vault = ProjectService.getVault(projectName);
    const promptPath = join(vault.outputDir, outputName, 'prompt.md');

    if (!existsSync(promptPath)) {
      throw new Error('Kein Prompt vorhanden.');
    }

    return parsePromptFile(await readFile(promptPath, 'utf-8'));
  });

  ipcMain.handle('output:save-prompt', async (_event, projectName: string, outputName: string, opts: {
    sources: string;
    format: string;
    model: string;
    skills: string[];
    body: string;
  }) => {
    const vault = ProjectService.getVault(projectName);
    const outputDir = join(vault.outputDir, outputName);
    const promptPath = join(outputDir, 'prompt.md');

    const skillsLine = opts.skills && opts.skills.length > 0 ? `\nskills: ${opts.skills.join(', ')}` : '';
    const content = `---
name: ${outputName}
sources: ${opts.sources}
format: ${opts.format}
model: ${opts.model}${skillsLine}
---

${opts.body}
`;

    await writeFile(promptPath, content, 'utf-8');
    await ProjectService.commitIfNeeded(projectName, `Skill aktualisiert: ${outputName}`);
  });

  ipcMain.handle('output:delete', async (_event, projectName: string, outputName: string) => {
    const vault = ProjectService.getVault(projectName);
    const outputDir = join(vault.outputDir, outputName);
    const { rm } = await import('fs/promises');
    await rm(outputDir, { recursive: true, force: true });
    await ProjectService.commitIfNeeded(projectName, `Output geloescht: ${outputName}`);
  });

  // === Skill-Verwaltung ===

  ipcMain.handle('skill:list', async (_event, projectName: string): Promise<SkillInfo[]> => {
    const vault = ProjectService.getVault(projectName);
    const dir = skillsDir(vault);
    if (!existsSync(dir)) return [];

    const files = await readdir(dir);
    const results: SkillInfo[] = [];

    for (const file of files) {
      const ext = extname(file).toLowerCase();
      if (ext !== '.md' && ext !== '.skill') continue;

      const name = basename(file, ext);
      try {
        const raw = await readFile(join(dir, file), 'utf-8');
        let description = '';
        let preview = raw.trim().slice(0, 200);

        const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
        if (fmMatch) {
          for (const line of fmMatch[1].split('\n')) {
            const [key, ...val] = line.split(':');
            if (key.trim() === 'description') description = val.join(':').trim();
          }
          preview = fmMatch[2].trim().slice(0, 200);
        }

        results.push({ name, description, preview });
      } catch {
        results.push({ name, description: '', preview: '' });
      }
    }

    return results;
  });

  ipcMain.handle('skill:read', async (_event, projectName: string, skillName: string): Promise<string> => {
    const vault = ProjectService.getVault(projectName);
    const dir = skillsDir(vault);

    for (const ext of ['.md', '.skill']) {
      const p = join(dir, skillName + ext);
      if (existsSync(p)) return readFile(p, 'utf-8');
    }
    throw new Error(`Skill "${skillName}" nicht gefunden.`);
  });

  ipcMain.handle('skill:save', async (_event, projectName: string, skillName: string, content: string) => {
    const vault = ProjectService.getVault(projectName);
    const dir = skillsDir(vault);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });

    await writeFile(join(dir, skillName + '.md'), content, 'utf-8');
    await ProjectService.commitIfNeeded(projectName, `Skill gespeichert: ${skillName}`);
  });

  ipcMain.handle('skill:delete', async (_event, projectName: string, skillName: string) => {
    const vault = ProjectService.getVault(projectName);
    const dir = skillsDir(vault);
    const { rm } = await import('fs/promises');

    for (const ext of ['.md', '.skill']) {
      const p = join(dir, skillName + ext);
      if (existsSync(p)) await rm(p);
    }
    await ProjectService.commitIfNeeded(projectName, `Skill geloescht: ${skillName}`);
  });

  ipcMain.handle('skill:list-builtin', async (): Promise<Array<{ name: string; description: string }>> => {
    return BUILTIN_SKILLS.map((s) => ({ name: s.name, description: s.description }));
  });

  ipcMain.handle('skill:install-builtin', async (_event, projectName: string): Promise<string[]> => {
    const vault = ProjectService.getVault(projectName);
    const installed = await installBuiltinSkills(vault.outputDir);
    if (installed.length > 0) {
      await ProjectService.commitIfNeeded(projectName, `Built-in Skills installiert: ${installed.join(', ')}`);
    }
    return installed;
  });

  ipcMain.handle('skill:import', async (_event, projectName: string, files: Array<{ name: string; data: ArrayBuffer }>) => {
    const vault = ProjectService.getVault(projectName);
    const dir = skillsDir(vault);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });

    const results: Array<{ name: string; success: boolean; error?: string }> = [];

    for (const file of files) {
      const ext = extname(file.name).toLowerCase();
      const buffer = Buffer.from(file.data);

      try {
        if (ext === '.md') {
          // Markdown-Skill: direkt uebernehmen
          const content = buffer.toString('utf-8');
          const name = basename(file.name, '.md');
          await writeFile(join(dir, name + '.md'), content, 'utf-8');
          results.push({ name, success: true });

        } else if (ext === '.skill') {
          // .skill = ZIP-Container: SKILL.md extrahieren
          const zip = new AdmZip(buffer);
          const entries = zip.getEntries();

          // SKILL.md suchen — kann direkt im Root oder in einem Unterordner liegen
          let skillEntry = entries.find((e) => e.entryName === 'SKILL.md');
          if (!skillEntry) {
            skillEntry = entries.find((e) => e.entryName.endsWith('/SKILL.md') && !e.entryName.includes('__MACOSX'));
          }

          if (!skillEntry) {
            results.push({ name: file.name, success: false, error: 'Keine SKILL.md im Archiv gefunden' });
            continue;
          }

          const content = skillEntry.getData().toString('utf-8');

          // Name aus Frontmatter oder Dateiname ableiten
          let skillName = basename(file.name, '.skill');
          const nameMatch = content.match(/^---\n[\s\S]*?^name:\s*(.+)/m);
          if (nameMatch) {
            skillName = nameMatch[1].trim();
          }

          // SKILL.md als Haupt-Skill speichern
          await writeFile(join(dir, skillName + '.md'), content, 'utf-8');

          // Zusaetzliche .md-Dateien im Archiv als Anhaenge speichern
          const extras = entries.filter((e) =>
            e.entryName.endsWith('.md') &&
            e.entryName !== 'SKILL.md' &&
            !e.entryName.endsWith('/SKILL.md') &&
            !e.isDirectory &&
            !e.entryName.includes('__MACOSX')
          );

          if (extras.length > 0) {
            const subDir = join(dir, skillName);
            if (!existsSync(subDir)) await mkdir(subDir, { recursive: true });
            for (const extra of extras) {
              const extraName = basename(extra.entryName);
              await writeFile(join(subDir, extraName), extra.getData().toString('utf-8'), 'utf-8');
            }
          }

          results.push({ name: skillName, success: true });

        } else {
          results.push({ name: file.name, success: false, error: `Format "${ext}" nicht unterstuetzt. Erwartet: .md oder .skill` });
        }
      } catch (err) {
        results.push({ name: file.name, success: false, error: err instanceof Error ? err.message : String(err) });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    if (successCount > 0) {
      const names = results.filter((r) => r.success).map((r) => r.name);
      await ProjectService.commitIfNeeded(projectName, `Skill importiert: ${names.join(', ')}`);
    }

    return results;
  });
}
