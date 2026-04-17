import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Vault, slugify } from '../src/main/core/vault';

let vault: Vault;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'vault-test-'));
  vault = new Vault(tmpDir);
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('Vault Dateizugriff', () => {
  it('schreibt und liest eine Datei', async () => {
    await vault.writeFile('raw/test.md', '# Hallo');
    const content = await vault.readFile('raw/test.md');
    expect(content).toBe('# Hallo');
  });

  it('erstellt Unterverzeichnisse automatisch', async () => {
    await vault.writeFile('wiki/concepts/deep/nested.md', 'Inhalt');
    const content = await vault.readFile('wiki/concepts/deep/nested.md');
    expect(content).toBe('Inhalt');
  });

  it('loescht eine Datei', async () => {
    await vault.writeFile('raw/delete-me.md', 'tmp');
    await vault.deleteFile('raw/delete-me.md');
    const exists = await vault.fileExists('raw/delete-me.md');
    expect(exists).toBe(false);
  });

  it('meldet Existenz korrekt', async () => {
    expect(await vault.fileExists('raw/nope.md')).toBe(false);
    await vault.writeFile('raw/yes.md', 'da');
    expect(await vault.fileExists('raw/yes.md')).toBe(true);
  });

  it('blockiert absolute Pfade', async () => {
    await expect(vault.readFile('/etc/passwd')).rejects.toThrow('Absolute Pfade');
  });

  it('blockiert Pfad-Traversal', async () => {
    await expect(vault.readFile('../../../etc/passwd')).rejects.toThrow('ausserhalb');
  });
});

describe('Vault Raw-Dateien', () => {
  it('listet Raw-Dateien sortiert', async () => {
    await vault.writeFile('raw/b.md', 'b');
    await vault.writeFile('raw/a.md', 'a');
    await vault.writeFile('raw/c.md', 'c');
    const files = await vault.listRawFiles();
    expect(files).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('gibt leeres Array wenn raw/ nicht existiert', async () => {
    const files = await vault.listRawFiles();
    expect(files).toEqual([]);
  });
});

describe('Vault Wiki-Seiten', () => {
  it('listet Wiki-Seiten', async () => {
    await vault.writeFile('wiki/concepts/test.md', '---\ntitle: Test\n---\n# Test');
    await vault.writeFile('wiki/entities/person.md', '---\ntitle: Person\n---\n# Person');
    const pages = await vault.listWikiPages();
    expect(pages).toContain('concepts/test.md');
    expect(pages).toContain('entities/person.md');
  });

  it('liest Wiki-Seite mit Frontmatter', async () => {
    const content = '---\ntitle: Mein Test\nstatus: confirmed\n---\n# Inhalt';
    await vault.writeFile('wiki/concepts/test.md', content);
    const page = await vault.readWikiPage('concepts/test.md');
    expect(page.frontmatter.title).toBe('Mein Test');
    expect(page.frontmatter.status).toBe('confirmed');
    expect(page.content).toBe(content);
  });
});

describe('Vault Ingest-Quellen', () => {
  it('gibt leeres Set wenn log.md nicht existiert', async () => {
    const ingested = await vault.getIngestedSources();
    expect(ingested.size).toBe(0);
  });

  it('liest verarbeitete Quellen aus log.md', async () => {
    await vault.writeFile(
      'wiki/log.md',
      '# Log\nVerarbeitet: datei1.md\nVerarbeitet: datei2.md\n',
    );
    const ingested = await vault.getIngestedSources();
    expect(ingested.has('datei1.md')).toBe(true);
    expect(ingested.has('datei2.md')).toBe(true);
    expect(ingested.has('datei3.md')).toBe(false);
  });

  it('vergisst eine Quelle', async () => {
    await vault.writeFile(
      'wiki/log.md',
      'Verarbeitet: a.md\nVerarbeitet: b.md\n',
    );
    await vault.forgetSource('a.md');
    const ingested = await vault.getIngestedSources();
    expect(ingested.has('a.md')).toBe(false);
    expect(ingested.has('b.md')).toBe(true);
  });
});

describe('Vault Pending Stubs', () => {
  it('gibt leeres Array wenn keine Stubs existieren', async () => {
    const stubs = await vault.getPendingStubs();
    expect(stubs).toEqual([]);
  });

  it('liest und entfernt Stubs', async () => {
    const stubData = [
      { slug: 'test', title: 'Test', category: 'concepts', path: 'concepts/test', referencedBy: ['a.md'] },
      { slug: 'foo', title: 'Foo', category: 'entities', path: 'entities/foo', referencedBy: ['b.md'] },
    ];
    await vault.writeFile('wiki/.pending-stubs.json', JSON.stringify(stubData));

    const stubs = await vault.getPendingStubs();
    expect(stubs).toHaveLength(2);

    await vault.removePendingStubs(new Set(['concepts/test']));
    const remaining = await vault.getPendingStubs();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].slug).toBe('foo');
  });

  it('loescht Datei wenn alle Stubs entfernt', async () => {
    const stubData = [
      { slug: 'x', title: 'X', category: 'concepts', path: 'concepts/x', referencedBy: [] },
    ];
    await vault.writeFile('wiki/.pending-stubs.json', JSON.stringify(stubData));
    await vault.removePendingStubs(new Set(['concepts/x']));
    expect(await vault.fileExists('wiki/.pending-stubs.json')).toBe(false);
  });

  it('addPendingStubs legt neue Stubs an wenn Datei nicht existiert', async () => {
    await vault.addPendingStubs([
      { slug: 'ki', title: 'KI', category: 'concepts', path: 'concepts/ki', referencedBy: ['a'] },
    ]);
    const stubs = await vault.getPendingStubs();
    expect(stubs).toHaveLength(1);
    expect(stubs[0].slug).toBe('ki');
    expect(stubs[0].referencedBy).toEqual(['a']);
  });

  it('addPendingStubs merged referencedBy bei identischem Pfad', async () => {
    await vault.addPendingStubs([
      { slug: 'ki', title: 'KI', category: 'concepts', path: 'concepts/ki', referencedBy: ['a', 'b'] },
    ]);
    await vault.addPendingStubs([
      { slug: 'ki', title: 'KI', category: 'concepts', path: 'concepts/ki', referencedBy: ['b', 'c'] },
    ]);
    const stubs = await vault.getPendingStubs();
    expect(stubs).toHaveLength(1);
    expect(stubs[0].referencedBy).toEqual(['a', 'b', 'c']);
  });

  it('addPendingStubs ist no-op bei leerer Liste', async () => {
    await vault.addPendingStubs([]);
    expect(await vault.fileExists('wiki/.pending-stubs.json')).toBe(false);
  });
});

describe('Vault findRelevantPages', () => {
  it('findet Seiten anhand von Keywords', async () => {
    await vault.writeFile('wiki/concepts/ki.md', '---\ntitle: KI\n---\n# Kuenstliche Intelligenz\nMachine Learning und Deep Learning.');
    await vault.writeFile('wiki/concepts/web.md', '---\ntitle: Web\n---\n# Webentwicklung\nReact und TypeScript.');
    const results = await vault.findRelevantPages(['learning']);
    expect(results).toHaveLength(1);
    expect(results[0].frontmatter.title).toBe('KI');
  });

  it('ignoriert zu kurze Keywords', async () => {
    await vault.writeFile('wiki/concepts/test.md', '---\ntitle: Test\n---\nab');
    const results = await vault.findRelevantPages(['ab']);
    expect(results).toHaveLength(0);
  });
});

describe('slugify', () => {
  it('wandelt in Kleinbuchstaben um', () => {
    expect(slugify('Mein Test')).toBe('mein-test');
  });

  it('ersetzt Umlaute', () => {
    expect(slugify('Überblick')).toBe('ueberblick');
    expect(slugify('Größe')).toBe('groesse');
    expect(slugify('Ärger')).toBe('aerger');
    expect(slugify('Straße')).toBe('strasse');
  });

  it('entfernt Sonderzeichen', () => {
    expect(slugify('Test: Hallo!')).toBe('test-hallo');
  });

  it('entfernt fuehrende/nachfolgende Bindestriche', () => {
    expect(slugify('-test-')).toBe('test');
  });
});
