import { parseFrontmatterBlock } from './vault';

/**
 * Schrumpf-Schutz fuer KI-`update`-Operationen: erkennt, ob ein Update
 * substanziell Inhalt ENTFERNT (geloeschte Quellen, weggefallene Abschnitte,
 * stark gekuerzter Body) statt zu ergaenzen. Deterministischer Backstop gegen
 * stillen Datenverlust — der Ingest-Prompt verlangt additives Arbeiten, aber
 * Prompt-Regeln sind nicht garantiert.
 */

export interface ShrinkReport {
  shrunk: boolean;
  removedSources: string[];
  removedHeadings: string[];
  bodyRatio: number;
  reasons: string[];
}

// Body gilt als geschrumpft, wenn er unter diesen Anteil der alten Laenge faellt.
const BODY_SHRINK_RATIO = 0.6;

function extractH2Headings(body: string): string[] {
  const out: string[] = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) out.push(m[1].trim().toLowerCase());
  }
  return out;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v).trim()).filter(Boolean);
}

export function diffShrink(oldContent: string, newContent: string): ShrinkReport {
  const oldP = parseFrontmatterBlock(oldContent);
  const newP = parseFrontmatterBlock(newContent);

  const newSources = new Set(asStringList(newP.data.sources));
  const removedSources = asStringList(oldP.data.sources).filter((s) => !newSources.has(s));

  const newHeads = new Set(extractH2Headings(newP.body));
  const removedHeadings = extractH2Headings(oldP.body).filter((h) => !newHeads.has(h));

  const oldLen = oldP.body.trim().length;
  const newLen = newP.body.trim().length;
  const bodyRatio = oldLen === 0 ? 1 : newLen / oldLen;

  const reasons: string[] = [];
  if (removedSources.length > 0) reasons.push(`${removedSources.length} Quelle(n) entfernt`);
  if (removedHeadings.length > 0) reasons.push(`${removedHeadings.length} Abschnitt(e) entfernt`);
  if (bodyRatio < BODY_SHRINK_RATIO) reasons.push(`Text auf ${Math.round(bodyRatio * 100)}% gekuerzt`);

  return { shrunk: reasons.length > 0, removedSources, removedHeadings, bodyRatio, reasons };
}

/**
 * Escape-Hatch: ein legitimes Supersede/Stale (Seite wird bewusst als veraltet
 * markiert oder durch eine neuere ersetzt) ist KEINE unerwuenschte Schrumpfung.
 */
export function isLegitimateShrink(newContent: string): boolean {
  const { data } = parseFrontmatterBlock(newContent);
  const status = typeof data.status === 'string' ? data.status.trim().toLowerCase() : '';
  const superseded = typeof data.superseded_by === 'string' ? data.superseded_by.trim() : '';
  return status === 'stale' || superseded.length > 0;
}
