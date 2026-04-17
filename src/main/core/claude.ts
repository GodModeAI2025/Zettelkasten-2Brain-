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

export interface AskResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  truncated: boolean;
}

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
  const stream = anthropic.messages.stream({
    model,
    max_tokens: clampMaxTokens(opts.maxTokens, model),
    system: [
      {
        type: 'text',
        text: opts.system,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userContent }],
  });

  const response = await stream.finalMessage();

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Keine Textantwort von Claude erhalten');
  }
  return {
    text: textBlock.text,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    truncated: response.stop_reason === 'max_tokens',
  };
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
}): AsyncGenerator<string> {
  const anthropic = getClient();

  const model = opts.model || SettingsService.getModel();
  const stream = anthropic.messages.stream({
    model,
    max_tokens: clampMaxTokens(opts.maxTokens, model),
    system: [
      {
        type: 'text',
        text: opts.system,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: opts.prompt }],
  });

  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      'delta' in event &&
      event.delta.type === 'text_delta'
    ) {
      yield event.delta.text;
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
    const bracket = openBrackets.pop()!;
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
