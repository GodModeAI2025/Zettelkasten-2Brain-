import { describe, it, expect } from 'vitest';
import { extractCanonicalUrl } from '../src/main/services/convert.service';

describe('extractCanonicalUrl', () => {
  it('liest <link rel="canonical">', () => {
    const html = '<html><head><link rel="canonical" href="https://example.com/artikel"></head></html>';
    expect(extractCanonicalUrl(html)).toBe('https://example.com/artikel');
  });

  it('liest canonical unabhaengig von der Attribut-Reihenfolge', () => {
    const html = '<link href="https://x.de/a" rel="canonical" />';
    expect(extractCanonicalUrl(html)).toBe('https://x.de/a');
  });

  it('faellt auf og:url zurueck', () => {
    const html = '<meta property="og:url" content="https://example.com/og">';
    expect(extractCanonicalUrl(html)).toBe('https://example.com/og');
  });

  it('bevorzugt canonical vor og:url', () => {
    const html = '<link rel="canonical" href="https://c.de/"><meta property="og:url" content="https://og.de/">';
    expect(extractCanonicalUrl(html)).toBe('https://c.de/');
  });

  it('gibt undefined ohne URL', () => {
    expect(extractCanonicalUrl('<html><head></head></html>')).toBeUndefined();
  });
});
