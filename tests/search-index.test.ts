import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, utimes, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  analyzePage,
  computeCorpusStats,
  emptyIndex,
  refreshIndex,
  loadIndexFromDisk,
  saveIndexToDisk,
  getCachedIndex,
  setCachedIndex,
  invalidateCachedIndex,
} from '../src/main/core/search-index';
import { bm25Rank, bm25RankWithIndex } from '../src/main/core/search';
import type { WikiPage } from '../src/main/core/vault';

function makePage(relativePath: string, fullPath: string, content: string, frontmatter: Record<string, unknown> = {}): WikiPage {
  return {
    path: fullPath,
    relativePath,
    content,
    contentLower: content.toLowerCase(),
    frontmatter,
  };
}

describe('search-index', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'search-index-test-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  describe('analyzePage', () => {
    it('extrahiert tf, titleTokens, length', () => {
      const page = makePage('wiki/test.md', '/tmp/x', 'react react hooks state management', { title: 'React Hooks' });
      const entry = analyzePage(page, 1000);
      expect(entry.mtime).toBe(1000);
      expect(entry.tf.react).toBe(2);
      expect(entry.tf.hooks).toBe(1);
      expect(entry.titleTokens).toContain('react');
      expect(entry.titleTokens).toContain('hooks');
      expect(entry.length).toBeGreaterThan(0);
      expect(entry.title).toBe('React Hooks');
    });

    it('nutzt Dateinamen als Title-Fallback', () => {
      const page = makePage('wiki/concepts/my-topic.md', '/tmp/x', 'content here');
      const entry = analyzePage(page, 0);
      expect(entry.title).toBe('my topic');
    });
  });

  describe('emptyIndex und loadIndexFromDisk', () => {
    it('emptyIndex liefert korrekte Struktur', () => {
      const idx = emptyIndex();
      expect(idx.version).toBe(1);
      expect(idx.entries).toEqual({});
    });

    it('loadIndexFromDisk liefert leeren Index bei fehlender Datei', async () => {
      const idx = await loadIndexFromDisk(join(tmpRoot, 'nope.json'));
      expect(idx).toEqual(emptyIndex());
    });

    it('loadIndexFromDisk liefert leeren Index bei kaputter Datei', async () => {
      const path = join(tmpRoot, 'broken.json');
      await writeFile(path, 'nicht json', 'utf-8');
      const idx = await loadIndexFromDisk(path);
      expect(idx.entries).toEqual({});
    });

    it('loadIndexFromDisk liefert leeren Index bei falscher Version', async () => {
      const path = join(tmpRoot, 'v2.json');
      await writeFile(path, JSON.stringify({ version: 99, entries: {} }), 'utf-8');
      const idx = await loadIndexFromDisk(path);
      expect(idx.entries).toEqual({});
    });
  });

  describe('saveIndexToDisk und Roundtrip', () => {
    it('persistiert und laedt Index', async () => {
      const path = join(tmpRoot, 'sub', 'index.json');
      const idx = emptyIndex();
      idx.entries['wiki/a.md'] = {
        mtime: 1234,
        tf: { foo: 3, bar: 1 },
        titleTokens: ['a'],
        length: 4,
        title: 'A',
      };
      await saveIndexToDisk(path, idx);
      const loaded = await loadIndexFromDisk(path);
      expect(loaded).toEqual(idx);
    });
  });

  describe('refreshIndex', () => {
    it('tokenisiert neue Seiten', async () => {
      const filePath = join(tmpRoot, 'a.md');
      await writeFile(filePath, 'react hooks', 'utf-8');
      const page = makePage('wiki/a.md', filePath, 'react hooks');
      const { index, changed } = await refreshIndex(emptyIndex(), [page]);
      expect(changed).toBe(true);
      expect(index.entries['wiki/a.md']).toBeDefined();
      expect(index.entries['wiki/a.md'].tf.react).toBe(1);
    });

    it('wiederverwendet Eintraege bei unveraenderter mtime', async () => {
      const filePath = join(tmpRoot, 'b.md');
      await writeFile(filePath, 'react hooks', 'utf-8');
      const page = makePage('wiki/b.md', filePath, 'react hooks');
      const first = await refreshIndex(emptyIndex(), [page]);
      expect(first.changed).toBe(true);

      const second = await refreshIndex(first.index, [page]);
      expect(second.changed).toBe(false);
      expect(second.index.entries['wiki/b.md']).toBe(first.index.entries['wiki/b.md']);
    });

    it('re-tokenisiert bei geaenderter mtime', async () => {
      const filePath = join(tmpRoot, 'c.md');
      await writeFile(filePath, 'alt', 'utf-8');
      const page1 = makePage('wiki/c.md', filePath, 'alt');
      const first = await refreshIndex(emptyIndex(), [page1]);

      // Datei aendern und mtime verschieben
      await writeFile(filePath, 'neuer inhalt hier', 'utf-8');
      const future = new Date(Date.now() + 10_000);
      await utimes(filePath, future, future);

      const page2 = makePage('wiki/c.md', filePath, 'neuer inhalt hier');
      const second = await refreshIndex(first.index, [page2]);
      expect(second.changed).toBe(true);
      expect(second.index.entries['wiki/c.md'].tf.neuer).toBe(1);
    });

    it('entfernt geloeschte Seiten und meldet changed', async () => {
      const filePath = join(tmpRoot, 'd.md');
      await writeFile(filePath, 'inhalt', 'utf-8');
      const page = makePage('wiki/d.md', filePath, 'inhalt');
      const first = await refreshIndex(emptyIndex(), [page]);

      const second = await refreshIndex(first.index, []);
      expect(second.changed).toBe(true);
      expect(Object.keys(second.index.entries)).toEqual([]);
    });
  });

  describe('computeCorpusStats', () => {
    it('berechnet df, avgLen, N korrekt', () => {
      const idx = emptyIndex();
      idx.entries['a'] = { mtime: 0, tf: { foo: 2, bar: 1 }, titleTokens: [], length: 3, title: 'a' };
      idx.entries['b'] = { mtime: 0, tf: { foo: 1 }, titleTokens: ['baz'], length: 1, title: 'b' };
      const stats = computeCorpusStats(idx);
      expect(stats.N).toBe(2);
      expect(stats.avgLen).toBe(2);
      expect(stats.df.get('foo')).toBe(2);
      expect(stats.df.get('bar')).toBe(1);
      expect(stats.df.get('baz')).toBe(1);
    });

    it('avgLen ist mindestens 1 bei leerem Index', () => {
      const stats = computeCorpusStats(emptyIndex());
      expect(stats.N).toBe(0);
      expect(stats.avgLen).toBe(1);
    });
  });

  describe('In-Memory-Cache', () => {
    it('speichert und liest pro Root', () => {
      const root1 = '/vault/a';
      const root2 = '/vault/b';
      const idx1 = emptyIndex();
      idx1.entries['x'] = { mtime: 1, tf: {}, titleTokens: [], length: 0, title: 'x' };

      setCachedIndex(root1, idx1);
      expect(getCachedIndex(root1)).toBe(idx1);
      expect(getCachedIndex(root2)).toBeUndefined();

      invalidateCachedIndex(root1);
      expect(getCachedIndex(root1)).toBeUndefined();
    });
  });

  describe('bm25RankWithIndex', () => {
    it('liefert gleiche Top-Ergebnisse wie bm25Rank', async () => {
      const pages: WikiPage[] = [];
      for (let i = 0; i < 10; i++) {
        const rel = `wiki/p${i}.md`;
        const fp = join(tmpRoot, `p${i}.md`);
        const content = i === 3 ? 'react hooks state management context' : `fueller seite ${i} ueber andere themen`;
        await writeFile(fp, content, 'utf-8');
        pages.push(makePage(rel, fp, content));
      }
      const { index } = await refreshIndex(emptyIndex(), pages);

      const viaIndex = bm25RankWithIndex(pages, ['react', 'hooks'], index, { limit: 3 });
      const viaPlain = bm25Rank(pages, ['react', 'hooks'], { limit: 3 });

      expect(viaIndex.length).toBeGreaterThan(0);
      expect(viaIndex[0].relativePath).toBe(viaPlain[0].relativePath);
    });

    it('ueberspringt Seiten ohne Index-Eintrag', async () => {
      const fp = join(tmpRoot, 'known.md');
      await writeFile(fp, 'react hooks state management context', 'utf-8');
      const known = makePage('wiki/known.md', fp, 'react hooks state management context');

      const unknownPages: WikiPage[] = [];
      for (let i = 0; i < 10; i++) {
        unknownPages.push(makePage(`wiki/u${i}.md`, `/tmp/u${i}`, `react hooks text ${i}`));
      }

      const { index } = await refreshIndex(emptyIndex(), [known]);
      const result = bm25RankWithIndex([known, ...unknownPages], ['react'], index, { limit: 5 });
      expect(result.every((p) => p.relativePath === 'wiki/known.md' || false)).toBe(true);
    });
  });

  describe('Roundtrip-Verhalten mit geschriebener Datei', () => {
    it('laed persistierten Index und findet Treffer ohne Neu-Tokenisierung', async () => {
      const fp1 = join(tmpRoot, 'a.md');
      const fp2 = join(tmpRoot, 'b.md');
      await writeFile(fp1, 'alpha beta gamma delta', 'utf-8');
      await writeFile(fp2, 'completely different content here', 'utf-8');

      const pages = [
        makePage('wiki/a.md', fp1, 'alpha beta gamma delta'),
        makePage('wiki/b.md', fp2, 'completely different content here'),
      ];
      const { index } = await refreshIndex(emptyIndex(), pages);
      const idxPath = join(tmpRoot, 'index.json');
      await saveIndexToDisk(idxPath, index);

      const raw = await readFile(idxPath, 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.version).toBe(1);
      expect(Object.keys(parsed.entries)).toContain('wiki/a.md');

      const reloaded = await loadIndexFromDisk(idxPath);
      const stats = computeCorpusStats(reloaded);
      expect(stats.N).toBe(2);
    });
  });
});
