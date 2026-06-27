import { describe, it, expect } from 'vitest';
import { renderGraphHtml, type GraphHtmlBundle } from '../src/main/core/graph-html';

const bundle: GraphHtmlBundle = {
  title: 'Mein <Wiki>',
  generatedAt: '2026-06-26T00:00:00.000Z',
  nodes: [
    { id: 'concepts/a', label: 'A', group: 'concepts', community: 0, pagerank: 0.5, degree: 2 },
    { id: 'entities/b', label: 'B', group: 'entities', community: 1, pagerank: 0.2, degree: 1 },
  ],
  edges: [{ source: 'concepts/a', target: 'entities/b', weight: 0.7 }],
  bodies: { 'concepts/a': '<p>Body A</p>', 'entities/b': '<p>Body B</p>' },
  backlinks: { 'entities/b': ['concepts/a'] },
};

describe('renderGraphHtml', () => {
  const html = renderGraphHtml(bundle);

  it('ist ein eigenstaendiges HTML-Dokument ohne externe Skripte', () => {
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).not.toMatch(/<script[^>]+src=/); // kein CDN/externes Script
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
  });

  it('bettet die Bundle-Daten ein', () => {
    expect(html).toContain('window.BUNDLE=');
    expect(html).toContain('Body A');
    expect(html).toContain('concepts/a');
  });

  it('escaped < im eingebetteten JSON (kein Tag-/script-Ausbruch)', () => {
    // Der Titel enthaelt <Wiki>; im JSON-Blob darf kein rohes "<" stehen.
    const scriptStart = html.indexOf('window.BUNDLE=');
    const scriptEnd = html.indexOf('</script>', scriptStart);
    const blob = html.slice(scriptStart, scriptEnd);
    expect(blob).toContain('\\u003c'); // < wurde escaped
    expect(blob).not.toContain('<Wiki>');
  });

  it('escaped den Titel im <title>', () => {
    expect(html).toContain('<title>Mein &lt;Wiki&gt;</title>');
  });
});
