import { describe, it, expect } from 'vitest';
import { applyWikiFrontmatterPatch } from '../src/main/core/wiki-frontmatter';

describe('applyWikiFrontmatterPatch', () => {
  it('aktualisiert editierbare Felder und setzt updated', () => {
    const fm: Record<string, unknown> = {
      status: 'seed',
      confidence: 'low',
      reviewed: false,
      sources: ['a.md'],
    };

    const changed = applyWikiFrontmatterPatch(
      fm,
      {
        status: 'confirmed',
        confidence: 'high',
        reviewed: true,
        tags: ['ai', 'wiki'],
        sources: ['a.md', 'b.md'],
      },
      '2026-04-26',
    );

    expect(changed).toEqual(['status', 'confidence', 'tags', 'sources', 'reviewed']);
    expect(fm).toMatchObject({
      status: 'confirmed',
      confidence: 'high',
      reviewed: true,
      tags: ['ai', 'wiki'],
      sources: ['a.md', 'b.md'],
      updated: '2026-04-26',
    });
  });

  it('entfernt leere optionale Felder', () => {
    const fm: Record<string, unknown> = {
      type: 'concept',
      tags: ['old'],
      superseded_by: '[[new]]',
    };

    const changed = applyWikiFrontmatterPatch(
      fm,
      {
        type: '',
        tags: [],
        superseded_by: null,
      },
      '2026-04-26',
    );

    expect(changed).toEqual(['type', 'superseded_by', 'tags']);
    expect(fm.type).toBeUndefined();
    expect(fm.tags).toBeUndefined();
    expect(fm.superseded_by).toBeUndefined();
    expect(fm.updated).toBe('2026-04-26');
  });

  it('laesst updated unveraendert wenn nichts geaendert wurde', () => {
    const fm: Record<string, unknown> = {
      status: 'seed',
      tags: ['ai'],
      updated: '2026-04-01',
    };

    const changed = applyWikiFrontmatterPatch(
      fm,
      {
        status: 'seed',
        tags: ['ai'],
      },
      '2026-04-26',
    );

    expect(changed).toEqual([]);
    expect(fm.updated).toBe('2026-04-01');
  });
});
