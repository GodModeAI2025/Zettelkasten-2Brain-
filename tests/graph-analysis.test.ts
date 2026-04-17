import { describe, it, expect } from 'vitest';
import { analyzeGraph, normalizePageRank } from '../src/main/core/graph-analysis';

describe('analyzeGraph', () => {
  it('liefert leere Maps fuer leeren Input', () => {
    const r = analyzeGraph({ nodeIds: [], edges: [] });
    expect(r.communities.size).toBe(0);
    expect(r.pagerank.size).toBe(0);
  });

  it('weist isolierten Knoten eine Community zu', () => {
    const r = analyzeGraph({ nodeIds: ['a', 'b'], edges: [] });
    expect(r.communities.has('a')).toBe(true);
    expect(r.communities.has('b')).toBe(true);
  });

  it('erkennt zwei dichte Cluster als unterschiedliche Communities', () => {
    const nodeIds = ['a', 'b', 'c', 'x', 'y', 'z'];
    const edges = [
      { source: 'a', target: 'b', weight: 1 },
      { source: 'b', target: 'c', weight: 1 },
      { source: 'a', target: 'c', weight: 1 },
      { source: 'x', target: 'y', weight: 1 },
      { source: 'y', target: 'z', weight: 1 },
      { source: 'x', target: 'z', weight: 1 },
      { source: 'c', target: 'x', weight: 0.1 }, // schwache Bruecke
    ];
    const r = analyzeGraph({ nodeIds, edges });
    const cA = r.communities.get('a');
    const cB = r.communities.get('b');
    const cC = r.communities.get('c');
    const cX = r.communities.get('x');
    const cY = r.communities.get('y');
    expect(cA).toBe(cB);
    expect(cA).toBe(cC);
    expect(cX).toBe(cY);
    expect(cA).not.toBe(cX);
  });

  it('ignoriert Self-Loops und doppelte Kanten', () => {
    const r = analyzeGraph({
      nodeIds: ['a', 'b'],
      edges: [
        { source: 'a', target: 'a', weight: 1 },
        { source: 'a', target: 'b', weight: 1 },
        { source: 'a', target: 'b', weight: 0.5 },
      ],
    });
    expect(r.communities.get('a')).toBe(r.communities.get('b'));
    expect(r.pagerank.get('a')).toBeGreaterThan(0);
  });

  it('gibt hoeheren PageRank fuer zentralen Knoten', () => {
    // Stern: center mit 5 Leafs
    const nodeIds = ['center', 'l1', 'l2', 'l3', 'l4', 'l5'];
    const edges = ['l1', 'l2', 'l3', 'l4', 'l5'].map((l) => ({ source: 'center', target: l, weight: 1 }));
    const r = analyzeGraph({ nodeIds, edges });
    const centerRank = r.pagerank.get('center') ?? 0;
    const leafRank = r.pagerank.get('l1') ?? 0;
    expect(centerRank).toBeGreaterThan(leafRank);
  });

  it('PageRank-Summe entspricht ungefaehr 1', () => {
    const r = analyzeGraph({
      nodeIds: ['a', 'b', 'c', 'd', 'e'],
      edges: [
        { source: 'a', target: 'b', weight: 0.9 },
        { source: 'b', target: 'c', weight: 0.6 },
        { source: 'c', target: 'd', weight: 0.4 },
        { source: 'd', target: 'e', weight: 0.8 },
      ],
    });
    const sum = [...r.pagerank.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 2);
  });
});

describe('normalizePageRank', () => {
  it('haelt leere Map leer', () => {
    expect(normalizePageRank(new Map()).size).toBe(0);
  });

  it('normiert auf [0, 1] mit Maximum = 1', () => {
    const raw = new Map([
      ['a', 0.4],
      ['b', 0.2],
      ['c', 0.1],
    ]);
    const norm = normalizePageRank(raw);
    expect(norm.get('a')).toBeCloseTo(1);
    expect(norm.get('b')).toBeCloseTo(0.5);
    expect(norm.get('c')).toBeCloseTo(0.25);
  });
});
