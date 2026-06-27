import type { ToolDefinition, ToolHandler } from './claude';
import {
  checkFetchAllowed,
  recordFetch,
  fetchUrlBounded,
  hostOf,
  type WebState,
  type FetchedPage,
} from './web-fetch';

/**
 * Web-Enrichment-Ingestion (L-1): der LLM agiert als gebudgetierter Crawler.
 * Das `fetch_url`-Tool ist die EINZIGE Netzwerk-Schnittstelle; alle Limits
 * werden in checkFetchAllowed/web-fetch.ts erzwungen, nie dem Modell vertraut.
 */

export const WEB_FETCH_TOOL: ToolDefinition = {
  name: 'fetch_url',
  description:
    'Laedt eine Webseite und gibt sie als Markdown zurueck. Limits (Seiten-Budget, Crawl-Tiefe, erlaubte Domains, SSRF-Schutz) werden serverseitig erzwungen. Bei Verstoss kommt {"error": "..."} zurueck — versuche NICHT, Limits zu umgehen, sondern waehle eine andere erlaubte URL oder beende.',
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Die zu ladende URL (http/https).' },
      depth: { type: 'number', description: 'Crawl-Tiefe ab den Seed-URLs (Seed = 0).' },
    },
    required: ['url'],
  },
};

type Fetcher = (url: string, state: WebState, signal?: AbortSignal) => Promise<FetchedPage>;

const MAX_FRONTIER_LINKS = 50;

/**
 * Baut den Tool-Handler. Der Fetcher ist injizierbar, damit die Guard-Logik
 * ohne echtes Netzwerk getestet werden kann.
 */
export function makeFetchUrlHandler(
  state: WebState,
  fetcher: Fetcher = fetchUrlBounded,
  signal?: AbortSignal,
): ToolHandler {
  return async (name, input) => {
    if (name !== 'fetch_url') return JSON.stringify({ error: `Unbekanntes Tool: ${name}` });
    const obj = (input ?? {}) as { url?: unknown; depth?: unknown };
    const url = typeof obj.url === 'string' ? obj.url : '';
    const depth = typeof obj.depth === 'number' ? obj.depth : 0;

    const decision = checkFetchAllowed(url, depth, state);
    if (!decision.allowed) return JSON.stringify({ error: decision.reason });

    try {
      const page = await fetcher(url, state, signal);
      recordFetch(url, state);
      // Nur Links auf erlaubten Hosts an das Modell zurueckgeben (Crawl-Frontier).
      const links = page.links
        .filter((l) => state.config.allowedHosts.has(hostOf(l) ?? ''))
        .slice(0, MAX_FRONTIER_LINKS);
      return JSON.stringify({
        url: page.url,
        title: page.title,
        markdown: page.markdown,
        links,
        budget: { fetched: state.fetched, maxPages: state.config.maxPages },
      });
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    }
  };
}

/** Baut den User-Prompt: Seeds + Allow-List bestehender Seiten (gegen Broken Links). */
export function buildWebEnrichPrompt(seedUrls: string[], existingPageIds: string[]): string {
  const seeds = seedUrls.map((u) => `- ${u}`).join('\n');
  const allow = existingPageIds.length
    ? existingPageIds.map((id) => `- ${id}`).join('\n')
    : '(noch keine Seiten)';
  return `## Seed-URLs

${seeds}

## Verfuegbare Wiki-Seiten (Allow-List fuer [[Wikilinks]])

${allow}

## Auftrag

Lade ausgehend von den Seed-URLs mit \`fetch_url\` die relevantesten Seiten (das Tool erzwingt das Budget). Entscheide pro Inhalt: bestehende Seite anreichern, neue Seite anlegen, oder ueberspringen. Setze \`resource:\` auf die jeweilige Quell-URL. Gib am Ende AUSSCHLIESSLICH das operations-JSON im beschriebenen Format aus.`;
}
