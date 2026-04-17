import { stat } from 'fs/promises';
import { join } from 'path';
import { ProjectService } from './project.service';
import { BRAND_DEFAULTS } from '../core/brand-defaults';

export type BrandDocName = 'voice' | 'style' | 'positioning';

export const BRAND_DOC_NAMES: BrandDocName[] = ['voice', 'style', 'positioning'];

export interface BrandDoc {
  name: BrandDocName;
  exists: boolean;
  updated: string;
  size: number;
}

interface CacheEntry {
  mtimesKey: string;
  context: string;
}

const MAX_PART_CHARS = 2500;

const contextCache = new Map<string, CacheEntry>();

function relativePath(name: BrandDocName): string {
  return `brand/${name}.md`;
}

async function fileMtime(absolutePath: string): Promise<number> {
  try {
    const s = await stat(absolutePath);
    return s.mtimeMs;
  } catch {
    return 0;
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + '\n\n[…gekuerzt]';
}

function stripFrontmatter(raw: string): string {
  if (raw.startsWith('---')) {
    const end = raw.indexOf('\n---', 3);
    if (end !== -1) return raw.slice(end + 4).replace(/^\n+/, '');
  }
  return raw;
}

export const BrandService = {
  async list(projectName: string): Promise<BrandDoc[]> {
    const vault = ProjectService.getVault(projectName);
    const results: BrandDoc[] = [];
    for (const name of BRAND_DOC_NAMES) {
      const rel = relativePath(name);
      const exists = await vault.fileExists(rel);
      let updated = '';
      let size = 0;
      if (exists) {
        try {
          const s = await stat(join(vault.root, rel));
          updated = new Date(s.mtime).toISOString();
          size = s.size;
        } catch {
          // ignorieren
        }
      }
      results.push({ name, exists, updated, size });
    }
    return results;
  },

  async read(projectName: string, name: BrandDocName): Promise<string> {
    if (!BRAND_DOC_NAMES.includes(name)) {
      throw new Error(`Unbekanntes Brand-Dokument: ${name}`);
    }
    const vault = ProjectService.getVault(projectName);
    const rel = relativePath(name);
    try {
      return await vault.readFile(rel);
    } catch {
      return BRAND_DEFAULTS[name];
    }
  },

  async write(projectName: string, name: BrandDocName, content: string): Promise<void> {
    if (!BRAND_DOC_NAMES.includes(name)) {
      throw new Error(`Unbekanntes Brand-Dokument: ${name}`);
    }
    const vault = ProjectService.getVault(projectName);
    await vault.writeFile(relativePath(name), content);
    contextCache.delete(projectName);
  },

  async installDefaults(projectRoot: string): Promise<void> {
    const { mkdir, writeFile } = await import('fs/promises');
    const { existsSync } = await import('fs');
    const brandDir = join(projectRoot, 'brand');
    await mkdir(brandDir, { recursive: true });
    for (const name of BRAND_DOC_NAMES) {
      const target = join(brandDir, `${name}.md`);
      if (existsSync(target)) continue;
      await writeFile(target, BRAND_DEFAULTS[name], 'utf-8');
    }
  },

  async getContext(projectName: string): Promise<string> {
    const vault = ProjectService.getVault(projectName);
    const paths = BRAND_DOC_NAMES.map((n) => join(vault.root, relativePath(n)));
    const mtimes = await Promise.all(paths.map(fileMtime));
    const mtimesKey = mtimes.join('|');

    const cached = contextCache.get(projectName);
    if (cached && cached.mtimesKey === mtimesKey) return cached.context;

    const parts: string[] = [];
    for (const name of BRAND_DOC_NAMES) {
      let raw: string;
      try {
        raw = await vault.readFile(relativePath(name));
      } catch {
        continue;
      }
      const body = stripFrontmatter(raw).trim();
      if (!body) continue;
      const label = name === 'voice' ? 'Voice' : name === 'style' ? 'Style' : 'Positioning';
      parts.push(`### ${label}\n\n${truncate(body, MAX_PART_CHARS)}`);
    }

    const context = parts.length > 0 ? parts.join('\n\n') : '';
    contextCache.set(projectName, { mtimesKey, context });
    return context;
  },

  invalidate(projectName: string): void {
    contextCache.delete(projectName);
  },
};

/**
 * Baut den Prompt-Injection-Block fuer alle KI-Call-Sites.
 * Liefert leeren String wenn keine Brand-Foundation vorhanden ist — der Prompt
 * enthaelt dann keinen leeren Abschnitt.
 */
export async function buildBrandContextBlock(projectName: string): Promise<string> {
  const ctx = await BrandService.getContext(projectName);
  if (!ctx.trim()) return '';
  return `## Brand-Foundation

Richte Ton, Stil und Positionierung der Ausgabe nach den folgenden Vorgaben aus. Diese Regeln ueberschreiben generische KI-Formulierungen.

${ctx}

---

`;
}
