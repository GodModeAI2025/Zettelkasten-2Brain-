/**
 * Kantengewichtung fuer den Knowledge-Graph.
 *
 * Gewicht = 0.3 (Basis: Wikilink existiert)
 *        + 0.2 * reciprocal (beide Richtungen vorhanden)
 *        + 0.3 * tagJaccard  (Overlap der Tags)
 *        + 0.2 * contentSim  (Cosine auf TF-Vektoren aus Search-Index)
 *
 * Wertebereich: [0.3, 1.0]. Schwache Kanten (nur Basis) bleiben knapp
 * ueber dem Filter-Default, starke Kanten (reziprok + Tag-Overlap + Content)
 * erreichen das Maximum.
 */

export const EDGE_BASE_WEIGHT = 0.3;
export const EDGE_RECIPROCAL_WEIGHT = 0.2;
export const EDGE_TAG_WEIGHT = 0.3;
export const EDGE_CONTENT_WEIGHT = 0.2;

export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function tfNormSquared(tf: Record<string, number>): number {
  let sum = 0;
  for (const k in tf) {
    const v = tf[k];
    sum += v * v;
  }
  return sum;
}

/**
 * Cosine-Similarity auf TF-Vektoren. Iteriert ueber den kleineren Vektor,
 * damit die Kosten O(min(|A|, |B|)) sind.
 */
export function cosineSimilarity(
  tfA: Record<string, number>,
  tfB: Record<string, number>,
  normSquaredA: number,
  normSquaredB: number,
): number {
  if (normSquaredA === 0 || normSquaredB === 0) return 0;
  const aSize = Object.keys(tfA).length;
  const bSize = Object.keys(tfB).length;
  const small = aSize < bSize ? tfA : tfB;
  const large = aSize < bSize ? tfB : tfA;
  let dot = 0;
  for (const term in small) {
    const other = large[term];
    if (other) dot += small[term] * other;
  }
  return dot / (Math.sqrt(normSquaredA) * Math.sqrt(normSquaredB));
}

export interface EdgeWeightInputs {
  reciprocal: boolean;
  tagJaccard: number;
  contentSim: number;
}

export function computeEdgeWeight(inputs: EdgeWeightInputs): number {
  const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const tag = clamp(inputs.tagJaccard);
  const content = clamp(inputs.contentSim);
  const weight =
    EDGE_BASE_WEIGHT +
    (inputs.reciprocal ? EDGE_RECIPROCAL_WEIGHT : 0) +
    EDGE_TAG_WEIGHT * tag +
    EDGE_CONTENT_WEIGHT * content;
  return Math.min(1, weight);
}

/**
 * k-NN-Sparsifizierung: behaelt pro Knoten die top-k staerksten Kanten.
 * Eine Kante ueberlebt, wenn sie in der top-k-Liste *eines* ihrer Endpunkte
 * liegt (Union). Das reduziert visuelles Rauschen stark, zerreisst aber
 * keine Cluster — jeder Knoten behaelt seine wichtigsten Verbindungen.
 */
export function sparsifyEdgesTopK<E extends { source: string; target: string; weight: number }>(
  edges: E[],
  k: number,
): E[] {
  if (k <= 0 || edges.length === 0) return edges;
  const perNode = new Map<string, E[]>();
  const push = (id: string, edge: E) => {
    const list = perNode.get(id);
    if (list) list.push(edge); else perNode.set(id, [edge]);
  };
  for (const e of edges) {
    push(e.source, e);
    push(e.target, e);
  }
  const keep = new Set<E>();
  for (const list of perNode.values()) {
    list.sort((a, b) => b.weight - a.weight);
    for (let i = 0; i < Math.min(k, list.length); i++) keep.add(list[i]);
  }
  return edges.filter((e) => keep.has(e));
}
