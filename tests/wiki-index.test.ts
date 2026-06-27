import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { updateIndexes, deriveDescription } from '../src/main/core/vault';

describe('deriveDescription', () => {
  it('bevorzugt das description-Feld', () => {
    expect(deriveDescription('---\ndescription: Kurz und knapp.\n---\n# Titel\nLanger Fliesstext.\n'))
      .toBe('Kurz und knapp.');
  });

  it('faellt auf den ersten Fliesstext-Satz zurueck', () => {
    expect(deriveDescription('---\nstatus: seed\n---\n# Titel\nDies ist der erste Satz. Und der zweite.\n'))
      .toBe('Dies ist der erste Satz.');
  });

  it('ueberspringt Boilerplate-Abschnitte', () => {
    const c = '---\n---\n# Titel\n## Gegenargumente\n- nichts\n## Arbeitsnotizen\n- todo\n';
    expect(deriveDescription(c)).toBe('');
  });

  it('strippt Wikilinks und kuerzt', () => {
    const long = 'A'.repeat(200);
    const out = deriveDescription(`---\ndescription: siehe [[X]] dazu ${long}\n---\n`);
    expect(out).not.toContain('[[');
    expect(out.length).toBeLessThanOrEqual(140);
  });
});

describe('updateIndexes (Sentinel-Voll-Regeneration)', () => {
  let wiki: string;

  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-index-test-'));
    wiki = join(root, 'wiki');
    await mkdir(join(wiki, 'concepts'), { recursive: true });
    await mkdir(join(wiki, 'entities'), { recursive: true });
    await writeFile(join(wiki, 'index.md'),
      '# Mein Wiki\n\nMaster-Katalog des Wissens.\n\n## Quellen\n\n## Konzepte\n', 'utf-8');
    await writeFile(join(wiki, 'concepts', 'index.md'),
      '# Konzepte\n\nIdeen und Theorien.\n', 'utf-8');
    await writeFile(join(wiki, 'concepts', 'alpha.md'),
      '---\ndescription: Alpha erklaert.\n---\n# Alpha\nText.\n', 'utf-8');
    await writeFile(join(wiki, 'concepts', 'beta-gamma.md'),
      '---\nstatus: seed\n---\n# Beta\nBeta ist der erste Satz hier.\n', 'utf-8');
    await writeFile(join(wiki, 'entities', 'index.md'),
      '# Entitaeten\n\nDinge.\n', 'utf-8');
    await writeFile(join(wiki, 'entities', 'firma.md'),
      '---\ndescription: Eine Firma.\n---\n# Firma\n', 'utf-8');
  });

  afterEach(async () => {
    await rm(join(wiki, '..'), { recursive: true, force: true });
  });

  it('schreibt sortierte Eintraege mit Beschreibung in einen Sentinel-Block', async () => {
    const added = await updateIndexes(wiki);
    expect(added).toBe(3); // alpha, beta-gamma, firma

    const conceptsIdx = await readFile(join(wiki, 'concepts', 'index.md'), 'utf-8');
    expect(conceptsIdx).toContain('# Konzepte'); // Praeambel erhalten
    expect(conceptsIdx).toContain('<!-- auto-index -->');
    expect(conceptsIdx).toContain('- [[alpha]] — Alpha erklaert.');
    expect(conceptsIdx).toContain('- [[beta gamma]] — Beta ist der erste Satz hier.');
    // alphabetisch: alpha vor beta-gamma
    expect(conceptsIdx.indexOf('[[alpha]]')).toBeLessThan(conceptsIdx.indexOf('[[beta gamma]]'));
  });

  it('regeneriert idempotent (kein Duplizieren bei zweitem Lauf)', async () => {
    await updateIndexes(wiki);
    const after1 = await readFile(join(wiki, 'concepts', 'index.md'), 'utf-8');
    const added2 = await updateIndexes(wiki);
    const after2 = await readFile(join(wiki, 'concepts', 'index.md'), 'utf-8');
    expect(added2).toBe(0); // nichts Neues
    expect(after2).toBe(after1); // byte-identisch
    expect(after2.match(/\[\[alpha\]\]/g)?.length).toBe(1); // genau einmal
  });

  it('gruppiert den Hauptindex nach Kategorie und erhaelt das Intro', async () => {
    await updateIndexes(wiki);
    const main = await readFile(join(wiki, 'index.md'), 'utf-8');
    expect(main).toContain('Master-Katalog des Wissens.'); // Intro erhalten
    expect(main).toContain('### Konzepte');
    expect(main).toContain('### Entitaeten');
    expect(main).toContain('- [[firma]] — Eine Firma.');
  });

  it('bewahrt manuelle Eintraege ausserhalb des Sentinel-Blocks', async () => {
    await updateIndexes(wiki);
    // Mensch ergaenzt Prosa oberhalb des Auto-Blocks
    const path = join(wiki, 'concepts', 'index.md');
    const edited = (await readFile(path, 'utf-8')).replace('<!-- auto-index -->', 'Handnotiz.\n\n<!-- auto-index -->');
    await writeFile(path, edited, 'utf-8');
    await updateIndexes(wiki);
    const after = await readFile(path, 'utf-8');
    expect(after).toContain('Handnotiz.');
  });
});
