import { readFile, writeFile, stat, mkdir, unlink } from 'fs/promises';
import { join, relative, basename, dirname, resolve, isAbsolute } from 'path';
import { glob } from 'glob';
import { extractWikilinks, linkTargetAliases, pageAliases } from './wikilinks';
import { bm25Rank, bm25RankWithIndex } from './search';
import {
  type SearchIndex,
  refreshIndex,
  getCachedIndex,
  setCachedIndex,
  loadIndexFromDisk,
  saveIndexToDisk,
  emptyIndex,
} from './search-index';

export interface WikiPage {
  path: string;
  relativePath: string;
  content: string;
  contentLower: string;
  frontmatter: Record<string, unknown>;
}

export interface PendingStub {
  slug: string;
  title: string;
  category: string;
  path: string;
  referencedBy: string[];
}

export interface RelevantPageOptions {
  limit?: number;
}

const DEFAULT_RELEVANT_PAGE_LIMIT = 12;
const PENDING_STUBS_PATH = 'wiki/.pending-stubs.json';
const LOG_PATH = 'wiki/log.md';

export function isSystemPage(name: string): boolean {
  return name === 'index' || name === 'log';
}

export function toPageId(pagePath: string): string {
  return pagePath.replace(/^wiki\//, '').replace(/\.md$/i, '').replace(/\\/g, '/');
}

export class Vault {
  public readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  get rawDir(): string {
    return join(this.root, 'raw');
  }
  get wikiDir(): string {
    return join(this.root, 'wiki');
  }
  get outputDir(): string {
    return join(this.root, 'output');
  }

  private resolveWithinVault(relativePath: string): string {
    if (!relativePath || typeof relativePath !== 'string') {
      throw new Error('Leerer Pfad ist nicht erlaubt.');
    }
    if (isAbsolute(relativePath)) {
      throw new Error(`Absolute Pfade sind nicht erlaubt: ${relativePath}`);
    }
    const fullPath = resolve(this.root, relativePath);
    const rel = relative(this.root, fullPath);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`Pfad ausserhalb des Vaults nicht erlaubt: ${relativePath}`);
    }
    return fullPath;
  }

  private resolveWithinWiki(subdir: string): string {
    const fullPath = this.resolveWithinVault(join('wiki', subdir));
    const relToWiki = relative(this.wikiDir, fullPath);
    if (relToWiki.startsWith('..') || isAbsolute(relToWiki)) {
      throw new Error(`Ungueltiges Wiki-Unterverzeichnis: ${subdir}`);
    }
    return fullPath;
  }

  private resolveWithinRaw(rawRelativePath: string): string {
    const fullPath = this.resolveWithinVault(join('raw', rawRelativePath));
    const relToRaw = relative(this.rawDir, fullPath);
    if (relToRaw === '' || relToRaw.startsWith('..') || isAbsolute(relToRaw)) {
      throw new Error(`Ungueltiger Raw-Pfad: ${rawRelativePath}`);
    }
    return fullPath;
  }

  async readFile(relativePath: string): Promise<string> {
    return readFile(this.resolveWithinVault(relativePath), 'utf-8');
  }

  async writeFile(relativePath: string, content: string): Promise<void> {
    const fullPath = this.resolveWithinVault(relativePath);
    const dir = dirname(fullPath);
    await mkdir(dir, { recursive: true });
    await writeFile(fullPath, content, 'utf-8');
  }

  async writeBinary(relativePath: string, data: Buffer): Promise<void> {
    const fullPath = this.resolveWithinVault(relativePath);
    const dir = dirname(fullPath);
    await mkdir(dir, { recursive: true });
    await writeFile(fullPath, data);
  }

  async readBinary(relativePath: string): Promise<Buffer> {
    return readFile(this.resolveWithinVault(relativePath));
  }

  async deleteFile(relativePath: string): Promise<void> {
    await unlink(this.resolveWithinVault(relativePath));
  }

  async fileExists(relativePath: string): Promise<boolean> {
    try {
      await stat(this.resolveWithinVault(relativePath));
      return true;
    } catch {
      return false;
    }
  }

  async listRawFiles(): Promise<string[]> {
    const files = await glob('**/*', {
      cwd: this.rawDir,
      nodir: true,
      ignore: ['assets/**'],
    });
    return files.sort();
  }

  async listWikiPages(subdir?: string): Promise<string[]> {
    const searchDir = subdir ? this.resolveWithinWiki(subdir) : this.wikiDir;
    const files = await glob('**/*.md', {
      cwd: searchDir,
      nodir: true,
    });
    return files.sort();
  }

  async readWikiPage(relativePath: string): Promise<WikiPage> {
    const fullRelative = relativePath.startsWith('wiki/')
      ? relativePath
      : join('wiki', relativePath);
    const content = await this.readFile(fullRelative);
    return buildWikiPage(this.resolveWithinVault(fullRelative), fullRelative, content);
  }

  async getIngestedSources(): Promise<Set<string>> {
    const ingested = new Set<string>();
    try {
      const logContent = await this.readFile(LOG_PATH);
      const matches = logContent.matchAll(/^Verarbeitet:\s*(.+)$/gm);
      for (const match of matches) {
        ingested.add(match[1].trim());
      }
    } catch {
      /* kein Log */
    }
    return ingested;
  }

  async forgetSource(filename: string): Promise<void> {
    try {
      const logContent = await this.readFile(LOG_PATH);
      const updated = logContent
        .split('\n')
        .filter((line) => {
          const match = line.match(/^Verarbeitet:\s*(.+)$/);
          return !match || match[1].trim() !== filename;
        })
        .join('\n');
      await this.writeFile(LOG_PATH, updated);
    } catch {
      /* kein Log */
    }
  }

  async appendLog(entry: string): Promise<void> {
    try {
      const existing = await this.readFile(LOG_PATH);
      await this.writeFile(LOG_PATH, existing + entry);
    } catch {
      await this.writeFile(LOG_PATH, `# Wiki-Protokoll\n${entry}`);
    }
  }

  async findRelevantPages(
    keywords: string[],
    options: RelevantPageOptions = {}
  ): Promise<WikiPage[]> {
    const { index, pages } = await this.getSearchIndex();
    const limit = typeof options.limit === 'number' && options.limit > 0
      ? Math.floor(options.limit)
      : DEFAULT_RELEVANT_PAGE_LIMIT;
    return bm25RankWithIndex(pages, keywords, index, { limit });
  }

  async loadAllWikiPages(): Promise<WikiPage[]> {
    const paths = await this.listWikiPages();
    return Promise.all(paths.map((p) => this.readWikiPage(p)));
  }

  private indexCachePath(): string {
    return join(this.root, '.search-index.json');
  }

  /**
   * Liefert den aktuellen Search-Index. Nutzt In-Memory-Cache pro Vault-Root,
   * faellt auf Platte zurueck und refresht via mtime. Bei Aenderungen wird
   * der neue Index sowohl im Cache als auch auf Platte aktualisiert.
   */
  async getSearchIndex(pages?: WikiPage[]): Promise<{ index: SearchIndex; pages: WikiPage[] }> {
    const allPages = pages ?? await this.loadAllWikiPages();

    let prior = getCachedIndex(this.root);
    if (!prior) {
      prior = await loadIndexFromDisk(this.indexCachePath());
      setCachedIndex(this.root, prior);
    }

    const { index, changed } = await refreshIndex(prior, allPages);
    if (changed) {
      setCachedIndex(this.root, index);
      void saveIndexToDisk(this.indexCachePath(), index).catch(() => {
        /* Index ist Cache — Schreibfehler blockieren nicht */
      });
    } else {
      setCachedIndex(this.root, index);
    }
    return { index, pages: allPages };
  }

  clearSearchIndex(): void {
    setCachedIndex(this.root, emptyIndex());
  }

  async getPendingStubs(): Promise<PendingStub[]> {
    try {
      const content = await this.readFile(PENDING_STUBS_PATH);
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  async removePendingStubs(filledPaths: Set<string>): Promise<void> {
    if (filledPaths.size === 0) return;
    const stubs = await this.getPendingStubs();
    const remaining = stubs.filter((s) => !filledPaths.has(s.path));
    if (remaining.length === 0) {
      await this.deleteFile(PENDING_STUBS_PATH).catch(() => { /* bereits weg */ });
    } else {
      await this.writeFile(PENDING_STUBS_PATH, JSON.stringify(remaining, null, 2));
    }
  }

  async addPendingStubs(newStubs: PendingStub[]): Promise<void> {
    if (newStubs.length === 0) return;
    const existing = await this.getPendingStubs();
    const byPath = new Map(existing.map((s) => [s.path, s]));
    for (const stub of newStubs) {
      const prev = byPath.get(stub.path);
      if (prev) {
        const refs = new Set([...prev.referencedBy, ...stub.referencedBy]);
        prev.referencedBy = [...refs].sort();
      } else {
        byPath.set(stub.path, { ...stub, referencedBy: [...new Set(stub.referencedBy)].sort() });
      }
    }
    const merged = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
    await this.writeFile(PENDING_STUBS_PATH, JSON.stringify(merged, null, 2));
  }

  async getSourceDate(filename: string): Promise<string> {
    const sourcePath = this.resolveWithinRaw(filename);

    try {
      const content = await readFile(sourcePath, 'utf-8');
      const fm = parseFrontmatter(content);
      if (fm.date && typeof fm.date === 'string') {
        return fm.date;
      }
    } catch {
      /* Datei nicht lesbar */
    }

    const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      return dateMatch[1];
    }

    try {
      const stats = await stat(sourcePath);
      return stats.mtime.toISOString().split('T')[0];
    } catch {
      return new Date().toISOString().split('T')[0];
    }
  }
}

export interface FrontmatterBlock {
  data: Record<string, unknown>;
  body: string;
  hasFrontmatter: boolean;
}

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n?/;

export function parseFrontmatterBlock(content: string): FrontmatterBlock {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) {
    return { data: {}, body: content, hasFrontmatter: false };
  }

  const data: Record<string, unknown> = {};
  const lines = match[1].split('\n');
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const key = line.substring(0, colonIndex).trim();
    if (!key) continue;
    const raw = line.substring(colonIndex + 1).trim();
    data[key] = parseFrontmatterValue(raw);
  }

  const body = content.slice(match[0].length);
  return { data, body, hasFrontmatter: true };
}

function stripQuotes(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    // Doppelte Anfuehrungszeichen: JSON-kompatibel entescapen (\" \\ \n \t ...).
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'string') return parsed;
    } catch {
      /* faellt unten auf naives Slicing zurueck */
    }
    return raw.slice(1, -1);
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    // Einfache Anfuehrungszeichen: YAML-Escaping ist die verdoppelte Quote.
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  return raw;
}

function parseFrontmatterValue(raw: string): unknown {
  if (raw === '' || raw === '~' || raw === 'null') return null;
  // Wikilink vor Array-Check: `superseded_by: [[X]]` darf NICHT als Array geparst werden.
  if (raw.startsWith('[[') && raw.endsWith(']]')) return raw;
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((s) => stripQuotes(s.trim()));
  }
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return stripQuotes(raw);
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}

// YAML-Skalare, die ungequotet als Keyword/Sonderwert fehlinterpretiert wuerden.
const YAML_RESERVED_SCALARS = new Set([
  'true', 'false', 'null', '~', 'yes', 'no', 'on', 'off',
  'True', 'False', 'Null', 'Yes', 'No', 'On', 'Off',
  'TRUE', 'FALSE', 'NULL', 'YES', 'NO', 'ON', 'OFF',
]);

/**
 * Entscheidet, ob ein String-Skalar fuer standardkonformes YAML gequotet werden
 * muss. Konservativ: nur quoten, was sonst von einem echten YAML-Parser falsch
 * gelesen wuerde — damit Diffs minimal bleiben und harmlose Werte (Slugs, Daten,
 * URLs, Enums) ungequotet bleiben.
 */
function needsScalarQuoting(s: string): boolean {
  if (s === '' || s === '-') return true;
  if (s !== s.trim()) return true;                 // fuehrender/abschliessender Whitespace
  if (YAML_RESERVED_SCALARS.has(s)) return true;   // true/false/null/yes/no/...
  if (/^[-?:]\s/.test(s)) return true;             // "- ", "? ", ": " als Block-Indikator
  if (/^[[\]{}#&*!|>'"%@`,]/.test(s)) return true; // fuehrendes YAML-Indikatorzeichen
  if (/:(\s|$)/.test(s)) return true;              // Doppelpunkt + Space/EOL (Mapping-Ambiguitaet)
  if (/\s#/.test(s)) return true;                  // Space + Hash (Kommentar)
  if (/[\n\t]/.test(s)) return true;               // Steuer-Whitespace
  if (/^[+-]?(\d[\d_]*)(\.\d*)?([eE][+-]?\d+)?$/.test(s)) return true; // zahlartig
  return false;
}

function formatScalarString(s: string): string {
  // Wikilinks bleiben im Live-Vault nativ ([[X]]); portiert wird erst beim Export.
  if (s.startsWith('[[') && s.endsWith(']]')) return s;
  if (needsScalarQuoting(s)) return JSON.stringify(s);
  return s;
}

export function serializeFrontmatter(data: Record<string, unknown>): string {
  const lines: string[] = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (value === null) {
      lines.push(`${key}:`);
    } else if (Array.isArray(value)) {
      const items = value.map((v) => formatScalarString(String(v)));
      lines.push(`${key}: [${items.join(', ')}]`);
    } else if (typeof value === 'boolean' || typeof value === 'number') {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${formatScalarString(String(value))}`);
    }
  }
  lines.push('---');
  return lines.join('\n') + '\n';
}

export function updateFrontmatter(
  content: string,
  updater: (data: Record<string, unknown>) => void,
): string | null {
  const { data, body, hasFrontmatter } = parseFrontmatterBlock(content);
  if (!hasFrontmatter) return null;
  updater(data);
  return serializeFrontmatter(data) + body;
}

function parseFrontmatter(content: string): Record<string, unknown> {
  return parseFrontmatterBlock(content).data;
}

function buildWikiPage(absolutePath: string, relativePath: string, content: string): WikiPage {
  return {
    path: absolutePath,
    relativePath,
    content,
    contentLower: content.toLowerCase(),
    frontmatter: parseFrontmatter(content),
  };
}

export const WIKI_CATEGORIES = ['sources', 'entities', 'concepts', 'syntheses', 'sops', 'decisions'] as const;
export type WikiCategory = (typeof WIKI_CATEGORIES)[number];

/** Kanonisches `type:`-Vokabular pro Verzeichnis — Single Source of Truth fuer den Seitentyp. */
export const WIKI_CATEGORY_TYPES: Record<WikiCategory, string> = {
  sources: 'source',
  entities: 'entity',
  concepts: 'concept',
  syntheses: 'synthesis',
  sops: 'sop',
  decisions: 'decision',
};

export function typeForCategory(category: string): string | undefined {
  return (WIKI_CATEGORY_TYPES as Record<string, string>)[category];
}

/** Leitet die Wiki-Kategorie aus einem (ggf. `wiki/`-praefixierten) Pfad ab. */
export function categoryFromWikiPath(path: string): WikiCategory | undefined {
  const norm = path.replace(/\\/g, '/').replace(/^wiki\//, '');
  const first = norm.split('/')[0];
  return (WIKI_CATEGORIES as readonly string[]).includes(first) ? (first as WikiCategory) : undefined;
}

/**
 * Liest den kanonischen Seitentyp: echtes `type:`-Feld bevorzugt, sonst
 * Back-Compat aus einem `type/<x>`-Tag (alte KI-Seiten), sonst undefined.
 */
export function resolvePageType(frontmatter: Record<string, unknown>): string | undefined {
  const direct = frontmatter.type;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const tags = frontmatter.tags;
  if (Array.isArray(tags)) {
    for (const t of tags) {
      const s = String(t).trim();
      if (s.toLowerCase().startsWith('type/') && s.length > 'type/'.length) {
        return s.slice('type/'.length);
      }
    }
  }
  return undefined;
}

/**
 * Deterministischer Backfill: ergaenzt ein fehlendes `type:`-Feld anhand des
 * Verzeichnisses, damit der Seitentyp nicht von der KI-Compliance abhaengt.
 */
export function ensureFrontmatterType(content: string, wikiPath: string): string {
  const category = categoryFromWikiPath(wikiPath);
  if (!category) return content;
  const type = WIKI_CATEGORY_TYPES[category];
  const updated = updateFrontmatter(content, (fm) => {
    const current = typeof fm.type === 'string' ? fm.type.trim() : '';
    if (!current) fm.type = type;
  });
  return updated ?? content;
}

export const WIKI_SUB_INDEXES: Record<WikiCategory, string> = {
  sources: '# Quellen\n\nZusammenfassungen der Rohdaten.\n',
  entities: '# Entitaeten\n\nPersonen, Organisationen, Produkte und Tools.\n',
  concepts: '# Konzepte\n\nIdeen, Frameworks, Theorien und Patterns.\n',
  syntheses: '# Synthesen\n\nVergleiche, Analysen und Querverbindungen.\n',
  sops: '# SOPs\n\nStandard Operating Procedures — wiederholbare Ablaeufe und Anleitungen.\n',
  decisions: '# Entscheidungen\n\nErgebnisse, Beschluesse, Bewertungen — was wurde festgelegt und warum.\n',
};

export async function generateWikilinkMap(wikiDir: string): Promise<void> {
  const files = await glob('**/*.md', { cwd: wikiDir, nodir: true });
  const map: Record<string, string> = {};

  for (const [dir, content] of Object.entries(WIKI_SUB_INDEXES)) {
    const hasPages = files.some((f) => f.startsWith(`${dir}/`) && f !== `${dir}/index.md`);
    if (!hasPages) continue;
    if (!files.includes(`${dir}/index.md`)) {
      await mkdir(join(wikiDir, dir), { recursive: true });
      await writeFile(join(wikiDir, dir, 'index.md'), content, 'utf-8');
    }
  }

  for (const file of files) {
    const name = basename(file, '.md');
    if (isSystemPage(name)) continue;
    const slug = slugify(name);
    const route = '/' + file.replace(/\.md$/, '');
    map[slug] = route;
  }

  await writeFile(
    join(wikiDir, '.wikilinks.json'),
    JSON.stringify(map, null, 2),
    'utf-8'
  );
}

function collectIndexAliases(indexContent: string): Set<string> {
  const aliases = new Set<string>();
  for (const link of extractWikilinks(indexContent)) {
    for (const alias of linkTargetAliases(link.target)) aliases.add(alias);
  }
  return aliases;
}

function indexHasPage(indexAliases: Set<string>, pageId: string, pageName: string): boolean {
  return pageAliases(pageId, pageName).some((a) => indexAliases.has(a));
}

// Sentinel-Marker: alles INNERHALB wird voll regeneriert, alles ausserhalb
// (handgeschriebene Praeambel) bleibt erhalten — Progressive-Disclosure-TOC nach OKF-Vorbild.
const AUTO_INDEX_START = '<!-- auto-index -->';
const AUTO_INDEX_END = '<!-- /auto-index -->';

export const WIKI_CATEGORY_LABELS: Record<WikiCategory, string> = {
  sources: 'Quellen',
  entities: 'Entitaeten',
  concepts: 'Konzepte',
  syntheses: 'Synthesen',
  sops: 'SOPs',
  decisions: 'Entscheidungen',
};

// Boilerplate-Abschnitte, die NICHT als Kurzbeschreibung taugen.
const INDEX_BOILERPLATE_HEADINGS = [
  'gegenargument', 'datenlueck', 'datenlück', 'arbeitsnotiz', 'kontext', 'quellen', 'citations', 'einwaende', 'einwände',
];

function truncateText(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1).trimEnd() + '…';
}

/** Kurzbeschreibung fuer Index-Eintraege: `description`-Feld bevorzugt, sonst erster Fliesstext-Satz. */
export function deriveDescription(content: string, maxLen = 140): string {
  const { data, body } = parseFrontmatterBlock(content);
  const sanitize = (s: string) => s.replace(/\[\[|\]\]/g, '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

  const fd = data.description;
  if (typeof fd === 'string' && fd.trim()) return truncateText(sanitize(fd), maxLen);

  let skipping = false;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const h = line.replace(/^#+\s*/, '').toLowerCase();
      skipping = INDEX_BOILERPLATE_HEADINGS.some((b) => h.startsWith(b));
      continue;
    }
    if (skipping) continue;
    if (/^[-*>|]/.test(line) || line.startsWith('```')) continue;
    const sentence = line.split(/(?<=[.!?])\s/)[0];
    return truncateText(sanitize(sentence), maxLen);
  }
  return '';
}

/** Trennt die handgeschriebene Praeambel vom (neu zu generierenden) Auto-Block. */
function extractIndexPreamble(content: string): string {
  const sentIdx = content.indexOf(AUTO_INDEX_START);
  if (sentIdx !== -1) return content.slice(0, sentIdx).trimEnd();
  const lines = content.split('\n');
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^[-*]\s*\[\[/.test(l) || /^##\s/.test(l)) { cut = i; break; }
  }
  return lines.slice(0, cut).join('\n').trimEnd();
}

function indexBullet(name: string, description: string): string {
  const label = name.replace(/-/g, ' ');
  return description ? `- [[${label}]] — ${description}` : `- [[${label}]]`;
}

function composeAutoIndex(preamble: string, block: string): string {
  const body = block.trim() ? `${AUTO_INDEX_START}\n${block}\n${AUTO_INDEX_END}\n` : `${AUTO_INDEX_START}\n${AUTO_INDEX_END}\n`;
  return preamble.trim() ? `${preamble.trimEnd()}\n\n${body}` : body;
}

interface IndexPage { id: string; name: string; description: string }

export async function updateIndexes(wikiDir: string): Promise<number> {
  const files = await glob('**/*.md', { cwd: wikiDir, nodir: true });

  const pagesByDir = new Map<string, IndexPage[]>();
  const allPages: Array<IndexPage & { topDir: string }> = [];

  for (const file of files) {
    const name = basename(file, '.md');
    if (isSystemPage(name)) continue;
    const dir = dirname(file);
    if (dir === '.') continue;
    const id = file.replace(/\.md$/, '');
    let description = '';
    try {
      description = deriveDescription(await readFile(join(wikiDir, file), 'utf-8'));
    } catch {
      /* unlesbar — ohne Beschreibung indizieren */
    }
    const page: IndexPage = { id, name, description };
    const list = pagesByDir.get(dir) || [];
    list.push(page);
    pagesByDir.set(dir, list);
    allPages.push({ ...page, topDir: id.includes('/') ? id.split('/')[0] : 'other' });
  }

  let addedCount = 0;

  // Sub-Index pro Verzeichnis: Praeambel erhalten, Auto-Block sortiert voll regenerieren.
  for (const [dir, pages] of pagesByDir) {
    const indexPath = join(wikiDir, dir, 'index.md');
    let existing = '';
    try { existing = await readFile(indexPath, 'utf-8'); } catch { /* wird neu angelegt */ }

    // Zaehle nur Seiten, die vorher noch nicht im Index standen (fuer die Lint-Meldung).
    const oldAliases = collectIndexAliases(existing);
    addedCount += pages.filter((p) => !indexHasPage(oldAliases, p.id, p.name)).length;

    const category = dir as WikiCategory;
    const fallbackHeader = (WIKI_SUB_INDEXES[category] ?? `# ${dir}\n`).trimEnd();
    const preamble = existing.trim() ? extractIndexPreamble(existing) : fallbackHeader;

    const block = pages
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => indexBullet(p.name, p.description))
      .join('\n');

    await mkdir(join(wikiDir, dir), { recursive: true });
    await writeFile(indexPath, composeAutoIndex(preamble, block), 'utf-8');
  }

  // Hauptindex: Intro erhalten, nach Kategorien gruppierten Auto-Block regenerieren.
  const mainIndexPath = join(wikiDir, 'index.md');
  try {
    const existingMain = await readFile(mainIndexPath, 'utf-8');
    const preamble = extractIndexPreamble(existingMain);

    const grouped = new Map<string, IndexPage[]>();
    for (const entry of allPages) {
      const list = grouped.get(entry.topDir) || [];
      list.push(entry);
      grouped.set(entry.topDir, list);
    }

    const order: string[] = [...WIKI_CATEGORIES, 'other'];
    const sections: string[] = [];
    for (const cat of order) {
      const pages = grouped.get(cat);
      if (!pages || pages.length === 0) continue;
      const label = WIKI_CATEGORY_LABELS[cat as WikiCategory] ?? cat;
      const bullets = pages
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => indexBullet(p.name, p.description))
        .join('\n');
      sections.push(`### ${label}\n${bullets}`);
    }

    await writeFile(mainIndexPath, composeAutoIndex(preamble, sections.join('\n\n')), 'utf-8');
  } catch {
    /* kein Hauptindex */
  }

  return addedCount;
}

export function rankPagesByKeywords(
  pages: WikiPage[],
  keywords: string[],
  limit?: number,
): WikiPage[] {
  return bm25Rank(pages, keywords, {
    limit: typeof limit === 'number' && limit > 0 ? Math.floor(limit) : DEFAULT_RELEVANT_PAGE_LIMIT,
  });
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[äöüß]/g, (c) =>
      c === 'ä' ? 'ae' : c === 'ö' ? 'oe' : c === 'ü' ? 'ue' : 'ss'
    )
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function today(): string {
  return new Date().toISOString().split('T')[0];
}

export function nowISO(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}
