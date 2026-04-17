import { readdir, mkdir, readFile, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { GitService } from './git.service';
import { Vault, WIKI_SUB_INDEXES, WIKI_CATEGORIES, today, generateWikilinkMap } from '../core/vault';
import { loadConfig, saveConfig, createDefaultConfig, type BrainConfig } from '../core/config';
import { installBuiltinSkills } from '../core/skills/builtin';
import { BrandService } from './brand.service';

export interface ProjectInfo {
  name: string;
  domain: string;
  language: string;
}

export interface ProjectStatus {
  totalPages: number;
  sources: number;
  entities: number;
  concepts: number;
  synthesis: number;
  syntheses: number;
  sops: number;
  decisions: number;
  confirmed: number;
  seed: number;
  stale: number;
  unreviewed: number;
  rawTotal: number;
  rawNew: number;
  lastIngest: string;
  lastLint: string;
  syncEnabled: boolean;
}

function getRepoDir(): string {
  const dir = GitService.getRepoDir();
  if (!dir) throw new Error('Kein Repository geklont.');
  return dir;
}

export const ProjectService = {
  /** Committet und pusht nur wenn syncEnabled fuer das Projekt aktiv ist.
   *  Scoped auf den Projekt-Ordner, damit Dateien anderer Projekte (inkl.
   *  syncEnabled=false) nicht mit hochgeladen werden. */
  async commitIfNeeded(name: string, message: string): Promise<void> {
    try {
      const config = await loadConfig(this.getProjectPath(name));
      if (config.syncEnabled === false) return;
    } catch {
      // Config nicht ladbar → sicherheitshalber committen
    }
    await GitService.commitAndPush(message, name);
  },

  getProjectPath(name: string): string {
    return join(getRepoDir(), name);
  },

  getVault(name: string): Vault {
    return new Vault(this.getProjectPath(name));
  },

  /**
   * Einmalige Migration pro Projekt:
   *   synthesis/ -> syntheses/ (Rename),
   *   sops/ + decisions/ anlegen (falls fehlend).
   * Gesteuert ueber Marker-Datei, damit pro Projekt nur einmal ausgefuehrt.
   */
  async ensureMigrations(name: string): Promise<void> {
    const projectPath = this.getProjectPath(name);
    const marker = join(projectPath, '.migrations', 'v2-typologie.done');
    if (existsSync(marker)) return;

    const wikiRoot = join(projectPath, 'wiki');
    if (!existsSync(wikiRoot)) return;

    const oldDir = join(wikiRoot, 'synthesis');
    const newDir = join(wikiRoot, 'syntheses');
    let didWork = false;

    if (existsSync(oldDir) && !existsSync(newDir)) {
      await mkdir(newDir, { recursive: true });
      const entries = await readdir(oldDir);
      for (const entry of entries) {
        const srcPath = join(oldDir, entry);
        const destPath = join(newDir, entry);
        try {
          const buf = await readFile(srcPath);
          await writeFile(destPath, buf);
        } catch {
          // ignore single-file read failure
        }
      }
      await rm(oldDir, { recursive: true, force: true });
      didWork = true;
    }

    for (const cat of WIKI_CATEGORIES) {
      const dir = join(wikiRoot, cat);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
        const idx = join(dir, 'index.md');
        if (!existsSync(idx)) {
          await writeFile(idx, WIKI_SUB_INDEXES[cat], 'utf-8');
          didWork = true;
        }
      }
    }

    await mkdir(join(projectPath, '.migrations'), { recursive: true });
    await writeFile(marker, `${new Date().toISOString()}\n`, 'utf-8');

    if (didWork) {
      try {
        await generateWikilinkMap(wikiRoot);
      } catch {
        // Wikilink-Map kann spaeter erneut gebaut werden
      }
      await this.commitIfNeeded(name, `Migration: Wiki-Typologie v2 (synthesis -> syntheses, +sops +decisions)`);
    }
  },

  async list(): Promise<ProjectInfo[]> {
    const repoDir = getRepoDir();
    let entries: string[];
    try {
      entries = await readdir(repoDir);
    } catch {
      return [];
    }

    const projects: ProjectInfo[] = [];
    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      const configPath = join(repoDir, entry, 'zettelkasten.config.json');
      const oldConfigPath = join(repoDir, entry, '2brain.config.json');
      if (!existsSync(configPath) && !existsSync(oldConfigPath)) continue;
      try {
        const config = await loadConfig(join(repoDir, entry));
        projects.push({ name: config.name, domain: config.domain, language: config.language });
        try {
          await this.ensureMigrations(config.name);
        } catch {
          // Migration sollte nie die App-Initialisierung blockieren
        }
      } catch {
        projects.push({ name: entry, domain: '', language: 'de' });
      }
    }
    return projects;
  },

  async create(opts: {
    name: string;
    domain: string;
    language: string;
    tags: string[];
  }): Promise<ProjectInfo> {
    const projectPath = join(getRepoDir(), opts.name);
    if (existsSync(projectPath)) {
      throw new Error(`Projekt "${opts.name}" existiert bereits.`);
    }

    const dirs = [
      'raw',
      'raw/assets',
      ...WIKI_CATEGORIES.map((c) => `wiki/${c}`),
      'output',
      'brand',
    ];

    for (const dir of dirs) {
      await mkdir(join(projectPath, dir), { recursive: true });
    }

    const vault = new Vault(projectPath);

    await vault.writeFile(
      'wiki/index.md',
      `# ${opts.name} — Wiki\n\nMaster-Katalog des Wissens.\n\n## Quellen\n\n## Entitaeten\n\n## Konzepte\n\n## Synthesen\n\n## SOPs\n\n## Entscheidungen\n`
    );

    for (const [dir, content] of Object.entries(WIKI_SUB_INDEXES)) {
      await vault.writeFile(`wiki/${dir}/index.md`, content);
    }

    await vault.writeFile(
      'wiki/log.md',
      `# Wiki-Protokoll\n\n## [${today()}] setup | Wiki initialisiert\nErstellt: "${opts.name}" fuer ${opts.domain || 'allgemeine Nutzung'}.\n`
    );

    const config = createDefaultConfig(opts.name, opts.domain, opts.language, opts.tags);
    await saveConfig(projectPath, config);

    await generateWikilinkMap(join(projectPath, 'wiki'));

    await installBuiltinSkills(vault.outputDir);

    await BrandService.installDefaults(projectPath);

    await this.commitIfNeeded(opts.name, `Projekt erstellt: ${opts.name}`);

    return { name: opts.name, domain: opts.domain, language: opts.language };
  },

  async delete(name: string): Promise<void> {
    const { rm } = await import('fs/promises');
    const projectPath = join(getRepoDir(), name);
    if (!existsSync(projectPath)) {
      throw new Error(`Projekt "${name}" nicht gefunden.`);
    }
    await rm(projectPath, { recursive: true });
    await this.commitIfNeeded(name, `Projekt geloescht: ${name}`);
  },

  async getConfig(name: string): Promise<BrainConfig> {
    return loadConfig(this.getProjectPath(name));
  },

  async setConfig(name: string, patch: Partial<BrainConfig>): Promise<BrainConfig> {
    const projectPath = this.getProjectPath(name);
    const current = await loadConfig(projectPath);
    const merged: BrainConfig = {
      ...current,
      ...patch,
      models: { ...current.models, ...(patch.models || {}) },
      ingest: { ...current.ingest, ...(patch.ingest || {}) },
      output: { ...current.output, ...(patch.output || {}) },
    };
    await saveConfig(projectPath, merged);
    return merged;
  },

  async getStatus(name: string): Promise<ProjectStatus> {
    const vault = this.getVault(name);

    const [allPageFiles, rawFiles, ingested, config] = await Promise.all([
      vault.listWikiPages(),
      vault.listRawFiles(),
      vault.getIngestedSources(),
      loadConfig(this.getProjectPath(name)),
    ]);

    let sources = 0, entities = 0, concepts = 0, syntheses = 0, sops = 0, decisions = 0, legacySynthesis = 0;
    for (const p of allPageFiles) {
      if (p.startsWith('sources/')) sources++;
      else if (p.startsWith('entities/')) entities++;
      else if (p.startsWith('concepts/')) concepts++;
      else if (p.startsWith('syntheses/')) syntheses++;
      else if (p.startsWith('sops/')) sops++;
      else if (p.startsWith('decisions/')) decisions++;
      else if (p.startsWith('synthesis/')) legacySynthesis++;
    }
    const synthesis = syntheses + legacySynthesis;
    const totalPages = sources + entities + concepts + synthesis + sops + decisions;

    const newRaw = rawFiles.filter((f) => !ingested.has(f));

    let lastIngest = '';
    let lastLint = '';
    try {
      const log = await vault.readFile('wiki/log.md');
      const ingestMatch = [...log.matchAll(/## \[(\d{4}-\d{2}-\d{2})\] ingest/g)].pop();
      const lintMatch = [...log.matchAll(/## \[(\d{4}-\d{2}-\d{2})\] lint/g)].pop();
      if (ingestMatch) lastIngest = ingestMatch[1];
      if (lintMatch) lastLint = lintMatch[1];
    } catch {
      // log.md existiert nicht
    }

    const loadedPages = await Promise.all(
      allPageFiles
        .filter((p) => !p.endsWith('index.md') && !p.endsWith('log.md'))
        .map(async (pagePath) => vault.readWikiPage(pagePath))
    );

    let seed = 0, confirmed = 0, stale = 0, unreviewed = 0;
    for (const page of loadedPages) {
      const status = page.frontmatter.status;
      if (status === 'seed') seed++;
      else if (status === 'confirmed') confirmed++;
      else if (status === 'stale') stale++;
      if (page.frontmatter.reviewed === false) unreviewed++;
    }

    return {
      totalPages,
      sources,
      entities,
      concepts,
      synthesis,
      syntheses,
      sops,
      decisions,
      confirmed,
      seed,
      stale,
      unreviewed,
      rawTotal: rawFiles.length,
      rawNew: newRaw.length,
      lastIngest,
      lastLint,
      syncEnabled: config.syncEnabled !== false,
    };
  },
};
