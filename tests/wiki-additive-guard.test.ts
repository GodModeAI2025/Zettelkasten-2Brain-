import { describe, it, expect } from 'vitest';
import { diffShrink, isLegitimateShrink } from '../src/main/core/wiki-additive-guard';

const page = (fm: string, body: string) => `---\n${fm}\n---\n${body}`;

describe('diffShrink', () => {
  it('erkennt entfernte Quellen', () => {
    const oldC = page('sources: [a.md, b.md]', '# T\nText.');
    const newC = page('sources: [a.md]', '# T\nText.');
    const r = diffShrink(oldC, newC);
    expect(r.shrunk).toBe(true);
    expect(r.removedSources).toEqual(['b.md']);
  });

  it('erkennt entfernte H2-Abschnitte', () => {
    const oldC = page('sources: [a.md]', '# T\n## Gegenargumente\n- x\n## Datenluecken\n- y\n');
    const newC = page('sources: [a.md]', '# T\n## Datenluecken\n- y\n');
    const r = diffShrink(oldC, newC);
    expect(r.shrunk).toBe(true);
    expect(r.removedHeadings).toContain('gegenargumente');
  });

  it('erkennt stark gekuerzten Body', () => {
    const oldC = page('sources: [a.md]', '# T\n' + 'Lorem ipsum dolor sit amet. '.repeat(20));
    const newC = page('sources: [a.md]', '# T\nKurz.');
    const r = diffShrink(oldC, newC);
    expect(r.shrunk).toBe(true);
    expect(r.bodyRatio).toBeLessThan(0.6);
  });

  it('meldet KEINE Schrumpfung bei additivem Update', () => {
    const oldC = page('sources: [a.md]', '# T\nText.');
    const newC = page('sources: [a.md, b.md]', '# T\nText.\n## Neuer Abschnitt\nMehr.');
    expect(diffShrink(oldC, newC).shrunk).toBe(false);
  });
});

describe('isLegitimateShrink', () => {
  it('akzeptiert stale als legitim', () => {
    expect(isLegitimateShrink(page('status: stale', '# T'))).toBe(true);
  });
  it('akzeptiert superseded_by als legitim', () => {
    expect(isLegitimateShrink(page('superseded_by: [[neu]]', '# T'))).toBe(true);
  });
  it('normales Update ist nicht automatisch legitim', () => {
    expect(isLegitimateShrink(page('status: confirmed', '# T'))).toBe(false);
  });
});
