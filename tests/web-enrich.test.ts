import { describe, it, expect } from 'vitest';
import { makeFetchUrlHandler, buildWebEnrichPrompt, WEB_FETCH_TOOL } from '../src/main/core/web-enrich';
import { createWebState, type WebState, type FetchedPage } from '../src/main/core/web-fetch';

function fakeFetcher(page: Partial<FetchedPage>) {
  return async (url: string): Promise<FetchedPage> => ({
    url, title: page.title ?? 'T', markdown: page.markdown ?? 'md', links: page.links ?? [],
  });
}

describe('WEB_FETCH_TOOL', () => {
  it('definiert das fetch_url-Tool-Schema', () => {
    expect(WEB_FETCH_TOOL.name).toBe('fetch_url');
    expect(WEB_FETCH_TOOL.input_schema.required).toContain('url');
  });
});

describe('makeFetchUrlHandler — Budget/Scope im Tool erzwungen', () => {
  it('blockt fremde Hosts ohne den Fetcher aufzurufen', async () => {
    let called = false;
    const state = createWebState(['https://docs.example.com/']);
    const handler = makeFetchUrlHandler(state, async (u) => { called = true; return { url: u, title: '', markdown: '', links: [] }; });
    const out = JSON.parse(await handler('fetch_url', { url: 'https://evil.com/x' }));
    expect(out.error).toContain('Seed-Domains');
    expect(called).toBe(false);
  });

  it('blockt SSRF', async () => {
    const state = createWebState([], { allowedHosts: new Set(['127.0.0.1']) });
    const handler = makeFetchUrlHandler(state, fakeFetcher({}));
    const out = JSON.parse(await handler('fetch_url', { url: 'http://127.0.0.1/' }));
    expect(out.error).toContain('SSRF');
  });

  it('laedt erlaubte URL, zaehlt das Budget und filtert Frontier-Links auf erlaubte Hosts', async () => {
    const state: WebState = createWebState(['https://x.com/start']);
    const handler = makeFetchUrlHandler(state, fakeFetcher({
      title: 'Start', markdown: '# Inhalt', links: ['https://x.com/a', 'https://fremd.com/b'],
    }));
    const out = JSON.parse(await handler('fetch_url', { url: 'https://x.com/start', depth: 0 }));
    expect(out.title).toBe('Start');
    expect(out.links).toEqual(['https://x.com/a']); // fremd.com herausgefiltert
    expect(state.fetched).toBe(1);
    expect(out.budget.fetched).toBe(1);
  });

  it('erzwingt das Seiten-Budget ueber mehrere Calls', async () => {
    const state = createWebState(['https://x.com/'], { maxPages: 1 });
    const handler = makeFetchUrlHandler(state, fakeFetcher({ links: [] }));
    const ok = JSON.parse(await handler('fetch_url', { url: 'https://x.com/a' }));
    expect(ok.error).toBeUndefined();
    const blocked = JSON.parse(await handler('fetch_url', { url: 'https://x.com/b' }));
    expect(blocked.error).toContain('Budget');
  });

  it('gibt einen Fehler bei unbekanntem Tool', async () => {
    const handler = makeFetchUrlHandler(createWebState(['https://x.com/']), fakeFetcher({}));
    const out = JSON.parse(await handler('anderes_tool', {}));
    expect(out.error).toContain('Unbekanntes Tool');
  });
});

describe('buildWebEnrichPrompt', () => {
  it('listet Seeds und Allow-List', () => {
    const p = buildWebEnrichPrompt(['https://x.com/'], ['concepts/a', 'entities/b']);
    expect(p).toContain('https://x.com/');
    expect(p).toContain('concepts/a');
    expect(p).toContain('entities/b');
  });
});
