import { NodeHtmlMarkdown } from 'node-html-markdown';

/**
 * Sicherheits- und Budget-Schicht fuer die Web-Enrichment-Ingestion (L-1).
 * ALLE Limits (Seiten-Budget, Tiefe, Host-Allowlist, SSRF-Schutz) werden hier
 * deterministisch erzwungen — NIE dem LLM ueberlassen. Das `fetch_url`-Tool ruft
 * ausschliesslich diese Pruefungen auf.
 */

export interface WebStateConfig {
  maxPages: number;
  maxDepth: number;
  allowedHosts: Set<string>;
}

export interface WebState {
  config: WebStateConfig;
  fetched: number;
  visited: Set<string>;
}

export const DEFAULT_MAX_PAGES = 12;
export const DEFAULT_MAX_DEPTH = 2;
export const MAX_CONTENT_BYTES = 2_000_000; // 2 MB Hard-Cap
export const MAX_MARKDOWN_CHARS = 40_000;

export function hostOf(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Entfernt Fragment, normalisiert Host-Schreibweise — fuer das visited-Set. */
export function normalizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    return u.toString();
  } catch {
    return rawUrl;
  }
}

/** SSRF-Schutz: blockt Loopback, private/link-local Netze, Metadaten-IP und .local. */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || h === '0.0.0.0') return true;
  if (h.startsWith('169.254.')) return true; // link-local inkl. Cloud-Metadaten 169.254.169.254
  if (h.startsWith('127.')) return true;
  if (h.startsWith('10.')) return true;
  if (h.startsWith('192.168.')) return true;
  // 172.16.0.0 – 172.31.255.255
  const m = h.match(/^172\.(\d{1,3})\./);
  if (m) {
    const second = Number(m[1]);
    if (second >= 16 && second <= 31) return true;
  }
  // IPv6 Unique-Local (fc00::/7) und Link-Local (fe80::/10)
  if (/^f[cd][0-9a-f]{2}:/i.test(h) || /^fe[89ab][0-9a-f]:/i.test(h)) return true;
  return false;
}

export function createWebState(seedUrls: string[], opts?: Partial<WebStateConfig>): WebState {
  const allowedHosts = new Set<string>(opts?.allowedHosts ?? []);
  for (const url of seedUrls) {
    const host = hostOf(url);
    if (host) allowedHosts.add(host);
  }
  return {
    config: {
      maxPages: opts?.maxPages ?? DEFAULT_MAX_PAGES,
      maxDepth: opts?.maxDepth ?? DEFAULT_MAX_DEPTH,
      allowedHosts,
    },
    fetched: 0,
    visited: new Set<string>(),
  };
}

export interface FetchDecision {
  allowed: boolean;
  reason?: string;
}

/** Die einzige Entscheidungsstelle, ob eine URL geladen werden darf. */
export function checkFetchAllowed(rawUrl: string, depth: number, state: WebState): FetchDecision {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: 'Ungueltige URL.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { allowed: false, reason: `Protokoll ${parsed.protocol} nicht erlaubt.` };
  }
  const host = parsed.hostname.toLowerCase();
  if (isPrivateHost(host)) {
    return { allowed: false, reason: 'Private/lokale Adresse blockiert (SSRF-Schutz).' };
  }
  if (!state.config.allowedHosts.has(host)) {
    return { allowed: false, reason: `Host ${host} ausserhalb der Seed-Domains.` };
  }
  if (depth > state.config.maxDepth) {
    return { allowed: false, reason: `Tiefe ${depth} ueberschreitet Limit ${state.config.maxDepth}.` };
  }
  if (state.visited.has(normalizeUrl(rawUrl))) {
    return { allowed: false, reason: 'URL bereits geladen.' };
  }
  if (state.fetched >= state.config.maxPages) {
    return { allowed: false, reason: `Seiten-Budget (${state.config.maxPages}) erschoepft.` };
  }
  return { allowed: true };
}

export function recordFetch(rawUrl: string, state: WebState): void {
  state.visited.add(normalizeUrl(rawUrl));
  state.fetched += 1;
}

/** Extrahiert Titel + absolute Links aus HTML (fuer die Crawl-Frontier). */
export function extractTitleAndLinks(html: string, baseUrl: string): { title: string; links: string[] } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';
  const links = new Set<string>();
  const re = /<a\b[^>]*\bhref=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const abs = new URL(m[1], baseUrl).toString();
      if (abs.startsWith('http')) links.add(abs);
    } catch {
      /* ungueltiger Link */
    }
  }
  return { title, links: [...links] };
}

export interface FetchedPage {
  url: string;
  title: string;
  markdown: string;
  links: string[];
}

/**
 * Fuehrt einen einzelnen, gebudgetierten HTTP-Fetch aus. Erzwingt Content-Type,
 * Groessen-Cap und re-prueft nach Redirects erneut die Host-Allowlist.
 * Die Aufruf-Erlaubnis MUSS vorher per checkFetchAllowed geprueft werden.
 */
export async function fetchUrlBounded(rawUrl: string, state: WebState, signal?: AbortSignal): Promise<FetchedPage> {
  const res = await fetch(rawUrl, { redirect: 'follow', signal, headers: { 'User-Agent': 'Zettelkasten-Enrich/1.0' } });
  // Nach evtl. Redirect: finalen Host gegen Allowlist + SSRF erneut pruefen.
  const finalHost = hostOf(res.url) ?? '';
  if (isPrivateHost(finalHost) || !state.config.allowedHosts.has(finalHost)) {
    throw new Error(`Redirect zu nicht erlaubtem Host: ${finalHost}`);
  }
  const ctype = res.headers.get('content-type') || '';
  if (!/text\/html|application\/xhtml|text\/plain/i.test(ctype)) {
    throw new Error(`Nicht unterstuetzter Content-Type: ${ctype || 'unbekannt'}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_CONTENT_BYTES) {
    throw new Error(`Inhalt zu gross (${buf.byteLength} Bytes > ${MAX_CONTENT_BYTES}).`);
  }
  const html = buf.toString('utf-8');
  const { title, links } = extractTitleAndLinks(html, res.url);
  let markdown = NodeHtmlMarkdown.translate(html);
  if (markdown.length > MAX_MARKDOWN_CHARS) markdown = markdown.slice(0, MAX_MARKDOWN_CHARS) + '\n\n…(gekuerzt)';
  return { url: res.url, title, markdown, links };
}
