import { describe, it, expect } from 'vitest';
import { bm25Rank } from '../src/main/core/search';
import type { WikiPage } from '../src/main/core/vault';

function page(relativePath: string, content: string, frontmatter: Record<string, unknown> = {}): WikiPage {
  return {
    path: `/tmp/${relativePath}`,
    relativePath,
    content,
    contentLower: content.toLowerCase(),
    frontmatter,
  };
}

function corpus(n: number): WikiPage[] {
  const pages: WikiPage[] = [];
  for (let i = 0; i < n; i++) {
    pages.push(
      page(
        `wiki/concepts/filler-${i}.md`,
        `Dies ist eine Fuellseite ${i} mit generischem Text ueber verschiedene Themen und Konzepte.`,
      ),
    );
  }
  return pages;
}

describe('bm25Rank', () => {
  it('liefert leeres Array bei leerer Query', () => {
    const pages = corpus(10);
    expect(bm25Rank(pages, [])).toEqual([]);
  });

  it('liefert leeres Array ohne Seiten', () => {
    expect(bm25Rank([], ['test'])).toEqual([]);
  });

  it('findet Seite mit Query-Term im Content', () => {
    const pages = [
      ...corpus(10),
      page('wiki/concepts/transformer.md', 'Der Transformer ist eine neuronale Netzwerkarchitektur fuer Sequenzverarbeitung.'),
    ];
    const results = bm25Rank(pages, ['transformer']);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].relativePath).toBe('wiki/concepts/transformer.md');
  });

  it('gibt Title-Treffern mehr Gewicht als Content-Treffern', () => {
    const pages = [
      ...corpus(10),
      // Seite A: Term nur im Content, oft
      page(
        'wiki/concepts/andere-seite.md',
        'Hier wird Zettelkasten mehrfach erwaehnt. Der Zettelkasten ist gut. Zettelkasten Zettelkasten Zettelkasten Zettelkasten.',
      ),
      // Seite B: Term im Titel, nur einmal im Content
      page(
        'wiki/concepts/zettelkasten.md',
        'Notiz-Methode aus dem letzten Jahrhundert.',
      ),
    ];
    const results = bm25Rank(pages, ['zettelkasten']);
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0].relativePath).toBe('wiki/concepts/zettelkasten.md');
  });

  it('bevorzugt Frontmatter-Title ueber Dateiname', () => {
    const pages = [
      ...corpus(10),
      page(
        'wiki/entities/slug-abc.md',
        'Generischer Inhalt ohne Keyword.',
        { title: 'Niklas Luhmann' },
      ),
      page(
        'wiki/entities/anderer.md',
        'Text der Niklas einmal erwaehnt in einer kurzen Nebenbemerkung.',
      ),
    ];
    const results = bm25Rank(pages, ['niklas', 'luhmann']);
    expect(results[0].relativePath).toBe('wiki/entities/slug-abc.md');
  });

  it('respektiert das limit', () => {
    const pages = [
      ...corpus(5),
      page('wiki/concepts/alpha.md', 'alpha alpha alpha transformer'),
      page('wiki/concepts/beta.md', 'beta beta transformer'),
      page('wiki/concepts/gamma.md', 'gamma transformer'),
    ];
    const results = bm25Rank(pages, ['transformer'], { limit: 2 });
    expect(results).toHaveLength(2);
  });

  it('normalisiert und entfernt Stopwords aus Query', () => {
    const pages = [
      ...corpus(10),
      page('wiki/concepts/kubernetes.md', 'Kubernetes orchestriert Container.'),
    ];
    // "was ist" sind Stopwords; nur "kubernetes" zaehlt
    const results = bm25Rank(pages, ['Was', 'ist', 'Kubernetes']);
    expect(results[0].relativePath).toBe('wiki/concepts/kubernetes.md');
  });

  it('filtert Tokens kuerzer als 3 Zeichen', () => {
    const pages = [
      ...corpus(10),
      page('wiki/concepts/ki.md', 'KI ist wichtig.'),
      page('wiki/concepts/sprachmodelle.md', 'Sprachmodelle analysieren Text mit Transformern.'),
    ];
    // "ki" ist zu kurz — sollte nicht matchen
    const results = bm25Rank(pages, ['ki', 'sprachmodelle']);
    expect(results[0].relativePath).toBe('wiki/concepts/sprachmodelle.md');
  });

  it('Phrase-Boost: Multi-Wort-Query matcht zusammenhaengenden Text', () => {
    const pages = [
      ...corpus(10),
      // enthaelt beide Woerter, aber weit auseinander
      page('wiki/concepts/getrennt.md', 'Neuronale Netze sind toll. Viele Seiten spaeter: Architektur von Systemen.'),
      // enthaelt die exakte Phrase
      page('wiki/concepts/phrase.md', 'Eine neuronale Architektur ist das Herzstueck des Modells.'),
    ];
    const results = bm25Rank(pages, ['neuronale architektur']);
    expect(results[0].relativePath).toBe('wiki/concepts/phrase.md');
  });

  it('Fallback bei sehr kleinem Korpus (<5 Seiten)', () => {
    const pages = [
      page('wiki/concepts/a.md', 'Der Transformer.'),
      page('wiki/concepts/b.md', 'Keine Keywords hier.'),
      page('wiki/concepts/c.md', 'Transformer und mehr Transformer.'),
    ];
    const results = bm25Rank(pages, ['transformer']);
    expect(results.map((p) => p.relativePath)).toContain('wiki/concepts/a.md');
    expect(results.map((p) => p.relativePath)).toContain('wiki/concepts/c.md');
    expect(results.map((p) => p.relativePath)).not.toContain('wiki/concepts/b.md');
  });

  it('Laengennormalisierung: kuerzere Seite mit gleichem TF gewinnt', () => {
    const pages = [
      ...corpus(10),
      // Lange Seite, Keyword einmal
      page(
        'wiki/concepts/lang.md',
        'Etwas Fuelltext der sehr lang ist. '.repeat(50) + 'Quantenphysik beschrieben.',
      ),
      // Kurze Seite, Keyword einmal
      page('wiki/concepts/kurz.md', 'Quantenphysik ist faszinierend.'),
    ];
    const results = bm25Rank(pages, ['quantenphysik']);
    const idxKurz = results.findIndex((p) => p.relativePath === 'wiki/concepts/kurz.md');
    const idxLang = results.findIndex((p) => p.relativePath === 'wiki/concepts/lang.md');
    expect(idxKurz).toBeLessThan(idxLang);
  });

  it('Seiten ohne Treffer werden herausgefiltert', () => {
    const pages = corpus(10);
    const results = bm25Rank(pages, ['existiertnicht']);
    expect(results).toEqual([]);
  });

  it('deterministische Sortierung bei gleichem Score (nach relativePath)', () => {
    const pages = [
      page('wiki/concepts/b.md', 'Transformer.'),
      page('wiki/concepts/a.md', 'Transformer.'),
      ...corpus(10),
    ];
    const results = bm25Rank(pages, ['transformer']);
    const paths = results.map((p) => p.relativePath);
    expect(paths[0]).toBe('wiki/concepts/a.md');
    expect(paths[1]).toBe('wiki/concepts/b.md');
  });
});
