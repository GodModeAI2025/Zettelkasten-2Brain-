import type { WikiCreatePageInput } from '../../shared/api.types';
import { slugify, today } from './vault';

const CATEGORY_TYPES: Record<string, string> = {
  sources: 'source',
  entities: 'entity',
  concepts: 'concept',
  syntheses: 'synthesis',
  sops: 'sop',
  decisions: 'decision',
};

const DEFAULT_CATEGORY = 'concepts';

export interface WikiPageDraft {
  relativePath: string;
  stubPath: string;
  title: string;
  content: string;
}

function cleanTitle(input: string): string {
  const withoutBrackets = input.trim().replace(/^\[\[/, '').replace(/\]\]$/, '');
  const target = withoutBrackets.split('|')[0].trim();
  const base = target.replace(/\\/g, '/').replace(/\.md$/i, '').split('/').pop() || target;
  return base.replace(/-/g, ' ').trim();
}

function normalizeCategory(category?: string): string {
  if (category && Object.prototype.hasOwnProperty.call(CATEGORY_TYPES, category)) {
    return category;
  }
  return DEFAULT_CATEGORY;
}

function normalizePath(input: WikiCreatePageInput, title: string): string {
  const defaultCategory = normalizeCategory(input.category);
  const raw = (input.path || `${defaultCategory}/${slugify(title)}`)
    .trim()
    .replace(/\\/g, '/')
    .replace(/^wiki\//, '')
    .replace(/\.md$/i, '');

  if (!raw || raw.startsWith('/') || raw.split('/').some((part) => part === '..')) {
    throw new Error('Ungueltiger Wiki-Pfad.');
  }

  const parts = raw.split('/').filter(Boolean);
  let category = parts[0];
  let slugSource = parts.slice(1).join('-');

  if (!Object.prototype.hasOwnProperty.call(CATEGORY_TYPES, category)) {
    category = defaultCategory;
    slugSource = parts.join('-');
  }

  const slug = slugify(slugSource || title);
  if (!slug) {
    throw new Error('Wiki-Seite braucht einen gueltigen Titel.');
  }

  return `${category}/${slug}`;
}

function sourceLink(sourcePath?: string): string {
  if (!sourcePath) return '';
  const target = sourcePath.replace(/\\/g, '/').replace(/^wiki\//, '').replace(/\.md$/i, '');
  if (!target || target.startsWith('/') || target.split('/').some((part) => part === '..')) return '';
  return `\n## Kontext\n\nDiese Seite wurde aus einem offenen Wikilink in [[${target}]] angelegt.\n`;
}

export function createWikiPageDraft(input: WikiCreatePageInput, date = today()): WikiPageDraft {
  const title = cleanTitle(input.title);
  if (!title) {
    throw new Error('Wiki-Seite braucht einen Titel.');
  }

  const stubPath = normalizePath(input, title);
  const [category] = stubPath.split('/');
  const type = CATEGORY_TYPES[category] || CATEGORY_TYPES[DEFAULT_CATEGORY];
  const content = `---
title: ${title}
type: ${type}
status: seed
confidence: low
reviewed: false
tags: [stub]
created: ${date}
updated: ${date}
---
# ${title}
${sourceLink(input.sourcePath)}
## Arbeitsnotizen

- Kernthese pruefen.
- Quellen ergaenzen.
- Beziehungen zu bestehenden Seiten herstellen.
`;

  return {
    relativePath: `${stubPath}.md`,
    stubPath,
    title,
    content,
  };
}
