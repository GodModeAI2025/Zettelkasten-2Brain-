import { describe, expect, it } from 'vitest';
import { findMissingSourceRefs } from '../src/main/core/wiki-source-refs';

describe('findMissingSourceRefs', () => {
  it('meldet sources-Eintraege ohne Rohdatei', () => {
    const missing = findMissingSourceRefs(
      [
        { id: 'concepts/lokal-first', frontmatter: { sources: ['notiz.md', 'geloescht.md'] } },
        { id: 'entities/claude', frontmatter: { sources: 'raw/interview.md' } },
      ],
      ['notiz.md', 'interview.md'],
    );

    expect(missing).toEqual([{ file: 'concepts/lokal-first', source: 'geloescht.md' }]);
  });

  it('akzeptiert Unterordner, raw/-Praefix und Originalendungen', () => {
    const missing = findMissingSourceRefs(
      [
        {
          id: 'sources/studie',
          frontmatter: { sources: ['raw/papers/Studie.md', 'Studie.pdf', 'papers/studie.md'] },
        },
      ],
      ['papers/studie.md'],
    );

    expect(missing).toEqual([]);
  });

  it('ignoriert URLs, Wiki-Pfade und Nicht-String-Werte', () => {
    const missing = findMissingSourceRefs(
      [
        {
          id: 'syntheses/ueberblick',
          frontmatter: {
            sources: ['https://example.com/artikel', 'example.com/blog/post', 'www.heise.de', 'wiki/concepts/x.md', 42, ''],
          },
        },
        { id: 'concepts/ohne-quellen', frontmatter: {} },
      ],
      [],
    );

    expect(missing).toEqual([]);
  });

  it('prueft Dateinamen mit Endung weiterhin, auch wenn sie wie eine Domain aussehen', () => {
    const missing = findMissingSourceRefs(
      [{ id: 'concepts/x', frontmatter: { sources: ['bericht.pdf', 'protokoll.md'] } }],
      ['protokoll.md'],
    );

    expect(missing).toEqual([{ file: 'concepts/x', source: 'bericht.pdf' }]);
  });
});
