import { posix } from 'path';
import { pageAliases, linkTargetAliases } from './wikilinks';
import {
  parseFrontmatterBlock,
  serializeFrontmatter,
  resolvePageType,
  typeForCategory,
  deriveDescription,
  WIKI_CATEGORIES,
  WIKI_CATEGORY_LABELS,
} from './vault';

/**
 * Projiziert den wikilink-nativen Live-Vault in ein portables OKF-Bundle
 * (Open Knowledge Format, GoogleCloudPlatform/knowledge-catalog): standardkonforme
 * relative Markdown-Links statt `[[wikilinks]]`, kanonisches YAML, OKF-`type`,
 * Progressive-Disclosure-Indizes. Rein funktional (kein I/O) — der IPC-Handler
 * schreibt das Ergebnis. Der Live-Vault bleibt unangetastet.
 */

export interface ExportPage {
  /** Seiten-ID ohne `.md`, z.B. `concepts/foo`. */
  id: string;
  content: string;
}

export interface OkfBundleOptions {
  generator: string;
  generatedAt: string;
  bundleName?: string;
}

export interface OkfManifest {
  okf_version: string;
  generator: string;
  generated_at: string;
  page_count: number;
  unresolved_links: Array<{ page: string; target: string }>;
  alias_collisions: string[];
}

export interface OkfBundle {
  files: Array<{ path: string; content: string }>;
  manifest: OkfManifest;
}

const OKF_VERSION = '0.1';
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

function relativeMdLink(fromId: string, toId: string): string {
  const fromDir = posix.dirname(fromId);
  let rel = posix.relative(fromDir, toId);
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel + '.md';
}

function buildAliasMap(pages: ExportPage[]): { aliasToId: Map<string, string>; collisions: string[] } {
  const aliasToId = new Map<string, string>();
  const collisions = new Set<string>();
  for (const p of pages) {
    const name = posix.basename(p.id);
    for (const a of pageAliases(p.id, name)) {
      const existing = aliasToId.get(a);
      if (existing === undefined) aliasToId.set(a, p.id);
      else if (existing !== p.id) collisions.add(a);
    }
  }
  return { aliasToId, collisions: [...collisions] };
}

function resolveId(target: string, aliasToId: Map<string, string>): string | undefined {
  for (const a of linkTargetAliases(target)) {
    const id = aliasToId.get(a);
    if (id !== undefined) return id;
  }
  return undefined;
}

function convertBodyLinks(
  body: string,
  fromId: string,
  aliasToId: Map<string, string>,
  unresolvedSink: string[],
): string {
  return body.replace(WIKILINK_RE, (_match, rawTarget: string, display?: string) => {
    const target = rawTarget.trim();
    const text = (display || rawTarget).trim();
    const toId = resolveId(target, aliasToId);
    if (toId === undefined) {
      unresolvedSink.push(target);
      return text; // OKF-Disziplin: nur auf bekannte Konzepte verlinken — Rest bleibt Klartext.
    }
    return `[${text}](${relativeMdLink(fromId, toId)})`;
  });
}

function toOkfFrontmatter(
  data: Record<string, unknown>,
  fromId: string,
  aliasToId: Map<string, string>,
): Record<string, unknown> {
  const fm: Record<string, unknown> = { ...data };
  const category = fromId.includes('/') ? fromId.split('/')[0] : '';
  const type = resolvePageType(fm) || typeForCategory(category) || 'concept';

  // type/-Tag entfernen (Typ ist jetzt ein echtes Feld).
  if (Array.isArray(fm.tags)) {
    const filtered = fm.tags.filter((t) => !String(t).toLowerCase().startsWith('type/'));
    if (filtered.length > 0) fm.tags = filtered;
    else delete fm.tags;
  }

  // superseded_by: [[X]] -> relativer Link (sonst mehrdeutiges YAML fuer externe Consumer).
  if (typeof fm.superseded_by === 'string' && fm.superseded_by.startsWith('[[')) {
    const inner = fm.superseded_by.replace(/^\[\[/, '').replace(/\]\]$/, '');
    const toId = resolveId(inner, aliasToId);
    if (toId !== undefined) fm.superseded_by = relativeMdLink(fromId, toId);
    else delete fm.superseded_by;
  }

  const timestamp =
    (typeof fm.updated === 'string' && fm.updated) ||
    (typeof fm.created === 'string' && fm.created) ||
    '';

  // OKF-Reihenfolge nur in der Projektion: type/title/description zuerst, timestamp zuletzt.
  const ordered: Record<string, unknown> = { type };
  if (fm.title != null) ordered.title = fm.title;
  if (fm.description != null) ordered.description = fm.description;
  for (const [k, v] of Object.entries(fm)) {
    if (k === 'type' || k === 'title' || k === 'description' || k === 'timestamp') continue;
    ordered[k] = v;
  }
  if (timestamp) ordered.timestamp = timestamp;
  return ordered;
}

interface PageMeta { id: string; category: string; title: string; description: string }

function titleFor(data: Record<string, unknown>, id: string): string {
  if (typeof data.title === 'string' && data.title.trim()) return data.title.trim();
  return posix.basename(id).replace(/-/g, ' ');
}

function buildDirIndex(label: string, pages: PageMeta[]): string {
  const bullets = pages
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((p) => {
      const name = posix.basename(p.id);
      return p.description ? `* [${p.title}](${name}.md) - ${p.description}` : `* [${p.title}](${name}.md)`;
    })
    .join('\n');
  return `# ${label}\n\n${bullets}\n`;
}

function buildMainIndex(allMeta: PageMeta[], opts: OkfBundleOptions): string {
  const grouped = new Map<string, PageMeta[]>();
  for (const m of allMeta) {
    const list = grouped.get(m.category) || [];
    list.push(m);
    grouped.set(m.category, list);
  }
  const order: string[] = [...WIKI_CATEGORIES, 'other'];
  const sections: string[] = [];
  for (const cat of order) {
    const pages = grouped.get(cat);
    if (!pages || pages.length === 0) continue;
    const label = WIKI_CATEGORY_LABELS[cat as keyof typeof WIKI_CATEGORY_LABELS] ?? cat;
    const bullets = pages
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((p) => (p.description ? `* [${p.title}](${p.id}.md) - ${p.description}` : `* [${p.title}](${p.id}.md)`))
      .join('\n');
    sections.push(`## ${label}\n${bullets}`);
  }
  const heading = opts.bundleName ? `# ${opts.bundleName}` : '# Wissens-Katalog';
  return `---\nokf_version: "${OKF_VERSION}"\n---\n${heading}\n\n${sections.join('\n\n')}\n`;
}

export function buildOkfBundle(pages: ExportPage[], opts: OkfBundleOptions): OkfBundle {
  const { aliasToId, collisions } = buildAliasMap(pages);
  const files: Array<{ path: string; content: string }> = [];
  const unresolvedLinks: Array<{ page: string; target: string }> = [];
  const meta: PageMeta[] = [];

  for (const p of pages) {
    const { data, body } = parseFrontmatterBlock(p.content);
    const sink: string[] = [];
    const newBody = convertBodyLinks(body, p.id, aliasToId, sink);
    for (const t of sink) unresolvedLinks.push({ page: p.id, target: t });

    const fm = toOkfFrontmatter(data, p.id, aliasToId);
    files.push({ path: `${p.id}.md`, content: serializeFrontmatter(fm) + newBody });

    meta.push({
      id: p.id,
      category: p.id.includes('/') ? p.id.split('/')[0] : 'other',
      title: titleFor(data, p.id),
      description: deriveDescription(p.content),
    });
  }

  // Sub-Index pro Kategorie (Progressive Disclosure).
  const byCategory = new Map<string, PageMeta[]>();
  for (const m of meta) {
    const list = byCategory.get(m.category) || [];
    list.push(m);
    byCategory.set(m.category, list);
  }
  for (const [cat, catPages] of byCategory) {
    if (cat === 'other') continue;
    const label = WIKI_CATEGORY_LABELS[cat as keyof typeof WIKI_CATEGORY_LABELS] ?? cat;
    files.push({ path: `${cat}/index.md`, content: buildDirIndex(label, catPages) });
  }

  files.push({ path: 'index.md', content: buildMainIndex(meta, opts) });

  const manifest: OkfManifest = {
    okf_version: OKF_VERSION,
    generator: opts.generator,
    generated_at: opts.generatedAt,
    page_count: pages.length,
    unresolved_links: unresolvedLinks,
    alias_collisions: collisions,
  };
  files.push({ path: 'okf.json', content: JSON.stringify(manifest, null, 2) + '\n' });

  return { files, manifest };
}
