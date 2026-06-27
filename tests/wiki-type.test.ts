import { describe, it, expect } from 'vitest';
import {
  resolvePageType,
  ensureFrontmatterType,
  categoryFromWikiPath,
  typeForCategory,
  parseFrontmatterBlock,
} from '../src/main/core/vault';

describe('typeForCategory / categoryFromWikiPath', () => {
  it('mappt Kategorie auf Typ', () => {
    expect(typeForCategory('concepts')).toBe('concept');
    expect(typeForCategory('syntheses')).toBe('synthesis');
    expect(typeForCategory('decisions')).toBe('decision');
    expect(typeForCategory('unbekannt')).toBeUndefined();
  });

  it('leitet Kategorie aus Pfad ab (mit/ohne wiki-Praefix)', () => {
    expect(categoryFromWikiPath('wiki/concepts/foo.md')).toBe('concepts');
    expect(categoryFromWikiPath('entities/bar.md')).toBe('entities');
    expect(categoryFromWikiPath('raw/x.md')).toBeUndefined();
  });
});

describe('resolvePageType', () => {
  it('bevorzugt das echte type-Feld', () => {
    expect(resolvePageType({ type: 'concept', tags: ['type/source'] })).toBe('concept');
  });

  it('faellt auf type/-Tag zurueck (Back-Compat alte KI-Seiten)', () => {
    expect(resolvePageType({ tags: ['topic/x', 'type/source'] })).toBe('source');
  });

  it('gibt undefined wenn weder Feld noch Tag', () => {
    expect(resolvePageType({ tags: ['topic/x'] })).toBeUndefined();
    expect(resolvePageType({})).toBeUndefined();
  });
});

describe('ensureFrontmatterType', () => {
  it('ergaenzt fehlendes type-Feld aus dem Verzeichnis', () => {
    const content = '---\nstatus: seed\n---\n# Body\n';
    const out = ensureFrontmatterType(content, 'wiki/concepts/foo.md');
    expect(parseFrontmatterBlock(out).data.type).toBe('concept');
  });

  it('ueberschreibt ein vorhandenes type-Feld NICHT', () => {
    const content = '---\ntype: decision\nstatus: seed\n---\n# Body\n';
    const out = ensureFrontmatterType(content, 'wiki/concepts/foo.md');
    expect(parseFrontmatterBlock(out).data.type).toBe('decision');
  });

  it('laesst Inhalt unangetastet bei unbekanntem Verzeichnis', () => {
    const content = '---\nstatus: seed\n---\n# Body\n';
    expect(ensureFrontmatterType(content, 'raw/foo.md')).toBe(content);
  });
});
