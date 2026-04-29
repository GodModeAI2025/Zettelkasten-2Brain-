import { describe, expect, it } from 'vitest';
import { findBacklinks } from '../src/main/core/wiki-relations';

describe('findBacklinks', () => {
  it('findet Seiten, die auf das Ziel verweisen', () => {
    const backlinks = findBacklinks(
      [
        {
          relativePath: 'wiki/concepts/lokal-first.md',
          content: '# Lokal-first\n',
        },
        {
          relativePath: 'wiki/syntheses/demo-workflow.md',
          content: 'Siehe [[lokal-first]] und [[Lokal first|Prinzip]].',
          frontmatter: { title: 'Demo-Workflow' },
        },
      ],
      'concepts/lokal-first.md',
    );

    expect(backlinks).toEqual([
      {
        path: 'syntheses/demo-workflow.md',
        title: 'Demo-Workflow',
        count: 2,
        matches: ['lokal-first', 'Prinzip'],
      },
    ]);
  });

  it('ignoriert Selbstlinks und Systemseiten', () => {
    const backlinks = findBacklinks(
      [
        {
          relativePath: 'wiki/concepts/lokal-first.md',
          content: 'Selbst: [[lokal-first]]',
        },
        {
          relativePath: 'wiki/index.md',
          content: 'Index: [[lokal-first]]',
        },
      ],
      'wiki/concepts/lokal-first.md',
    );

    expect(backlinks).toEqual([]);
  });

  it('nutzt Frontmatter-Titel als Ruecklink-Anzeige', () => {
    const backlinks = findBacklinks(
      [
        {
          relativePath: 'wiki/concepts/ki-ingestion.md',
          content: 'Verweist auf [[concepts/lokal-first]].',
          frontmatter: { title: 'KI-Ingestion' },
        },
      ],
      'wiki/concepts/lokal-first.md',
    );

    expect(backlinks[0]?.title).toBe('KI-Ingestion');
  });
});
