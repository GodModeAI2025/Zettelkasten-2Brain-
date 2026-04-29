import { describe, expect, it } from 'vitest';
import { createWikiPageDraft } from '../src/main/core/wiki-page-draft';

describe('createWikiPageDraft', () => {
  it('legt offene Links als Konzept-Stubs an', () => {
    const draft = createWikiPageDraft(
      { title: 'Offenes Thema', sourcePath: 'wiki/syntheses/demo-workflow.md' },
      '2026-04-27',
    );

    expect(draft.relativePath).toBe('concepts/offenes-thema.md');
    expect(draft.stubPath).toBe('concepts/offenes-thema');
    expect(draft.content).toContain('title: Offenes Thema');
    expect(draft.content).toContain('type: concept');
    expect(draft.content).toContain('[[syntheses/demo-workflow]]');
  });

  it('respektiert explizite Stub-Pfade', () => {
    const draft = createWikiPageDraft(
      { title: 'Demo Entscheidung', path: 'decisions/demo-entscheidung' },
      '2026-04-27',
    );

    expect(draft.relativePath).toBe('decisions/demo-entscheidung.md');
    expect(draft.content).toContain('type: decision');
  });

  it('verhindert Pfade ausserhalb des Wikis', () => {
    expect(() => createWikiPageDraft({ title: 'Nope', path: '../nope' })).toThrow('Ungueltiger Wiki-Pfad.');
  });
});
