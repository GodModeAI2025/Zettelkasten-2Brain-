import { describe, it, expect } from 'vitest';
import { mdLinkToWikilink, transformImportedPage } from '../src/main/core/wiki-import';
import { parseFrontmatterBlock } from '../src/main/core/vault';

describe('mdLinkToWikilink', () => {
  it('konvertiert relativen .md-Link in [[slug|label]]', () => {
    expect(mdLinkToWikilink('Siehe [die Firma](../entities/firma.md).'))
      .toBe('Siehe [[firma|die Firma]].');
  });

  it('verzichtet auf Label wenn es dem Slug entspricht', () => {
    expect(mdLinkToWikilink('Vgl. [firma](./firma.md).')).toBe('Vgl. [[firma]].');
  });

  it('laesst externe Links unangetastet', () => {
    const s = 'Quelle: [Google](https://google.com) und [Mail](mailto:x@y.de).';
    expect(mdLinkToWikilink(s)).toBe(s);
  });

  it('ignoriert Nicht-.md-Links', () => {
    const s = 'Bild [x](./img.png).';
    expect(mdLinkToWikilink(s)).toBe(s);
  });
});

describe('transformImportedPage', () => {
  it('mappt OKF-type auf Verzeichnis und erzwingt reviewed:false', () => {
    const page = transformImportedPage('foo.md', '---\ntype: entity\ntitle: Foo\n---\nText.');
    expect(page.wikiRelativePath).toBe('wiki/entities/foo.md');
    const { data } = parseFrontmatterBlock(page.content);
    expect(data.type).toBe('entity');
    expect(data.reviewed).toBe(false);
    expect(data.title).toBe('Foo');
  });

  it('nutzt das Bundle-Verzeichnis wenn kein type-Feld da ist', () => {
    const page = transformImportedPage('concepts/bar.md', '---\ntitle: Bar\n---\nText.');
    expect(page.wikiRelativePath).toBe('wiki/concepts/bar.md');
  });

  it('faellt auf concepts zurueck', () => {
    const page = transformImportedPage('irgendwo/baz.md', '---\n---\nText.');
    expect(page.wikiRelativePath).toBe('wiki/concepts/baz.md');
  });

  it('konvertiert Body-Links zu Wikilinks und erhaelt unbekannte Keys', () => {
    const page = transformImportedPage('concepts/a.md', '---\ncustom_key: behalten\n---\nSiehe [die B-Seite](../entities/b.md).');
    expect(page.content).toContain('[[b|die B-Seite]]');
    expect(page.content).toContain('custom_key: behalten');
  });
});
