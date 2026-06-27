import { posix } from 'path';
import {
  parseFrontmatterBlock,
  serializeFrontmatter,
  slugify,
  WIKI_CATEGORIES,
  WIKI_CATEGORY_TYPES,
  type WikiCategory,
} from './vault';

/**
 * Importiert bereits strukturierte Markdown-Bundles DIREKT in den Vault — ohne
 * KI-Re-Authoring (Gegenstueck zum OKF-Export). Standardkonforme relative
 * Markdown-Links werden zurueck in native `[[wikilinks]]` konvertiert, der Typ
 * auf eine WIKI_CATEGORY gemappt, unbekannte Frontmatter-Keys verbatim erhalten
 * und `reviewed: false` erzwungen (Seiten laufen durch die Review-Queue).
 */

const DEFAULT_CATEGORY: WikiCategory = 'concepts';

// type -> Verzeichnis (Umkehrung von WIKI_CATEGORY_TYPES).
const TYPE_TO_CATEGORY: Record<string, WikiCategory> = Object.fromEntries(
  (Object.entries(WIKI_CATEGORY_TYPES) as Array<[WikiCategory, string]>).map(([cat, type]) => [type, cat]),
) as Record<string, WikiCategory>;

const MD_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

function isExternalHref(href: string): boolean {
  return /^(https?:|mailto:|tel:|#|\/\/)/i.test(href);
}

/** Konvertiert relative Markdown-Links (`[T](../concepts/x.md)`) zurueck in `[[x|T]]`. */
export function mdLinkToWikilink(body: string): string {
  return body.replace(MD_LINK_RE, (whole, text: string, href: string) => {
    const cleanHref = href.trim();
    if (isExternalHref(cleanHref)) return whole;
    if (!/\.md(#.*)?$/i.test(cleanHref)) return whole; // nur .md-Ziele
    const noAnchor = cleanHref.replace(/#.*$/, '');
    const base = posix.basename(noAnchor).replace(/\.md$/i, '');
    const target = slugify(base);
    if (!target) return whole;
    const label = text.trim();
    const humanized = target.replace(/-/g, ' ');
    return label.toLowerCase() === humanized.toLowerCase() ? `[[${target}]]` : `[[${target}|${label}]]`;
  });
}

function resolveCategory(frontmatter: Record<string, unknown>, relPath: string): WikiCategory {
  // 1. explizites type/category-Feld
  for (const key of ['type', 'category']) {
    const v = frontmatter[key];
    if (typeof v === 'string' && v.trim()) {
      const t = v.trim().toLowerCase();
      if ((WIKI_CATEGORIES as readonly string[]).includes(t)) return t as WikiCategory;
      if (TYPE_TO_CATEGORY[t]) return TYPE_TO_CATEGORY[t];
    }
  }
  // 2. Bundle-Verzeichnis (z.B. concepts/foo.md)
  const top = posix.dirname(relPath.replace(/\\/g, '/')).split('/')[0];
  if ((WIKI_CATEGORIES as readonly string[]).includes(top)) return top as WikiCategory;
  // 3. Default
  return DEFAULT_CATEGORY;
}

export interface ImportedPage {
  wikiRelativePath: string; // z.B. wiki/concepts/foo.md
  content: string;
}

export function transformImportedPage(relPath: string, content: string): ImportedPage {
  const { data, body } = parseFrontmatterBlock(content);
  const category = resolveCategory(data, relPath);

  const baseName = posix.basename(relPath.replace(/\\/g, '/')).replace(/\.md$/i, '');
  const slug = slugify(baseName) || 'unbenannt';

  // Frontmatter: unbekannte Keys verbatim erhalten, type/reviewed normalisieren.
  const fm: Record<string, unknown> = { ...data };
  fm.type = WIKI_CATEGORY_TYPES[category];
  fm.reviewed = false; // jede importierte Seite muss durch die Review-Queue.

  const newBody = mdLinkToWikilink(body);
  return {
    wikiRelativePath: `wiki/${category}/${slug}.md`,
    content: serializeFrontmatter(fm) + newBody,
  };
}
