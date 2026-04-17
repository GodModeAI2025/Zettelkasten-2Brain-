declare module 'graphology-pagerank' {
  import type Graph from 'graphology';

  interface PagerankOptions {
    alpha?: number;
    tolerance?: number;
    maxIterations?: number;
    getEdgeWeight?: string | null;
  }

  function pagerank(graph: Graph, options?: PagerankOptions): Record<string, number>;
  export default pagerank;
}
