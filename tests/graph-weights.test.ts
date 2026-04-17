import { describe, it, expect } from 'vitest';
import {
  jaccardSimilarity,
  cosineSimilarity,
  tfNormSquared,
  computeEdgeWeight,
  sparsifyEdgesTopK,
  EDGE_BASE_WEIGHT,
} from '../src/main/core/graph-weights';

describe('jaccardSimilarity', () => {
  it('liefert 0 fuer zwei leere Arrays', () => {
    expect(jaccardSimilarity([], [])).toBe(0);
  });

  it('liefert 0 bei disjunkten Tag-Mengen', () => {
    expect(jaccardSimilarity(['a', 'b'], ['c', 'd'])).toBe(0);
  });

  it('liefert 1 bei identischen Tag-Mengen', () => {
    expect(jaccardSimilarity(['a', 'b'], ['b', 'a'])).toBe(1);
  });

  it('berechnet Overlap-Anteil korrekt', () => {
    // |{a,b} ∩ {b,c}| / |{a,b,c}| = 1/3
    expect(jaccardSimilarity(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3);
  });

  it('behandelt Duplikate im Input wie Mengen', () => {
    expect(jaccardSimilarity(['a', 'a', 'b'], ['a', 'b', 'b'])).toBe(1);
  });
});

describe('tfNormSquared', () => {
  it('liefert 0 fuer leeren Vektor', () => {
    expect(tfNormSquared({})).toBe(0);
  });

  it('summiert quadrierte Werte', () => {
    expect(tfNormSquared({ a: 3, b: 4 })).toBe(25);
  });
});

describe('cosineSimilarity', () => {
  it('liefert 0 bei leeren Vektoren', () => {
    expect(cosineSimilarity({}, { a: 1 }, 0, 1)).toBe(0);
    expect(cosineSimilarity({ a: 1 }, {}, 1, 0)).toBe(0);
  });

  it('liefert 1 bei identischen Vektoren', () => {
    const tf = { a: 2, b: 3 };
    const n = tfNormSquared(tf);
    expect(cosineSimilarity(tf, tf, n, n)).toBeCloseTo(1);
  });

  it('liefert 0 bei disjunkten Vektoren', () => {
    const a = { x: 1 };
    const b = { y: 1 };
    expect(cosineSimilarity(a, b, tfNormSquared(a), tfNormSquared(b))).toBe(0);
  });

  it('liefert symmetrischen Wert', () => {
    const a = { x: 2, y: 1 };
    const b = { x: 1, z: 3 };
    const na = tfNormSquared(a);
    const nb = tfNormSquared(b);
    expect(cosineSimilarity(a, b, na, nb)).toBeCloseTo(cosineSimilarity(b, a, nb, na));
  });
});

describe('computeEdgeWeight', () => {
  it('liefert Basisgewicht fuer Kante ohne Signale', () => {
    const w = computeEdgeWeight({ reciprocal: false, tagJaccard: 0, contentSim: 0 });
    expect(w).toBeCloseTo(EDGE_BASE_WEIGHT);
  });

  it('addiert Reziprozitaets-Bonus', () => {
    const w = computeEdgeWeight({ reciprocal: true, tagJaccard: 0, contentSim: 0 });
    expect(w).toBeCloseTo(EDGE_BASE_WEIGHT + 0.2);
  });

  it('skaliert Tag-Jaccard-Einfluss linear', () => {
    const zero = computeEdgeWeight({ reciprocal: false, tagJaccard: 0, contentSim: 0 });
    const half = computeEdgeWeight({ reciprocal: false, tagJaccard: 0.5, contentSim: 0 });
    const full = computeEdgeWeight({ reciprocal: false, tagJaccard: 1, contentSim: 0 });
    expect(half - zero).toBeCloseTo(0.15);
    expect(full - zero).toBeCloseTo(0.3);
  });

  it('erreicht maximal 1.0', () => {
    const w = computeEdgeWeight({ reciprocal: true, tagJaccard: 1, contentSim: 1 });
    expect(w).toBeCloseTo(1);
  });

  it('klemmt Input auf [0,1]', () => {
    const clamped = computeEdgeWeight({ reciprocal: false, tagJaccard: 5, contentSim: -2 });
    expect(clamped).toBeCloseTo(EDGE_BASE_WEIGHT + 0.3);
  });
});

describe('sparsifyEdgesTopK', () => {
  it('liefert leere Liste fuer leeren Input', () => {
    expect(sparsifyEdgesTopK([], 3)).toEqual([]);
  });

  it('gibt Eingabe zurueck wenn k <= 0', () => {
    const edges = [{ source: 'a', target: 'b', weight: 0.5 }];
    expect(sparsifyEdgesTopK(edges, 0)).toBe(edges);
  });

  it('behaelt pro Knoten die k staerksten Kanten', () => {
    // Stern: a mit 5 Nachbarn, unterschiedliche Gewichte
    const edges = [
      { source: 'a', target: 'b', weight: 0.9 },
      { source: 'a', target: 'c', weight: 0.8 },
      { source: 'a', target: 'd', weight: 0.7 },
      { source: 'a', target: 'e', weight: 0.6 },
      { source: 'a', target: 'f', weight: 0.5 },
    ];
    const kept = sparsifyEdgesTopK(edges, 2);
    // a sieht alle → Top-2 sind 0.9 und 0.8. Jeder Leaf hat nur 1 Kante,
    // die ist automatisch in seiner Top-k-Liste → alle bleiben via Union.
    expect(kept.length).toBe(5);
  });

  it('entfernt schwache Kanten zwischen gut-verbundenen Knoten', () => {
    // Zwei Dreiecke (abc, xyz) mit starken Kanten + eine schwache Bruecke c–x.
    // Jeder Knoten hat 2 starke Nachbarn → Bruecke ist Rang 3 bei c und x.
    const edges = [
      { source: 'a', target: 'b', weight: 1.0 },
      { source: 'b', target: 'c', weight: 1.0 },
      { source: 'a', target: 'c', weight: 1.0 },
      { source: 'x', target: 'y', weight: 1.0 },
      { source: 'y', target: 'z', weight: 1.0 },
      { source: 'x', target: 'z', weight: 1.0 },
      { source: 'c', target: 'x', weight: 0.4 },
    ];
    const kept = sparsifyEdgesTopK(edges, 2);
    const hasBridge = kept.some((e) => e.source === 'c' && e.target === 'x');
    expect(hasBridge).toBe(false);
    expect(kept.length).toBe(6);
  });
});
