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

function parseFrontmatterValue(raw: string): unknown {
  if (raw === '' || raw === '~' || raw === 'null') return null;
  // Wikilink vor Array-Check: `superseded_by: [[X]]` darf NICHT als Array geparst werden.
  if (raw.startsWith('[[') && raw.endsWith(']]')) return raw;
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((s) => s.trim());
  }
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}

export function serializeFrontmatter(data: Record<string, unknown>): string {
  const lines: string[] = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (value === null) {
      lines.push(`${key}:`);
    } else if (Array.isArray(value)) {
      lines.push(`${key}: [${value.join(', ')}]`);
    } else if (typeof value === 'boolean') {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${value}`);
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

export async function updateIndexes(wikiDir: string): Promise<number> {
  const files = await glob('**/*.md', { cwd: wikiDir, nodir: true });
  let addedCount = 0;

  const pagesByDir = new Map<string, Array<{ id: string; name: string }>>();
  const allPages: Array<{ id: string; name: string }> = [];

  for (const file of files) {
    const name = basename(file, '.md');
    if (isSystemPage(name)) continue;
    const dir = dirname(file);
    if (dir === '.') continue;
    const id = file.replace(/\.md$/, '');
    const list = pagesByDir.get(dir) || [];
    list.push({ id, name });
    pagesByDir.set(dir, list);
    allPages.push({ id, name });
  }

  for (const [dir, pages] of pagesByDir) {
    const indexPath = join(wikiDir, dir, 'index.md');
    let indexContent: string;
    try {
      indexContent = await readFile(indexPath, 'utf-8');
    } catch {
      continue;
    }

    const indexAliases = collectIndexAliases(indexContent);
    const missing = pages.filter((p) => !indexHasPage(indexAliases, p.id, p.name));

    if (missing.length > 0) {
      const entries = missing
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => `- [[${p.name.replace(/-/g, ' ')}]]`)
        .join('\n');
      indexContent = indexContent.trimEnd() + '\n' + entries + '\n';
      await writeFile(indexPath, indexContent, 'utf-8');
      addedCount += missing.length;
    }
  }

  const mainIndexPath = join(wikiDir, 'index.md');
  try {
    let mainIndex = await readFile(mainIndexPath, 'utf-8');
    const mainIndexAliases = collectIndexAliases(mainIndex);
    const missingFromMain = allPages.filter((e) => !indexHasPage(mainIndexAliases, e.id, e.name));

    if (missingFromMain.length > 0) {
      const grouped = new Map<string, string[]>();
      for (const entry of missingFromMain) {
        const dir = entry.id.includes('/') ? entry.id.split('/')[0] : 'other';
        const list = grouped.get(dir) || [];
        list.push(entry.name);
        grouped.set(dir, list);
      }

      let section = '';
      for (const [dir, names] of grouped) {
        section += `\n## ${dir}\n`;
        for (const n of names.sort()) {
          section += `- [[${n.replace(/-/g, ' ')}]]\n`;
        }
      }
      mainIndex = mainIndex.trimEnd() + '\n' + section;
      await writeFile(mainIndexPath, mainIndex, 'utf-8');
      addedCount += missingFromMain.length;
    }
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
