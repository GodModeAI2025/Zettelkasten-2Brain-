import Anthropic from '@anthropic-ai/sdk';
import { SettingsService } from '../services/settings.service';

let client: Anthropic | null = null;

export function getClient(): Anthropic {
  if (!client) {
    const apiKey = SettingsService.getApiKey();
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY nicht konfiguriert. Bitte in den Einstellungen setzen.');
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

export function resetClient(): void {
  client = null;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export interface AskResult {
  text: string;
  usage: TokenUsage;
  truncated: boolean;
  model: string;
  costUsd?: number;
}

export interface RetryInfo {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  status?: number;
  reason: string;
}

export type RetryCallback = (info: RetryInfo) => void;

// Prefix-Match erlaubt Versions-Suffixe (z.B. claude-opus-4-7-20260101).
const MODEL_MAX_OUTPUT_TOKENS: Array<[string, number]> = [
  ['claude-opus-4-7', 32000],
  ['claude-opus-4-6', 32000],
  ['claude-sonnet-4-6', 64000],
  ['claude-sonnet-4-5', 64000],
  ['claude-haiku-4-5', 64000],
  ['claude-opus-4', 32000],
  ['claude-sonnet-4', 64000],
  ['claude-haiku-4', 64000],
];

function maxOutputTokensFor(model?: string): number {
  if (!model) return 8192;
  for (const [prefix, val] of MODEL_MAX_OUTPUT_TOKENS) {
    if (model.startsWith(prefix)) return val;
  }
  return 8192;
}

function clampMaxTokens(requested: number | undefined, model: string | undefined): number {
  const cap = maxOutputTokensFor(model);
  if (!requested) return Math.min(8192, cap);
  return Math.min(requested, cap);
}

const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ENOTFOUND',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);
const DEFAULT_MAX_ATTEMPTS = 4;
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30_000;

const MODEL_TOKEN_PRICES_PER_MILLION: Array<[string, { input: number; output: number; cacheWrite?: number; cacheRead?: number }]> = [
  ['claude-opus-4', { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 }],
  ['claude-sonnet-4', { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 }],
  ['claude-haiku-3-5', { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 }],
  ['claude-3-5-haiku', { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 }],
  ['claude-haiku-3', { input: 0.25, output: 1.25, cacheWrite: 0.3, cacheRead: 0.03 }],
];

function pricingFor(model: string): { input: number; output: number; cacheWrite?: number; cacheRead?: number } | null {
  for (const [prefix, prices] of MODEL_TOKEN_PRICES_PER_MILLION) {
    if (model.startsWith(prefix)) return prices;
  }
  return null;
}

export function estimateClaudeCostUsd(model: string, usage: TokenUsage): number | undefined {
  const prices = pricingFor(model);
  if (!prices) return undefined;
  const inputCost = usage.inputTokens * prices.input / 1_000_000;
  const outputCost = usage.outputTokens * prices.output / 1_000_000;
  const cacheWriteCost = (usage.cacheCreationInputTokens || 0) * (prices.cacheWrite ?? prices.input) / 1_000_000;
  const cacheReadCost = (usage.cacheReadInputTokens || 0) * (prices.cacheRead ?? prices.input) / 1_000_000;
  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
}

function normalizeUsage(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}): TokenUsage {
  const extra = usage as {
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  };
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationInputTokens: extra.cache_creation_input_tokens ?? undefined,
    cacheReadInputTokens: extra.cache_read_input_tokens ?? undefined,
  };
}

function abortError(): Error {
  const err = new Error('Vorgang wurde abgebrochen.');
  err.name = 'AbortError';
  return err;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function statusFromError(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const record = err as Record<string, unknown>;
  const status = record.status ?? record.statusCode;
  return typeof status === 'number' ? status : undefined;
}

function headerFromError(err: unknown, name: string): string | null {
  if (!err || typeof err !== 'object') return null;
  const record = err as Record<string, unknown>;
  const headers = record.headers ?? (record.response as Record<string, unknown> | undefined)?.headers;
  if (!headers) return null;
  if (typeof (headers as { get?: unknown }).get === 'function') {
    const val = (headers as { get: (key: string) => string | null }).get(name);
    return val;
  }
  const obj = headers as Record<string, unknown>;
  const direct = obj[name] ?? obj[name.toLowerCase()];
  return typeof direct === 'string' ? direct : null;
}

function retryAfterMs(err: unknown): number | null {
  const header = headerFromError(err, 'retry-after');
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

function errorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const code = (err as Record<string, unknown>).code;
  return typeof code === 'string' ? code : undefined;
}

function retryReason(err: unknown): string {
  const status = statusFromError(err);
  if (status) return `HTTP ${status}`;
  const code = errorCode(err);
  if (code) return code;
  return err instanceof Error ? err.message : String(err);
}

function isRetryableError(err: unknown): boolean {
  if (isAbortError(err)) return false;
  const status = statusFromError(err);
  if (status !== undefined) return RETRYABLE_STATUSES.has(status);
  const code = errorCode(err);
  if (code && RETRYABLE_ERROR_CODES.has(code)) return true;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes('timeout') || msg.includes('temporarily unavailable') || msg.includes('network');
  }
  return false;
}

function retryDelayMs(err: unknown, attempt: number): number {
  const retryAfter = retryAfterMs(err);
  if (retryAfter !== null) return Math.min(retryAfter, MAX_RETRY_DELAY_MS);
  const exponential = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * 2 ** (attempt - 1));
  const jitter = 0.75 + Math.random() * 0.5;
  return Math.round(exponential * jitter);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(done, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(abortError());
    };
    function done() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface ImageBlock {
  data: string;          // Base64-encoded
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
}

export async function ask(opts: {
  system: string;
  prompt: string;
  images?: ImageBlock[];
  model?: string;
  maxTokens?: number;
  signal?: AbortSignal;
  maxAttempts?: number;
  onRetry?: RetryCallback;
}): Promise<AskResult> {
  const anthropic = getClient();

  const userContent: Anthropic.MessageCreateParams['messages'][0]['content'] =
    opts.images && opts.images.length > 0
      ? [
          ...opts.images.map((img) => ({
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: img.mediaType,
              data: img.data,
            },
          })),
          { type: 'text' as const, text: opts.prompt },
        ]
      : opts.prompt;

  const model = opts.model || SettingsService.getModel();
  const request = {
    model,
    max_tokens: clampMaxTokens(opts.maxTokens, model),
    system: [
      {
        type: 'text' as const,
        text: opts.system,
        cache_control: { type: 'ephemeral' as const },
      },
    ],
    messages: [{ role: 'user' as const, content: userContent }],
  };

  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  let attempt = 1;
  for (;;) {
    throwIfAborted(opts.signal);
    try {
      const stream = anthropic.messages.stream(request, opts.signal ? { signal: opts.signal } : undefined);
      const response = await stream.finalMessage();
      const textBlock = response.content.find((b) => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('Keine Textantwort von Claude erhalten');
      }
      const usage = normalizeUsage(response.usage);
      return {
        text: textBlock.text,
        usage,
        truncated: response.stop_reason === 'max_tokens',
        model,
        costUsd: estimateClaudeCostUsd(model, usage),
      };
    } catch (err) {
      throwIfAborted(opts.signal);
      if (attempt >= maxAttempts || !isRetryableError(err)) throw err;
      const delayMs = retryDelayMs(err, attempt);
      opts.onRetry?.({
        attempt: attempt + 1,
        maxAttempts,
        delayMs,
        status: statusFromError(err),
        reason: retryReason(err),
      });
      await delay(delayMs, opts.signal);
      attempt++;
    }
  }
}

export interface AskJsonResult<T> {
  result: T | null;
  response: AskResult;
  attempts: number;
  lastDiag?: string;
}

/** Retry bei Parse-Fehler mit Fehlerhinweis im Prompt — gegen seltene JSON-Flakiness. */
export async function askForJson<T>(opts: {
  system: string;
  prompt: string;
  images?: ImageBlock[];
  model?: string;
  maxTokens?: number;
  maxRetries?: number;
  signal?: AbortSignal;
  maxAttempts?: number;
  onRetry?: RetryCallback;
}): Promise<AskJsonResult<T>> {
  const maxRetries = opts.maxRetries ?? 1;

  let response = await ask(opts);
  let result = parseClaudeJson<T>(response.text);
  if (result) return { result, response, attempts: 1 };

  let lastDiag = diagnoseJsonParse(response.text);
  for (let i = 0; i < maxRetries; i++) {
    const retryPrompt = `${opts.prompt}

---

WICHTIG: Deine vorherige Antwort war kein gueltiges JSON. Fehler-Diagnose:
${lastDiag}

Antworte EXAKT im gewuenschten JSON-Format — keinen Text davor oder dahinter, nur der reine JSON-Block in \`\`\`json ... \`\`\`.`;

    response = await ask({ ...opts, prompt: retryPrompt });
    result = parseClaudeJson<T>(response.text);
    if (result) return { result, response, attempts: i + 2 };
    lastDiag = diagnoseJsonParse(response.text);
  }

  return { result: null, response, attempts: maxRetries + 1, lastDiag };
}

export async function* askStreaming(opts: {
  system: string;
  prompt: string;
  model?: string;
  maxTokens?: number;
  signal?: AbortSignal;
  maxAttempts?: number;
  onRetry?: RetryCallback;
}): AsyncGenerator<string> {
  const anthropic = getClient();

  const model = opts.model || SettingsService.getModel();
  const request = {
    model,
    max_tokens: clampMaxTokens(opts.maxTokens, model),
    system: [
      {
        type: 'text' as const,
        text: opts.system,
        cache_control: { type: 'ephemeral' as const },
      },
    ],
    messages: [{ role: 'user' as const, content: opts.prompt }],
  };

  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  let attempt = 1;
  let yielded = false;
  for (;;) {
    throwIfAborted(opts.signal);
    try {
      const stream = anthropic.messages.stream(request, opts.signal ? { signal: opts.signal } : undefined);
      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          'delta' in event &&
          event.delta.type === 'text_delta'
        ) {
          yielded = true;
          yield event.delta.text;
        }
      }
      return;
    } catch (err) {
      throwIfAborted(opts.signal);
      if (yielded || attempt >= maxAttempts || !isRetryableError(err)) throw err;
      const delayMs = retryDelayMs(err, attempt);
      opts.onRetry?.({
        attempt: attempt + 1,
        maxAttempts,
        delayMs,
        status: statusFromError(err),
        reason: retryReason(err),
      });
      await delay(delayMs, opts.signal);
      attempt++;
    }
  }
}

/**
 * Versucht abgeschnittenes JSON zu reparieren, indem offene Klammern geschlossen werden.
 * Typischer Fall: Claude-Antwort bei max_tokens abgeschnitten.
 */
function repairTruncatedJson(json: string): string {
  let inString = false;
  let escaped = false;
  const openBrackets: string[] = [];

  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') openBrackets.push(ch);
    if (ch === '}' || ch === ']') openBrackets.pop();
  }

  let repaired = json;
  // Mitten in einem String → schliessen
  if (inString) repaired += '"';
  // Trailing Commas, Doppelpunkte und unvollstaendige Key-Value-Paare entfernen
  // (entstehen wenn JSON nach einem Komma oder mitten in einem Paar abgeschnitten wird)
  repaired = repaired.replace(/,\s*$/, '');
  // Offene Klammern von innen nach aussen schliessen
  while (openBrackets.length > 0) {
    const bracket = openBrackets.pop();
    if (!bracket) break;
    const closer = bracket === '{' ? '}' : ']';
    // Vor dem Schliessen: Trailing Commas innerhalb entfernen
    repaired = repaired.replace(/,\s*$/, '');
    repaired += closer;
  }

  return repaired;
}

/**
 * Extrahiert den JSON-String aus der Claude-Antwort.
 * Robust gegenueber: eingebettete Codeblöcke im Content, abgeschnittene Antworten.
 */
function extractJsonBody(response: string): string {
  const firstBrace = response.indexOf('{');
  if (firstBrace === -1) return response;
  return response.slice(firstBrace);
}

function parseJsonError(err: unknown): { msg: string; position: number | null } {
  const msg = err instanceof Error ? err.message : String(err);
  const match = msg.match(/position\s+(\d+)/i);
  return { msg, position: match ? parseInt(match[1], 10) : null };
}

/**
 * Iterativer JSON-Fixer: nutzt JSON.parse-Fehlerpositionen um Probleme
 * einzeln zu reparieren. Behebt:
 * 1. Steuerzeichen in Strings (Newlines, Tabs)
 * 2. Unescapte Anfuehrungszeichen in Strings — Claude nutzt oft ASCII "
 *    als schliessende deutsche Anfuehrungszeichen innerhalb von Werten.
 *    Wird NUR bei "Expected ',' or '}' after property value" aktiviert,
 *    nicht bei "Unexpected ... after JSON" (= trailing text, kein Quote-Problem).
 */
function fixJsonIssues(json: string, maxAttempts = 60): string {
  let attempt = json;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      JSON.parse(attempt);
      return attempt;
    } catch (err) {
      const { msg, position: pos } = parseJsonError(err);
      if (pos === null) return attempt;
      if (pos >= attempt.length) return attempt;

      const code = attempt.charCodeAt(pos);

      // Fall 1: Steuerzeichen in String → escapen
      if (code < 0x20) {
        let replacement: string;
        if (code === 0x0a) replacement = '\\n';
        else if (code === 0x0d) replacement = '\\r';
        else if (code === 0x09) replacement = '\\t';
        else replacement = `\\u${code.toString(16).padStart(4, '0')}`;
        attempt = attempt.slice(0, pos) + replacement + attempt.slice(pos + 1);
        continue;
      }

      // Fall 2: Unescaptes " im Textinhalt hat den JSON-String vorzeitig geschlossen.
      // Tritt auf als:
      //   - "Expected ',' or '}' after property value" (haeufigster Fall)
      //   - "Expected ',' or ']' after array element"
      //   - "Expected double-quoted property name" (Folgefehler nach erstem Fix)
      // NICHT bei "after JSON" (= Trailing-Text, kein Quote-Problem).
      if (msg.includes('after property value') || msg.includes('after array element') || msg.includes('property name')) {
        let quotePos = pos - 1;
        while (quotePos >= 0 && attempt[quotePos] !== '"') quotePos--;
        if (quotePos > 0) {
          attempt = attempt.slice(0, quotePos) + '\\"' + attempt.slice(quotePos + 1);
          continue;
        }
      }

      return attempt; // Fehler den wir nicht fixen koennen
    }
  }
  return attempt;
}

/**
 * Extrahiert Position und Kontext aus einem JSON.parse-Fehler.
 */
function describeJsonError(err: unknown, json: string): string {
  const { msg, position: pos } = parseJsonError(err);
  if (pos === null) return msg;

  const start = Math.max(0, pos - 60);
  const end = Math.min(json.length, pos + 60);
  const before = json.slice(start, pos).replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
  const after = json.slice(pos, end).replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
  const charAtPos = pos < json.length ? json[pos] : 'EOF';
  const hexCode = pos < json.length ? `0x${json.charCodeAt(pos).toString(16).padStart(2, '0')}` : 'EOF';

  return `${msg} | Zeichen: '${charAtPos}' (${hexCode}) | Kontext: …${before}>>>[HIER]<<<${after}…`;
}

export function parseClaudeJson<T>(response: string): T | null {
  const raw = extractJsonBody(response);
  const errors: string[] = [];

  // S1: Direkt parsen (sauberes, vollstaendiges JSON)
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    errors.push(`[S1 direkt] ${describeJsonError(err, raw)}`);

    // S1b: Mehrere JSON-Objekte hintereinander (z.B. Claude-Selbstkorrektur
    // "Entschuldigung, ich starte neu"). JSON.parse meldet die Position, an der
    // das erste Objekt vollstaendig endet — alles davor ist gueltiges JSON.
    const { msg, position: cutoff } = parseJsonError(err);
    if (cutoff !== null && /after JSON/i.test(msg)) {
      const head = raw.slice(0, cutoff);
      try {
        return JSON.parse(head) as T;
      } catch (err2) {
        errors.push(`[S1b first-of-many] ${describeJsonError(err2, head)}`);
      }
    }
  }

  // S2: Bis letztes } trimmen (Codeblock-Marker ```  oder Text nach dem JSON)
  const lastBrace = raw.lastIndexOf('}');
  if (lastBrace > 0) {
    const trimmed = raw.slice(0, lastBrace + 1);
    try {
      return JSON.parse(trimmed) as T;
    } catch (err) {
      errors.push(`[S2 trimmed] ${describeJsonError(err, trimmed)}`);
    }

    // S3: Steuerzeichen + unescapte Quotes fixen (auf getrimmter Version)
    const fixed = fixJsonIssues(trimmed);
    if (fixed !== trimmed) {
      try {
        return JSON.parse(fixed) as T;
      } catch (err) {
        errors.push(`[S3 fixed] ${describeJsonError(err, fixed)}`);
      }
    }
  } else {
    errors.push(`[S2] Kein schliessendes } gefunden`);
  }

  // S4: Abgeschnittenes JSON reparieren (mit Fix auf dem Original)
  const fixedRaw = fixJsonIssues(raw);
  const repaired = repairTruncatedJson(fixedRaw);
  try {
    return JSON.parse(repaired) as T;
  } catch (err) {
    errors.push(`[S4 repariert] ${describeJsonError(err, repaired)}`);
  }

  // Alle Strategien gescheitert — ausfuehrliche Diagnostik
  const diag = [
    `Antwort: ${response.length} Zeichen, JSON-Body: ${raw.length} Zeichen`,
    `Erste 80 Zeichen: ${raw.slice(0, 80).replace(/\n/g, '\\n')}`,
    `Letzte 80 Zeichen: ${raw.slice(-80).replace(/\n/g, '\\n')}`,
    ...errors,
  ].join('\n');
  console.error(`[parseClaudeJson] Alle Strategien fehlgeschlagen:\n${diag}`);
  return null;
}

export function diagnoseJsonParse(response: string): string {
  const raw = extractJsonBody(response);
  const lines: string[] = [];
  lines.push(`Antwort: ${response.length} Zeichen, JSON-Body: ${raw.length} Zeichen`);

  try {
    JSON.parse(raw);
    lines.push('Parse: OK (unerwartet)');
  } catch (err) {
    lines.push(`Original: ${describeJsonError(err, raw)}`);
  }

  const fixed = fixJsonIssues(raw);
  if (fixed !== raw) {
    try {
      JSON.parse(fixed);
      lines.push('Nach ctrl-fix: OK (unerwartet)');
    } catch (err) {
      lines.push(`Nach ctrl-fix: ${describeJsonError(err, fixed)}`);
    }
  }

  lines.push(`Anfang: ${raw.slice(0, 120).replace(/\n/g, '\\n')}`);
  lines.push(`Ende: ${raw.slice(-120).replace(/\n/g, '\\n')}`);
  return lines.join(' | ');
}
