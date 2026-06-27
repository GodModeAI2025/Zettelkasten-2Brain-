import { describe, it, expect } from 'vitest';
import {
  createWebState, checkFetchAllowed, recordFetch, isPrivateHost,
  normalizeUrl, hostOf, extractTitleAndLinks,
} from '../src/main/core/web-fetch';

describe('isPrivateHost (SSRF-Schutz)', () => {
  const blocked = ['localhost', '127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.0.1', '172.31.255.255',
    '169.254.169.254', '::1', '0.0.0.0', 'foo.local', 'service.internal', 'fc00::1', 'fe80::1'];
  const allowed = ['example.com', '8.8.8.8', '172.32.0.1', '172.15.0.1', 'sub.domain.org'];
  for (const h of blocked) it(`blockt ${h}`, () => expect(isPrivateHost(h)).toBe(true));
  for (const h of allowed) it(`erlaubt ${h}`, () => expect(isPrivateHost(h)).toBe(false));
});

describe('createWebState + checkFetchAllowed', () => {
  it('leitet erlaubte Hosts aus den Seeds ab', () => {
    const s = createWebState(['https://docs.example.com/start']);
    expect(s.config.allowedHosts.has('docs.example.com')).toBe(true);
    expect(checkFetchAllowed('https://docs.example.com/a', 1, s).allowed).toBe(true);
  });

  it('blockt fremde Hosts', () => {
    const s = createWebState(['https://docs.example.com/']);
    const d = checkFetchAllowed('https://evil.com/x', 1, s);
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('Seed-Domains');
  });

  it('blockt SSRF auch wenn Host auf der Allowlist stuende', () => {
    const s = createWebState([], { allowedHosts: new Set(['127.0.0.1']) });
    expect(checkFetchAllowed('http://127.0.0.1/admin', 1, s).allowed).toBe(false);
  });

  it('blockt nicht-http(s)-Protokolle', () => {
    const s = createWebState(['https://x.com/']);
    expect(checkFetchAllowed('file:///etc/passwd', 1, s).allowed).toBe(false);
    expect(checkFetchAllowed('ftp://x.com/a', 1, s).allowed).toBe(false);
  });

  it('erzwingt Tiefenlimit', () => {
    const s = createWebState(['https://x.com/'], { maxDepth: 2 });
    expect(checkFetchAllowed('https://x.com/a', 3, s).allowed).toBe(false);
  });

  it('erzwingt Seiten-Budget', () => {
    const s = createWebState(['https://x.com/'], { maxPages: 2 });
    recordFetch('https://x.com/a', s);
    recordFetch('https://x.com/b', s);
    expect(s.fetched).toBe(2);
    const d = checkFetchAllowed('https://x.com/c', 1, s);
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('Budget');
  });

  it('verhindert doppeltes Laden (visited, Fragment-agnostisch)', () => {
    const s = createWebState(['https://x.com/']);
    recordFetch('https://x.com/a#section', s);
    expect(checkFetchAllowed('https://x.com/a', 1, s).allowed).toBe(false);
  });
});

describe('normalizeUrl / extractTitleAndLinks', () => {
  it('entfernt das Fragment und kleinschreibt den Host', () => {
    expect(normalizeUrl('https://Example.COM/a#x')).toBe('https://example.com/a');
  });
  it('extrahiert Titel und absolute Links', () => {
    const html = '<title>Hallo</title><a href="/b">B</a><a href="https://x.com/c">C</a>';
    const r = extractTitleAndLinks(html, 'https://x.com/a');
    expect(r.title).toBe('Hallo');
    expect(r.links).toContain('https://x.com/b');
    expect(r.links).toContain('https://x.com/c');
  });
  it('hostOf liest den Hostnamen', () => {
    expect(hostOf('https://Docs.Example.com/x')).toBe('docs.example.com');
    expect(hostOf('kaputt')).toBeNull();
  });
});
