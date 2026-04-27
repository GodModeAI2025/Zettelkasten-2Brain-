declare module 'graphology-pagerank' {
  import type Graphology from 'graphology';

  interface PagerankOptions {
    alpha?: number;
    tolerance?: number;
    maxIterations?: number;
    getEdgeWeight?: string | null;
  }

  function pagerank(graph: Graphology, options?: PagerankOptions): Record<string, number>;
  export default pagerank;
}
