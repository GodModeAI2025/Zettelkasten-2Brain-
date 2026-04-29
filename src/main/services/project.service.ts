import { readdir, mkdir, readFile, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { GitService } from './git.service';
import { Vault, WIKI_SUB_INDEXES, WIKI_CATEGORIES, today, generateWikilinkMap, updateIndexes } from '../core/vault';
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

interface ProjectCreateOptions {
  name: string;
  domain: string;
  language: string;
  tags?: string[];
}

function getRepoDir(): string {
  const dir = GitService.getRepoDir();
  if (!dir) throw new Error('Kein Repository geklont.');
  return dir;
}

async function scaffoldProject(opts: ProjectCreateOptions): Promise<{ projectPath: string; vault: Vault; info: ProjectInfo }> {
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

  const tags = Array.isArray(opts.tags) ? opts.tags : [];
  const config = createDefaultConfig(opts.name, opts.domain, opts.language, tags);
  await saveConfig(projectPath, config);

  await generateWikilinkMap(join(projectPath, 'wiki'));

  await installBuiltinSkills(vault.outputDir);

  await BrandService.installDefaults(projectPath);

  return {
    projectPath,
    vault,
    info: { name: opts.name, domain: opts.domain, language: opts.language },
  };
}

function nextDemoProjectName(): string {
  const repoDir = getRepoDir();
  const base = 'demo-wissensraum';
  if (!existsSync(join(repoDir, base))) return base;

  for (let index = 2; index < 1000; index++) {
    const candidate = `${base}-${index}`;
    if (!existsSync(join(repoDir, candidate))) return candidate;
  }

  throw new Error('Kein freier Demo-Projektname gefunden.');
}

function wikiPageFrontmatter(input: {
  title: string;
  type: string;
  status: string;
  confidence: string;
  reviewed: boolean;
  sources?: string[];
  tags: string[];
  date: string;
}): string {
  const sources = input.sources && input.sources.length > 0 ? `sources: [${input.sources.join(', ')}]\n` : '';
  return `---
title: ${input.title}
type: ${input.type}
status: ${input.status}
confidence: ${input.confidence}
reviewed: ${input.reviewed}
${sources}tags: [${input.tags.join(', ')}]
created: ${input.date}
updated: ${input.date}
---
`;
}

async function writeDemoWorkspace(vault: Vault): Promise<void> {
  const date = today();
  const sourceFile = 'demo-zettelkasten.md';
  const sourceRef = [sourceFile];

  await vault.writeFile(
    `raw/${sourceFile}`,
    `# Demo-Notiz: Lokaler KI-Wissensraum

Datum: ${date}
Kontext: Ein kleines Team will Rohdaten, Entscheidungen und wiederholbare Ablaeufe in einem Git-basierten Wissensraum pflegen.

Beobachtungen:
- Rohdaten bleiben unveraendert im Ordner raw.
- Jede extrahierte Erkenntnis landet als Wiki-Seite mit Quellen, Status, Confidence und Review-Feld.
- Lokal-first Arbeit macht das System nachvollziehbar: Git zeigt, was sich wann geaendert hat.
- KI-Ingestion ist nuetzlich, aber nur dann vertrauenswuerdig, wenn unsichere Aussagen markiert und spaeter geprueft werden.
- Ein guter Einstieg braucht ein kleines Beispielprojekt, damit neue Nutzer den gesamten Kreislauf sehen koennen.

Gewuenschter Ablauf:
1. Rohdaten sammeln.
2. Wiki-Seiten erzeugen oder manuell anlegen.
3. Beziehungen ueber Wikilinks sichtbar machen.
4. Review-Status im Inspector pruefen.
5. Aus dem geprueften Wiki ein Briefing generieren.
`
  );

  await vault.writeFile(
    'wiki/sources/demo-zettelkasten.md',
    `${wikiPageFrontmatter({
      title: 'Demo-Zettelkasten',
      type: 'source',
      status: 'confirmed',
      confidence: 'high',
      reviewed: true,
      sources: sourceRef,
      tags: ['demo', 'quelle', 'wissensmanagement'],
      date,
    })}# Demo-Zettelkasten

Diese Quelle beschreibt einen kleinen, lokalen Wissensraum fuer 2Brain. Sie zeigt den Weg von Rohdaten ueber strukturierte Wiki-Seiten bis zu einem wiederverwendbaren Output.

## Kernaussagen

- [[lokal-first|Lokal-first]] sorgt fuer Nachvollziehbarkeit und Besitz der Daten.
- [[ki-ingestion|KI-Ingestion]] hilft beim Start, braucht aber Review.
- [[2brain|2Brain]] verbindet Rohdaten, Wiki, Git und Outputs in einem Arbeitsfluss.
- Der [[demo-workflow|Demo-Workflow]] zeigt, wie daraus ein konkreter Nutzwert entsteht.
`
  );

  await vault.writeFile(
    'wiki/concepts/lokal-first.md',
    `${wikiPageFrontmatter({
      title: 'Lokal-first',
      type: 'concept',
      status: 'confirmed',
      confidence: 'high',
      reviewed: true,
      sources: sourceRef,
      tags: ['demo', 'local-first', 'git'],
      date,
    })}# Lokal-first

Lokal-first bedeutet hier: Der Wissensraum liegt als normale Dateien im geklonten Repository. Dadurch bleiben Rohdaten, Wiki-Seiten und Outputs auch ausserhalb der App lesbar.

## Warum es zaehlt

- Git macht Veraenderungen sichtbar.
- Projektordner koennen getrennt betrachtet und synchronisiert werden.
- Der [[review-loop|Review-Loop]] kann auf echten Dateien statt auf versteckten Datenbankeintraegen arbeiten.

## Beziehung

[[ki-ingestion|KI-Ingestion]] beschleunigt das Anlegen von Seiten, waehrend Lokal-first die Kontrolle ueber die Ergebnisse staerkt.
`
  );

  await vault.writeFile(
    'wiki/concepts/ki-ingestion.md',
    `${wikiPageFrontmatter({
      title: 'KI-Ingestion',
      type: 'concept',
      status: 'seed',
      confidence: 'medium',
      reviewed: false,
      sources: sourceRef,
      tags: ['demo', 'ingestion', 'review'],
      date,
    })}# KI-Ingestion

KI-Ingestion wandelt Rohdaten in erste Wiki-Kandidaten um. In diesem Demo-Raum ist die Seite bewusst noch nicht reviewed, damit der Inspector einen echten Prueffall zeigt.

## Nutzen

- Schnellere Extraktion von Begriffen, Entitaeten und Zusammenhaengen.
- Direkte Verknuepfung mit Seiten wie [[lokal-first|Lokal-first]] und [[demo-workflow|Demo-Workflow]].
- Markierung unsicherer Aussagen ueber Status und Confidence.

## Offener Punkt

Vor der Nutzung in Outputs sollte diese Seite geprueft und als reviewed markiert werden.
`
  );

  await vault.writeFile(
    'wiki/entities/2brain.md',
    `${wikiPageFrontmatter({
      title: '2Brain',
      type: 'product',
      status: 'confirmed',
      confidence: 'high',
      reviewed: true,
      sources: sourceRef,
      tags: ['demo', 'produkt', 'wissensraum'],
      date,
    })}# 2Brain

2Brain ist in diesem Demo-Projekt das Werkzeug, das Rohdaten, Wiki-Seiten, Git-Sync, Review und Outputs zusammenfuehrt.

## Rolle im Wissensraum

- Raw-Dateien bleiben als Quelle erhalten.
- Wiki-Seiten machen Aussagen einzeln pruefbar.
- [[demo-workflow|Demo-Workflow]] verbindet die Funktionen zu einem wiederholbaren Ablauf.

## Naechste Verknuepfungen

Siehe [[lokal-first|Lokal-first]], [[ki-ingestion|KI-Ingestion]] und [[review-loop|Review-Loop]].
`
  );

  await vault.writeFile(
    'wiki/syntheses/demo-workflow.md',
    `${wikiPageFrontmatter({
      title: 'Demo-Workflow',
      type: 'synthesis',
      status: 'confirmed',
      confidence: 'high',
      reviewed: true,
      sources: sourceRef,
      tags: ['demo', 'workflow', 'output'],
      date,
    })}# Demo-Workflow

Der Demo-Workflow zeigt den wertvollsten Kreislauf im Produkt:

1. Rohdaten in raw sammeln.
2. Aussagen als Wiki-Seiten strukturieren.
3. Beziehungen ueber Wikilinks sichtbar machen.
4. Metadaten im Inspector pruefen.
5. Aus reviewed Wissen einen Output erzeugen.

## Warum das wichtig ist

Der Ablauf verbindet [[lokal-first|Lokal-first]] mit [[ki-ingestion|KI-Ingestion]]. So entsteht ein Wissensraum, der nicht nur Inhalte speichert, sondern Entscheidungen und Folgeprodukte vorbereitet.
`
  );

  await vault.writeFile(
    'wiki/sops/review-loop.md',
    `${wikiPageFrontmatter({
      title: 'Review-Loop',
      type: 'sop',
      status: 'confirmed',
      confidence: 'high',
      reviewed: true,
      sources: sourceRef,
      tags: ['demo', 'review', 'qualitaet'],
      date,
    })}# Review-Loop

Dieser Ablauf haelt KI-gestuetzte Wiki-Seiten belastbar.

## Schritte

1. Neue oder unsichere Seiten in der Wiki-Ansicht oeffnen.
2. Quellen, Status und Confidence im Inspector pruefen.
3. Tags und Beziehungen ergaenzen.
4. \`reviewed\` erst aktivieren, wenn die Seite fachlich stimmt.
5. Danach kann die Seite in Outputs wie dem Demo-Briefing verwendet werden.

## Bezug

Der Review-Loop schuetzt den [[demo-workflow|Demo-Workflow]] vor ungeprueften Zwischenergebnissen.
`
  );

  await vault.writeFile(
    'wiki/decisions/demo-als-erster-einstieg.md',
    `${wikiPageFrontmatter({
      title: 'Demo als erster Einstieg',
      type: 'decision',
      status: 'confirmed',
      confidence: 'high',
      reviewed: true,
      sources: sourceRef,
      tags: ['demo', 'onboarding', 'entscheidung'],
      date,
    })}# Demo als erster Einstieg

## Entscheidung

Ein vorbereiteter Demo-Wissensraum wird als schneller Einstieg angeboten.

## Begruendung

Neue Nutzer verstehen das Produkt schneller, wenn sie sofort einen kleinen, vernetzten Raum sehen: Quelle, Konzepte, Entitaet, Synthese, SOP, Entscheidung und Output.

## Folge

Der Demo-Raum sollte klein bleiben und den [[demo-workflow|Demo-Workflow]] sichtbar machen, statt reale Projekte zu simulieren.
`
  );

  await vault.writeFile(
    'output/demo-briefing/prompt.md',
    `---
name: demo-briefing
sources: wiki/**/*.md
format: markdown
model: claude-sonnet-4-6
---

Erstelle ein kurzes Management-Briefing zum Demo-Wissensraum.

Struktur:
- Ausgangslage
- Wichtigste Erkenntnisse
- Offene Pruefpunkte
- Empfohlene naechste Schritte

Nutze nur Aussagen aus dem Wiki-Kontext. Hebe hervor, welche Inhalte bereits reviewed sind und welche noch geprueft werden sollten.
`
  );

  await vault.writeFile(
    'output/demo-briefing/output.config.json',
    JSON.stringify({ last_generated: null, source_hash: null, sources_used: [], archived_versions: 0 }, null, 2) + '\n'
  );

  await vault.appendLog(`\n## [${date}] demo | Demo-Wissensraum angelegt\nVerarbeitet: ${sourceFile}\n`);
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

  async create(opts: ProjectCreateOptions): Promise<ProjectInfo> {
    const { info } = await scaffoldProject(opts);
    await this.commitIfNeeded(opts.name, `Projekt erstellt: ${opts.name}`);
    return info;
  },

  async createDemo(): Promise<ProjectInfo> {
    const name = nextDemoProjectName();
    const { projectPath, vault, info } = await scaffoldProject({
      name,
      domain: 'Demo: KI-gestuetztes Wissensmanagement',
      language: 'de',
      tags: ['demo', 'wissensmanagement', 'lokal-first', 'review'],
    });

    await writeDemoWorkspace(vault);
    await updateIndexes(join(projectPath, 'wiki'));
    await generateWikilinkMap(join(projectPath, 'wiki'));
    vault.clearSearchIndex();

    await this.commitIfNeeded(name, `Demo-Wissensraum erstellt: ${name}`);
    return info;
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
