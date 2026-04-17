import { readFile, writeFile, stat, mkdir } from 'fs/promises';
import { dirname } from 'path';
import type { WikiPage } from './vault';
import { tokenize } from './keywords';

/**
 * Persistenter BM25-Search-Index. Pro Dokument werden Token-Statistiken
 * (tf, titleTokens, length) gecacht und via mtime invalidiert. Das spart
 * bei grossen Wikis das wiederholte Tokenisieren bei jedem Ranking-Aufruf.
 */

export interface DocEntry {
  mtime: number;
  tf: Record<string, number>;
  titleTokens: string[];
  length: number;
  title: string;
}

export interface SearchIndex {
  version: number;
  entries: Record<string, DocEntry>;
}

const INDEX_VERSION = 1;

export function emptyIndex(): SearchIndex {
  return { version: INDEX_VERSION, entries: {} };
}

export async function loadIndexFromDisk(path: string): Promise<SearchIndex> {
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as SearchIndex;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== INDEX_VERSION) {
      return emptyIndex();
    }
    if (!parsed.entries || typeof parsed.entries !== 'object') return emptyIndex();
    return parsed;
  } catch {
    return emptyIndex();
  }
}

export async function saveIndexToDisk(path: string, index: SearchIndex): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(index), 'utf-8');
}

function extractTitle(page: WikiPage): string {
  const fmTitle = page.frontmatter.title;
  if (typeof fmTitle === 'string' && fmTitle.trim()) return fmTitle;
  const base = page.relativePath.split('/').pop() || '';
  return base.replace(/\.md$/i, '').replace(/[-_]+/g, ' ');
}

export function analyzePage(page: WikiPage, mtime: number): DocEntry {
  const title = extractTitle(page);
  const contentTokens = tokenize(page.content);
  const titleTokens = [...new Set(tokenize(title))];

  const tf: Record<string, number> = {};
  for (const tok of contentTokens) {
    tf[tok] = (tf[tok] || 0) + 1;
  }

  return {
    mtime,
    tf,
    titleTokens,
    length: contentTokens.length,
    title,
  };
}

/**
 * Synchronisiert den Index mit dem aktuellen Zustand der Seiten.
 * Berücksichtigt nur Dateien, deren mtime sich geändert hat.
 * Gibt an, ob Änderungen vorgenommen wurden (für Persistierungsentscheidung).
 */
export async function refreshIndex(
  prior: SearchIndex,
  pages: WikiPage[],
): Promise<{ index: SearchIndex; changed: boolean }> {
  const next: SearchIndex = { version: INDEX_VERSION, entries: {} };
  const seen = new Set<string>();
  let changed = false;

  for (const page of pages) {
    seen.add(page.relativePath);
    let mtimeMs: number;
    try {
      const s = await stat(page.path);
      mtimeMs = s.mtimeMs;
    } catch {
      mtimeMs = Date.now();
    }

    const existing = prior.entries[page.relativePath];
    if (existing && existing.mtime === mtimeMs) {
      next.entries[page.relativePath] = existing;
    } else {
      next.entries[page.relativePath] = analyzePage(page, mtimeMs);
      changed = true;
    }
  }

  // Entfernte Seiten: existierten vorher, jetzt nicht mehr → Änderung
  for (const key of Object.keys(prior.entries)) {
    if (!seen.has(key)) {
      changed = true;
    }
  }

  return { index: next, changed };
}

/**
 * Aggregiert Document-Frequency und durchschnittliche Dokumentlänge
 * für die BM25-Formel. Wird pro Query berechnet — sehr billig, da nur
 * über die bereits gecachten Einträge iteriert.
 */
/**
 * In-Memory-Cache fuer Search-Indices, keyed pro Vault-Root. Ueberbrueckt
 * die kurzlebigen Vault-Instanzen (ProjectService.getVault erzeugt jedes Mal
 * eine neue Instanz). Der Cache wird bei Datei-AEnderungen via mtime-Check
 * automatisch refresht.
 */
const inMemoryCache = new Map<string, SearchIndex>();

export function getCachedIndex(root: string): SearchIndex | undefined {
  return inMemoryCache.get(root);
}

export function setCachedIndex(root: string, index: SearchIndex): void {
  inMemoryCache.set(root, index);
}

export function invalidateCachedIndex(root: string): void {
  inMemoryCache.delete(root);
}

export function computeCorpusStats(index: SearchIndex): { df: Map<string, number>; avgLen: number; N: number } {
  const df = new Map<string, number>();
  let totalLen = 0;
  const entries = Object.values(index.entries);

  for (const entry of entries) {
    const seen = new Set<string>();
    for (const term of Object.keys(entry.tf)) seen.add(term);
    for (const term of entry.titleTokens) seen.add(term);
    for (const term of seen) {
      df.set(term, (df.get(term) || 0) + 1);
    }
    totalLen += entry.length;
  }

  const avgLen = entries.length > 0 ? Math.max(1, totalLen / entries.length) : 1;
  return { df, avgLen, N: entries.length };
}
