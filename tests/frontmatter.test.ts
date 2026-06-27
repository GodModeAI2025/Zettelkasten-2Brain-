import { describe, it, expect } from 'vitest';
import { parseFrontmatterBlock, serializeFrontmatter, updateFrontmatter } from '../src/main/core/vault';

describe('parseFrontmatterBlock', () => {
  it('parst flache Key-Value-Paare', () => {
    const { data, body, hasFrontmatter } = parseFrontmatterBlock('---\ntitle: Hallo\nstatus: seed\n---\n# Body\n');
    expect(hasFrontmatter).toBe(true);
    expect(data.title).toBe('Hallo');
    expect(data.status).toBe('seed');
    expect(body).toBe('# Body\n');
  });

  it('parst Inline-Arrays', () => {
    const { data } = parseFrontmatterBlock('---\nsources: [a.md, b.md]\n---\n');
    expect(data.sources).toEqual(['a.md', 'b.md']);
  });

  it('behandelt Wikilink-Werte als String, nicht als Array', () => {
    const { data } = parseFrontmatterBlock('---\nsuperseded_by: [[neue-seite]]\n---\n');
    expect(data.superseded_by).toBe('[[neue-seite]]');
    expect(Array.isArray(data.superseded_by)).toBe(false);
  });

  it('gibt hasFrontmatter=false bei Datei ohne Frontmatter', () => {
    const { hasFrontmatter, data, body } = parseFrontmatterBlock('# Nur Body\nText.');
    expect(hasFrontmatter).toBe(false);
    expect(data).toEqual({});
    expect(body).toBe('# Nur Body\nText.');
  });

  it('parst leeres Array', () => {
    const { data } = parseFrontmatterBlock('---\ntags: []\n---\n');
    expect(data.tags).toEqual([]);
  });
});

describe('serializeFrontmatter', () => {
  it('serialisiert flache Objekte zurueck', () => {
    const out = serializeFrontmatter({ title: 'Hallo', status: 'seed' });
    expect(out).toBe('---\ntitle: Hallo\nstatus: seed\n---\n');
  });

  it('serialisiert Arrays inline', () => {
    const out = serializeFrontmatter({ sources: ['a.md', 'b.md'] });
    expect(out).toBe('---\nsources: [a.md, b.md]\n---\n');
  });

  it('ueberspringt undefined, behaelt null', () => {
    const out = serializeFrontmatter({ a: 1, b: undefined, c: null });
    expect(out).toBe('---\na: 1\nc:\n---\n');
  });

  it('quotet Werte mit Doppelpunkt (sonst ungueltiges YAML)', () => {
    const out = serializeFrontmatter({ title: 'Foo: Bar' });
    expect(out).toBe('---\ntitle: "Foo: Bar"\n---\n');
  });

  it('quotet fuehrende YAML-Indikatorzeichen und Hash', () => {
    expect(serializeFrontmatter({ d: '[Entwurf] Notiz' })).toContain('d: "[Entwurf] Notiz"');
    expect(serializeFrontmatter({ d: 'a # b' })).toContain('d: "a # b"');
    expect(serializeFrontmatter({ d: 'true' })).toContain('d: "true"');
  });

  it('laesst harmlose Werte (Slugs, Daten, URLs) ungequotet', () => {
    expect(serializeFrontmatter({ created: '2026-06-26' })).toContain('created: 2026-06-26');
    expect(serializeFrontmatter({ resource: 'https://example.com/a?b=1' }))
      .toContain('resource: https://example.com/a?b=1');
    expect(serializeFrontmatter({ status: 'seed' })).toContain('status: seed');
  });

  it('laesst Wikilink-Werte im Live-Vault nativ (unquoted [[X]])', () => {
    expect(serializeFrontmatter({ superseded_by: '[[neu]]' })).toContain('superseded_by: [[neu]]');
  });
});

describe('serialize/parse round-trip (YAML-Haertung)', () => {
  const cases: Array<[string, unknown]> = [
    ['title', 'Foo: Bar'],
    ['description', '[Entwurf] mit # Hash und : Doppelpunkt'],
    ['resource', 'https://example.com/path?x=1&y=2'],
    ['superseded_by', '[[neuere-seite]]'],
    ['created', '2026-06-26'],
    ['status', 'seed'],
  ];

  for (const [key, value] of cases) {
    it(`roundtrip: ${key} = ${JSON.stringify(value)}`, () => {
      const serialized = serializeFrontmatter({ [key]: value });
      const { data } = parseFrontmatterBlock(serialized + 'Body\n');
      expect(data[key]).toEqual(value);
    });
  }

  it('roundtrip behaelt Arrays', () => {
    const serialized = serializeFrontmatter({ tags: ['topic/a', 'type/source'], sources: ['x.md'] });
    const { data } = parseFrontmatterBlock(serialized);
    expect(data.tags).toEqual(['topic/a', 'type/source']);
    expect(data.sources).toEqual(['x.md']);
  });
});

describe('updateFrontmatter', () => {
  it('roundtripped ohne Aenderung', () => {
    const input = '---\nstatus: seed\nsources: [a.md]\n---\n# Body';
    const out = updateFrontmatter(input, () => { /* keine aenderung */ });
    expect(out).toContain('status: seed');
    expect(out).toContain('# Body');
  });

  it('gibt null zurueck wenn kein Frontmatter', () => {
    expect(updateFrontmatter('# Kein Frontmatter', () => { /* */ })).toBeNull();
  });

  it('setzt status ohne andere Felder zu beschaedigen', () => {
    const input = '---\nstatus: seed\nsources: [a.md, b.md]\nsuperseded_by: [[neu]]\n---\n# Body';
    const out = updateFrontmatter(input, (fm) => { fm.status = 'stale'; });
    expect(out).toContain('status: stale');
    expect(out).toContain('sources: [a.md, b.md]');
    expect(out).toContain('superseded_by: [[neu]]');
    expect(out).toContain('# Body');
  });

  it('fuegt fehlende Felder hinzu', () => {
    const input = '---\ntitle: X\n---\n# Body';
    const out = updateFrontmatter(input, (fm) => {
      if (!fm.status) fm.status = 'seed';
      if (!fm.confidence) fm.confidence = 'low';
    });
    expect(out).toContain('status: seed');
    expect(out).toContain('confidence: low');
  });
});
