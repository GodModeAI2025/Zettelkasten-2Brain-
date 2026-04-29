import type { WikiFrontmatterPatch } from '../../shared/api.types';
import { today } from './vault';

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function optionalString(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function cleanList(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return values.map((value) => String(value).trim()).filter(Boolean);
}

function setValue(
  frontmatter: Record<string, unknown>,
  changed: Set<string>,
  key: string,
  nextValue: unknown,
): void {
  const hadKey = Object.prototype.hasOwnProperty.call(frontmatter, key);
  const previous = frontmatter[key];

  if (nextValue === undefined) {
    delete frontmatter[key];
  } else {
    frontmatter[key] = nextValue;
  }

  const hasKey = Object.prototype.hasOwnProperty.call(frontmatter, key);
  if (hadKey !== hasKey || !sameValue(previous, frontmatter[key])) {
    changed.add(key);
  }
}

function setOptionalStringField(
  frontmatter: Record<string, unknown>,
  changed: Set<string>,
  key: string,
  value: string | null | undefined,
): void {
  setValue(frontmatter, changed, key, optionalString(value));
}

function setOptionalListField(
  frontmatter: Record<string, unknown>,
  changed: Set<string>,
  key: string,
  values: string[] | undefined,
): void {
  const cleaned = cleanList(values);
  setValue(frontmatter, changed, key, cleaned.length > 0 ? cleaned : undefined);
}

export function applyWikiFrontmatterPatch(
  frontmatter: Record<string, unknown>,
  patch: WikiFrontmatterPatch,
  updatedDate = today(),
): string[] {
  const changed = new Set<string>();

  if ('status' in patch) {
    setOptionalStringField(frontmatter, changed, 'status', patch.status);
  }
  if ('confidence' in patch) {
    setOptionalStringField(frontmatter, changed, 'confidence', patch.confidence);
  }
  if ('type' in patch) {
    setOptionalStringField(frontmatter, changed, 'type', patch.type);
  }
  if ('superseded_by' in patch) {
    setOptionalStringField(frontmatter, changed, 'superseded_by', patch.superseded_by);
  }
  if ('tags' in patch) {
    setOptionalListField(frontmatter, changed, 'tags', patch.tags);
  }
  if ('sources' in patch) {
    setOptionalListField(frontmatter, changed, 'sources', patch.sources);
  }
  if ('reviewed' in patch) {
    if (typeof patch.reviewed !== 'boolean') {
      throw new Error('reviewed muss true oder false sein.');
    }
    setValue(frontmatter, changed, 'reviewed', patch.reviewed);
  }

  const changedFields = [...changed];
  if (changedFields.length > 0) {
    frontmatter.updated = updatedDate;
  }

  return changedFields;
}
