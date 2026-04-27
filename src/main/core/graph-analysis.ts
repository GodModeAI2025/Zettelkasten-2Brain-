import Graphology from 'graphology';
import louvain from 'graphology-communities-louvain';
import pagerank from 'graphology-pagerank';

/**
 * Strukturelle Analyse des Wiki-Graphen: Community-Detection (Louvain)
 * und Zentralitaet (PageRank). Beide operieren auf den gewichteten
 * Kanten aus graph-weights.ts. Resultate werden pro Knoten-ID indiziert.
 */

export interface GraphAnalysisInput {
  nodeIds: string[];
  edges: Array<{ source: string; target: string; weight: number }>;
}

export interface GraphAnalysisResult {
  communities: Map<string, number>;
  pagerank: Map<string, number>;
}

export function analyzeGraph(input: GraphAnalysisInput): GraphAnalysisResult {
  const communities = new Map<string, number>();
  const ranks = new Map<string, number>();

  if (input.nodeIds.length === 0) {
    return { communities, pagerank: ranks };
  }

  const graph = new Graphology({ type: 'undirected', allowSelfLoops: false });
  for (const id of input.nodeIds) {
    graph.addNode(id);
  }
  for (const edge of input.edges) {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
    if (edge.source === edge.target) continue;
    if (graph.hasEdge(edge.source, edge.target)) continue;
    graph.addEdge(edge.source, edge.target, { weight: edge.weight });
  }

  // Louvain: partitioniert Graph in dichte Teilgraphen. Isolierte Knoten
  // erhalten eigene Community-Nummern (je eine pro Knoten).
  const communityMap = louvain(graph, { getEdgeWeight: 'weight' });
  for (const [nodeId, c] of Object.entries(communityMap)) {
    communities.set(nodeId, c as number);
  }

  // PageRank: Zentralitaet unter Beruecksichtigung der Kantengewichte.
  // Konvergiert fuer pathologische Topologien nicht zuverlaessig — dann
  // fallen wir auf Degree-basierte Zentralitaet zurueck.
  if (graph.size > 0) {
    try {
      const pr = pagerank(graph, {
        getEdgeWeight: 'weight',
        alpha: 0.85,
        tolerance: 1e-4,
        maxIterations: 200,
      });
      for (const [nodeId, score] of Object.entries(pr)) {
        ranks.set(nodeId, score as number);
      }
    } catch {
      fillDegreeFallback(graph, input.nodeIds, ranks);
    }
  } else {
    const uniform = 1 / graph.order;
    for (const id of input.nodeIds) ranks.set(id, uniform);
  }

  return { communities, pagerank: ranks };
}

function fillDegreeFallback(graph: Graphology, nodeIds: string[], ranks: Map<string, number>): void {
  let total = 0;
  const raw = new Map<string, number>();
  for (const id of nodeIds) {
    const d = graph.hasNode(id) ? graph.degree(id) : 0;
    raw.set(id, d + 1);
    total += d + 1;
  }
  for (const [id, v] of raw) ranks.set(id, v / total);
}

/**
 * Normiert PageRank-Scores auf [0, 1] relativ zum Maximum. Vereinfacht
 * die visuelle Skalierung im Renderer (Radius = base + norm * scale).
 */
export function normalizePageRank(pr: Map<string, number>): Map<string, number> {
  if (pr.size === 0) return pr;
  let max = 0;
  for (const v of pr.values()) if (v > max) max = v;
  if (max === 0) return pr;
  const out = new Map<string, number>();
  for (const [id, v] of pr) out.set(id, v / max);
  return out;
}
