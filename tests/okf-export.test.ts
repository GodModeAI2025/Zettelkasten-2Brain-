import { describe, it, expect } from 'vitest';
import { buildOkfBundle, type ExportPage } from '../src/main/core/okf-export';

const OPTS = { generator: 'Test 1.0', generatedAt: '2026-06-26T00:00:00.000Z' };

function fileMap(pages: ExportPage[]) {
  const bundle = buildOkfBundle(pages, OPTS);
  const map = new Map(bundle.files.map((f) => [f.path, f.content]));
  return { bundle, map };
}

describe('buildOkfBundle — Wikilink-Konvertierung', () => {
  it('konvertiert [[X]] in relativen Markdown-Link (gleiches Verzeichnis)', () => {
    const { map } = fileMap([
      { id: 'concepts/alpha', content: '---\ntitle: Alpha\n---\nSiehe [[beta]].' },
      { id: 'concepts/beta', content: '---\ntitle: Beta\n---\nText.' },
    ]);
    expect(map.get('concepts/alpha.md')).toContain('Siehe [beta](./beta.md).');
  });

  it('konvertiert ueber Verzeichnisgrenzen mit ../', () => {
    const { map } = fileMap([
      { id: 'concepts/alpha', content: '---\ntitle: Alpha\n---\nVgl. [[Firma|die Firma]].' },
      { id: 'entities/firma', content: '---\ntitle: Firma\n---\nText.' },
    ]);
    expect(map.get('concepts/alpha.md')).toContain('[die Firma](../entities/firma.md)');
  });

  it('erzeugt NIE fuehrende /-Pfade (OKF-Verbot)', () => {
    const { map } = fileMap([
      { id: 'concepts/alpha', content: '---\n---\n[[beta]]' },
      { id: 'concepts/beta', content: '---\n---\nx' },
    ]);
    expect(map.get('concepts/alpha.md')).not.toMatch(/\]\(\//);
  });

  it('laesst unaufloesbare Links als Klartext und meldet sie im Manifest', () => {
    const { bundle, map } = fileMap([
      { id: 'concepts/alpha', content: '---\n---\nSiehe [[gibtsnicht]].' },
    ]);
    expect(map.get('concepts/alpha.md')).toContain('Siehe gibtsnicht.');
    expect(map.get('concepts/alpha.md')).not.toContain('[[');
    expect(bundle.manifest.unresolved_links).toEqual([{ page: 'concepts/alpha', target: 'gibtsnicht' }]);
  });

  it('konvertiert KEINE Wikilinks im Frontmatter-Body-Text faelschlich (superseded_by separat)', () => {
    const { map } = fileMap([
      { id: 'concepts/alt', content: '---\nsuperseded_by: [[neu]]\nstatus: stale\n---\nAlt.' },
      { id: 'concepts/neu', content: '---\ntitle: Neu\n---\nNeu.' },
    ]);
    const alt = map.get('concepts/alt.md') || '';
    expect(alt).toContain('superseded_by: ./neu.md'); // als relativer Pfad im Frontmatter
    expect(alt).not.toContain('[[neu]]');
  });
});

describe('buildOkfBundle — Frontmatter & Struktur', () => {
  it('setzt OKF-type aus der Kategorie und entfernt type/-Tag', () => {
    const { map } = fileMap([
      { id: 'entities/x', content: '---\ntitle: X\ntags: [topic/a, type/entity]\nupdated: 2026-01-01\n---\nText.' },
    ]);
    const out = map.get('entities/x.md') || '';
    expect(out).toMatch(/type: entity/);
    expect(out).toContain('tags: [topic/a]');
    expect(out).not.toContain('type/entity');
    expect(out).toContain('timestamp: 2026-01-01');
  });

  it('schreibt OKF-Index mit Markdown-Links + Beschreibung', () => {
    const { map } = fileMap([
      { id: 'concepts/alpha', content: '---\ntitle: Alpha\ndescription: Alpha kurz.\n---\nBody.' },
    ]);
    expect(map.get('concepts/index.md')).toContain('* [Alpha](alpha.md) - Alpha kurz.');
    expect(map.get('index.md')).toContain('okf_version: "0.1"');
    expect(map.get('index.md')).toContain('* [Alpha](concepts/alpha.md) - Alpha kurz.');
  });

  it('schreibt ein Manifest okf.json', () => {
    const { bundle } = fileMap([{ id: 'concepts/a', content: '---\n---\nx' }]);
    expect(bundle.manifest.page_count).toBe(1);
    expect(bundle.manifest.okf_version).toBe('0.1');
    expect(bundle.files.some((f) => f.path === 'okf.json')).toBe(true);
  });
});
