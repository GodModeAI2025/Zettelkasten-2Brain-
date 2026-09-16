import { basename, extname } from 'path';

export interface SourceRefPage {
  id: string;
  frontmatter: Record<string, unknown>;
}

export interface MissingSourceRef {
  file: string;
  source: string;
}

function normalizeRef(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^raw\//, '').toLowerCase();
}

function withoutExtension(value: string): string {
  const ext = extname(value);
  return ext ? value.slice(0, -ext.length) : value;
}

function sourceList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string') return [value];
  return [];
}

// Nur Verweise pruefen, die nach Rohdatei aussehen. URLs (auch ohne Schema, z.B. aus der
// Web-Anreicherung, die keine Rohdatei anlegt) und Wiki-Pfade sind keine raw/-Dateien.
function isRawFileRef(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return false;
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/|$)/i.test(trimmed) && !/\.(md|txt|pdf|docx?|pptx?|xlsx?|csv|json|html?)$/i.test(trimmed)) {
    return false;
  }
  if (/^wiki\//i.test(trimmed)) return false;
  return true;
}

/**
 * Findet `sources:`-Eintraege im Frontmatter, zu denen keine Datei in raw/ existiert
 * (z.B. nach Vergessen oder manuellem Loeschen einer Quelle). Tolerant: Treffer ueber
 * vollen Pfad, Dateiname oder Dateiname ohne Endung (Original .pdf vs. konvertierte .md).
 */
export function findMissingSourceRefs(pages: SourceRefPage[], rawFiles: string[]): MissingSourceRef[] {
  const known = new Set<string>();
  for (const rawFile of rawFiles) {
    const normalized = normalizeRef(rawFile);
    const name = basename(normalized);
    known.add(normalized);
    known.add(name);
    known.add(withoutExtension(name));
  }

  const missing: MissingSourceRef[] = [];
  for (const page of pages) {
    for (const source of sourceList(page.frontmatter.sources)) {
      if (!isRawFileRef(source)) continue;
      const normalized = normalizeRef(source);
      const name = basename(normalized);
      const found = known.has(normalized) || known.has(name) || known.has(withoutExtension(name));
      if (!found) missing.push({ file: page.id, source: source.trim() });
    }
  }
  return missing;
}
