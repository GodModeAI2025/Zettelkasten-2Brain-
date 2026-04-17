import type { WikiPage } from './vault';
import { tokenize } from './keywords';
import type { SearchIndex } from './search-index';
import { computeCorpusStats } from './search-index';

export interface BM25Options {
  k1?: number;
  b?: number;
  titleBoost?: number;
  phraseBoost?: number;
  limit?: number;
}

export interface ScoredPage {
  page: WikiPage;
  score: number;
}

const DEFAULT_K1 = 1.5;
const DEFAULT_B = 0.75;
const DEFAULT_TITLE_BOOST = 3.0;
const DEFAULT_PHRASE_BOOST = 2.0;
const DEFAULT_LIMIT = 12;
const SMALL_CORPUS_THRESHOLD = 5;
const MIN_TOKEN_LENGTH = 3;

interface DocStats {
  page: WikiPage;
  tf: Map<string, number>;
  titleTokens: Set<string>;
  length: number;
}

function extractTitle(page: WikiPage): string {
  const fmTitle = page.frontmatter.title;
  if (typeof fmTitle === 'string' && fmTitle.trim()) return fmTitle;
  const base = page.relativePath.split('/').pop() || '';
  return base.replace(/\.md$/i, '').replace(/[-_]+/g, ' ');
}

function normalizeQueryTokens(queryTokens: string[]): string[] {
  const normalized: string[] = [];
  for (const raw of queryTokens) {
    for (const tok of tokenize(raw)) {
      if (tok.length >= MIN_TOKEN_LENGTH) normalized.push(tok);
    }
  }
  return [...new Set(normalized)];
}

function extractPhrases(queryTokens: string[]): string[] {
  const phrases: string[] = [];
  for (const raw of queryTokens) {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed.includes(' ') && trimmed.length >= 5) {
      phrases.push(trimmed);
    }
  }
  return phrases;
}

function buildDocStats(pages: WikiPage[]): { docs: DocStats[]; df: Map<string, number>; avgLen: number } {
  const docs: DocStats[] = [];
  const df = new Map<string, number>();
  let totalLen = 0;

  for (const page of pages) {
    const contentTokens = tokenize(page.content);
    const titleTokens = new Set(tokenize(extractTitle(page)));

    const tf = new Map<string, number>();
    for (const tok of contentTokens) {
      tf.set(tok, (tf.get(tok) || 0) + 1);
    }

    for (const tok of new Set([...contentTokens, ...titleTokens])) {
      df.set(tok, (df.get(tok) || 0) + 1);
    }

    docs.push({
      page,
      tf,
      titleTokens,
      length: contentTokens.length,
    });
    totalLen += contentTokens.length;
  }

  const avgLen = docs.length > 0 ? Math.max(1, totalLen / docs.length) : 1;
  return { docs, df, avgLen };
}

function fallbackRanking(pages: WikiPage[], queryTokens: string[], limit: number): WikiPage[] {
  const scored = pages.map((page) => {
    let score = 0;
    for (const tok of queryTokens) {
      if (page.contentLower.includes(tok)) score += 1;
    }
    return { page, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.page.relativePath.localeCompare(b.page.relativePath);
    })
    .slice(0, limit)
    .map((s) => s.page);
}

export function bm25Rank(
  pages: WikiPage[],
  queryTokens: string[],
  options: BM25Options = {},
): WikiPage[] {
  const k1 = options.k1 ?? DEFAULT_K1;
  const b = options.b ?? DEFAULT_B;
  const titleBoost = options.titleBoost ?? DEFAULT_TITLE_BOOST;
  const phraseBoost = options.phraseBoost ?? DEFAULT_PHRASE_BOOST;
  const limit = options.limit && options.limit > 0 ? Math.floor(options.limit) : DEFAULT_LIMIT;

  const normalized = normalizeQueryTokens(queryTokens);
  if (normalized.length === 0 || pages.length === 0) return [];

  if (pages.length < SMALL_CORPUS_THRESHOLD) {
    return fallbackRanking(pages, normalized, limit);
  }

  const { docs, df, avgLen } = buildDocStats(pages);
  const N = docs.length;
  const phrases = extractPhrases(queryTokens);

  const scored: ScoredPage[] = docs.map((doc) => {
    let score = 0;
    for (const term of normalized) {
      const termDf = df.get(term);
      if (!termDf) continue;

      const contentTf = doc.tf.get(term) || 0;
      const titleHit = doc.titleTokens.has(term);
      if (contentTf === 0 && !titleHit) continue;

      const idf = Math.log((N - termDf + 0.5) / (termDf + 0.5) + 1);

      if (contentTf > 0) {
        const norm = 1 - b + b * (doc.length / avgLen);
        const denom = contentTf + k1 * norm;
        score += idf * (contentTf * (k1 + 1)) / denom;
      }

      if (titleHit) {
        score += idf * titleBoost;
      }
    }

    if (phrases.length > 0) {
      for (const phrase of phrases) {
        if (doc.page.contentLower.includes(phrase)) {
          score += phraseBoost;
        }
      }
    }

    return { page: doc.page, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.page.relativePath.localeCompare(b.page.relativePath);
    })
    .slice(0, limit)
    .map((s) => s.page);
}

/**
 * BM25-Ranking mit vorberechnetem Index. Ueberspringt das Tokenisieren
 * und die Doc-Stats-Berechnung, wenn der Index bereits die Seiten abdeckt.
 * Faellt fuer Seiten ohne Index-Eintrag nicht zurueck — Aufrufer muss
 * sicherstellen, dass der Index aktuell ist (Vault.getSearchIndex).
 */
export function bm25RankWithIndex(
  pages: WikiPage[],
  queryTokens: string[],
  index: SearchIndex,
  options: BM25Options = {},
): WikiPage[] {
  const k1 = options.k1 ?? DEFAULT_K1;
  const b = options.b ?? DEFAULT_B;
  const titleBoost = options.titleBoost ?? DEFAULT_TITLE_BOOST;
  const phraseBoost = options.phraseBoost ?? DEFAULT_PHRASE_BOOST;
  const limit = options.limit && options.limit > 0 ? Math.floor(options.limit) : DEFAULT_LIMIT;

  const normalized = normalizeQueryTokens(queryTokens);
  if (normalized.length === 0 || pages.length === 0) return [];

  if (pages.length < SMALL_CORPUS_THRESHOLD) {
    return fallbackRanking(pages, normalized, limit);
  }

  const { df, avgLen, N } = computeCorpusStats(index);
  const phrases = extractPhrases(queryTokens);

  const scored: ScoredPage[] = [];
  for (const page of pages) {
    const entry = index.entries[page.relativePath];
    if (!entry) continue;

    const titleSet = new Set(entry.titleTokens);
    let score = 0;
    for (const term of normalized) {
      const termDf = df.get(term);
      if (!termDf) continue;

      const contentTf = entry.tf[term] || 0;
      const titleHit = titleSet.has(term);
      if (contentTf === 0 && !titleHit) continue;

      const idf = Math.log((N - termDf + 0.5) / (termDf + 0.5) + 1);

      if (contentTf > 0) {
        const norm = 1 - b + b * (entry.length / avgLen);
        const denom = contentTf + k1 * norm;
        score += idf * (contentTf * (k1 + 1)) / denom;
      }

      if (titleHit) {
        score += idf * titleBoost;
      }
    }

    if (phrases.length > 0) {
      for (const phrase of phrases) {
        if (page.contentLower.includes(phrase)) {
          score += phraseBoost;
        }
      }
    }

    scored.push({ page, score });
  }

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.page.relativePath.localeCompare(b.page.relativePath);
    })
    .slice(0, limit)
    .map((s) => s.page);
}
