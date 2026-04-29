import { describe, expect, it } from 'vitest';
import { buildWikiReviewQueue } from '../src/main/core/wiki-review';

describe('buildWikiReviewQueue', () => {
  it('listet unreviewed seed Seiten zuerst', () => {
    const queue = buildWikiReviewQueue([
      {
        relativePath: 'wiki/concepts/ki-ingestion.md',
        frontmatter: {
          title: 'KI-Ingestion',
          status: 'seed',
          confidence: 'low',
          reviewed: false,
        },
      },
      {
        relativePath: 'wiki/concepts/lokal-first.md',
        frontmatter: {
          title: 'Lokal-first',
          status: 'confirmed',
          confidence: 'high',
          reviewed: true,
        },
      },
      {
        relativePath: 'wiki/concepts/alte-info.md',
        frontmatter: {
          status: 'stale',
          confidence: 'medium',
          reviewed: true,
        },
      },
    ]);

    expect(queue).toHaveLength(2);
    expect(queue[0]).toMatchObject({
      path: 'concepts/ki-ingestion.md',
      title: 'KI-Ingestion',
      reasons: ['unreviewed', 'seed', 'low-confidence'],
    });
    expect(queue[1]).toMatchObject({
      path: 'concepts/alte-info.md',
      title: 'alte info',
      reasons: ['stale'],
    });
  });

  it('ignoriert Index und Log', () => {
    const queue = buildWikiReviewQueue([
      {
        relativePath: 'wiki/index.md',
        frontmatter: { status: 'seed', reviewed: false },
      },
      {
        relativePath: 'wiki/log.md',
        frontmatter: { status: 'stale' },
      },
    ]);

    expect(queue).toEqual([]);
  });
});
