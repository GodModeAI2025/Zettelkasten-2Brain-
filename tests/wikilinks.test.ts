import { describe, it, expect } from 'vitest';
import { extractWikilinks } from '../src/main/core/wikilinks';

describe('extractWikilinks', () => {
  it('extrahiert einfache Wikilinks', () => {
    const links = extractWikilinks('Siehe [[test-seite]] fuer Details.');
    expect(links).toHaveLength(1);
    expect(links[0].target).toBe('test-seite');
    expect(links[0].displayText).toBe('test-seite');
  });

  it('extrahiert Wikilinks mit Display-Text', () => {
    const links = extractWikilinks('Siehe [[test-seite|mein Link]] hier.');
    expect(links).toHaveLength(1);
    expect(links[0].target).toBe('test-seite');
    expect(links[0].displayText).toBe('mein Link');
  });

  it('extrahiert mehrere Wikilinks', () => {
    const links = extractWikilinks('[[eins]] und [[zwei]] und [[drei|Drei]]');
    expect(links).toHaveLength(3);
    expect(links.map((l) => l.target)).toEqual(['eins', 'zwei', 'drei']);
  });

  it('gibt leeres Array bei keinen Links', () => {
    expect(extractWikilinks('Kein Link hier.')).toHaveLength(0);
  });

  it('trimmt Whitespace in Target und Display', () => {
    const links = extractWikilinks('[[ test | anzeige ]]');
    expect(links[0].target).toBe('test');
    expect(links[0].displayText).toBe('anzeige');
  });
});
