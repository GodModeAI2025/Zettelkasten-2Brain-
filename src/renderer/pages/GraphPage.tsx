import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { useProjectStore } from '../stores/project.store';
import { api, hasApi } from '../api/bridge';
import type { GraphData, GraphNode, GraphEdge } from '../../shared/api.types';

// Typ-Kodierung ueber Form statt Farbe — Farbe bleibt frei fuer Communities.
type NodeShape = 'circle' | 'square' | 'diamond' | 'star' | 'triangle' | 'hexagon' | 'dot';
const DIR_SHAPES: Record<string, { shape: NodeShape; label: string }> = {
  sources:   { shape: 'square',   label: 'Quellen' },
  entities:  { shape: 'circle',   label: 'Entitäten' },
  concepts:  { shape: 'diamond',  label: 'Konzepte' },
  syntheses: { shape: 'star',     label: 'Synthesen' },
  synthesis: { shape: 'star',     label: 'Synthesen' },
  sops:      { shape: 'triangle', label: 'SOPs' },
  decisions: { shape: 'hexagon',  label: 'Entscheidungen' },
  other:     { shape: 'dot',      label: 'Sonstige' },
};

const COMMUNITY_PALETTE = [
  { fill: '#0A84FF', stroke: '#0070E0' },
  { fill: '#FF9F0A', stroke: '#E08E00' },
  { fill: '#30D158', stroke: '#28B74C' },
  { fill: '#BF5AF2', stroke: '#A344D4' },
  { fill: '#FF375F', stroke: '#D42E50' },
  { fill: '#64D2FF', stroke: '#50A8CC' },
  { fill: '#FFD60A', stroke: '#CCB008' },
  { fill: '#AC8E68', stroke: '#8A7253' },
  { fill: '#FF6482', stroke: '#CC506A' },
  { fill: '#5E5CE6', stroke: '#4B4AB8' },
  { fill: '#32D74B', stroke: '#28A83A' },
  { fill: '#FF9500', stroke: '#D97E00' },
];

const FALLBACK_COLOR = { fill: '#8E8E93', stroke: '#6C6C70' };

// Typ-Tags, die nicht als thematisches Community-Label taugen
const TYPE_TAG_STOPLIST = new Set([
  'framework', 'concept', 'person', 'organization', 'tool',
  'technique', 'podcast', 'transcript', 'product', 'source',
]);

const HIGHLIGHT_COLOR = '#FF9F0A';

interface InternalLink {
  source: string | GraphNode;
  target: string | GraphNode;
  weight: number;
  reciprocal: boolean;
  tagSimilarity: number;
  contentSimilarity: number;
}

interface InternalGraphData {
  nodes: GraphNode[];
  links: InternalLink[];
}

function linkEndId(end: string | GraphNode): string {
  return typeof end === 'object' ? end.id : end;
}

/**
 * Label-Wahl pro Community: Tag mit hoechstem (lokal / global)-Verhaeltnis —
 * TF-IDF-artig, waehlt also den fuer dieses Cluster charakteristischsten Tag,
 * nicht den global haeufigsten. Labels, die bereits von einer groesseren
 * Community belegt sind, werden uebersprungen, damit die Legende keine
 * Duplikate zeigt. Fallback "Cluster N".
 */
function buildCommunities(nodes: GraphNode[]): Map<string, { fill: string; stroke: string; label: string; size: number; hasName: boolean }> {
  const globalCounts = new Map<string, number>();
  const raw = new Map<string, { tagCounts: Map<string, number>; size: number }>();
  for (const node of nodes) {
    const key = String(node.community);
    let entry = raw.get(key);
    if (!entry) {
      entry = { tagCounts: new Map(), size: 0 };
      raw.set(key, entry);
    }
    entry.size++;
    for (const tag of node.tags || []) {
      if (TYPE_TAG_STOPLIST.has(tag)) continue;
      entry.tagCounts.set(tag, (entry.tagCounts.get(tag) || 0) + 1);
      globalCounts.set(tag, (globalCounts.get(tag) || 0) + 1);
    }
  }

  const sorted = [...raw.entries()].sort((a, b) => b[1].size - a[1].size);
  const usedLabels = new Set<string>();
  const out = new Map<string, { fill: string; stroke: string; label: string; size: number; hasName: boolean }>();
  sorted.forEach(([key, info], i) => {
    const palette = COMMUNITY_PALETTE[i % COMMUNITY_PALETTE.length];
    const ranked = [...info.tagCounts.entries()]
      .map(([tag, local]) => ({
        tag,
        // Spezifitaet: wie stark konzentriert ist der Tag in dieser Community?
        score: local / Math.max(1, globalCounts.get(tag) ?? 1) * Math.log(1 + local),
      }))
      .sort((a, b) => b.score - a.score);
    const pick = ranked.find((r) => !usedLabels.has(r.tag));
    const label = pick
      ? pick.tag.charAt(0).toUpperCase() + pick.tag.slice(1)
      : `Cluster ${i + 1}`;
    if (pick) usedLabels.add(pick.tag);
    out.set(key, { ...palette, label, size: info.size, hasName: !!pick });
  });
  return out;
}

function getCommunityKey(node: GraphNode): string {
  return String(node.community);
}

/** Zeichnet eine der unterstuetzten Knotenformen zentriert auf (x, y). */
function paintShape(ctx: CanvasRenderingContext2D, shape: NodeShape, x: number, y: number, r: number): void {
  ctx.beginPath();
  switch (shape) {
    case 'square': {
      const s = r * 1.7;
      ctx.rect(x - s / 2, y - s / 2, s, s);
      break;
    }
    case 'diamond': {
      const d = r * 1.2;
      ctx.moveTo(x, y - d);
      ctx.lineTo(x + d, y);
      ctx.lineTo(x, y + d);
      ctx.lineTo(x - d, y);
      ctx.closePath();
      break;
    }
    case 'star': {
      const outer = r * 1.2;
      const inner = outer * 0.5;
      for (let i = 0; i < 10; i++) {
        const rad = (i * Math.PI) / 5 - Math.PI / 2;
        const rr = i % 2 === 0 ? outer : inner;
        const px = x + Math.cos(rad) * rr;
        const py = y + Math.sin(rad) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case 'triangle': {
      const t = r * 1.3;
      ctx.moveTo(x, y - t);
      ctx.lineTo(x + t * 0.87, y + t * 0.5);
      ctx.lineTo(x - t * 0.87, y + t * 0.5);
      ctx.closePath();
      break;
    }
    case 'hexagon': {
      const h = r * 1.15;
      for (let i = 0; i < 6; i++) {
        const rad = (i * Math.PI) / 3;
        const px = x + Math.cos(rad) * h;
        const py = y + Math.sin(rad) * h;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case 'dot':
    case 'circle':
    default:
      ctx.arc(x, y, r, 0, 2 * Math.PI);
  }
}

function getThemeColors() {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return {
    bg: dark ? '#1C1C1E' : '#F9F9F8',
    edge: dark ? '#636366' : '#8E8E93',
    edgeHover: dark ? '#BF5AF2' : '#5856D6',
    label: dark ? '#F2F2F7' : '#1C1C1E',
    labelDim: dark ? 'rgba(242,242,247,0.55)' : 'rgba(28,28,30,0.55)',
  };
}

export function GraphPage() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const [graphData, setGraphData] = useState<InternalGraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [activeGroups, setActiveGroups] = useState<Set<string>>(new Set());
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [linkDistance, setLinkDistance] = useState(30);
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(undefined);
  const [themeColors, setThemeColors] = useState(getThemeColors);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setThemeColors(getThemeColors());
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const loadGraph = useCallback(async () => {
    if (!activeProject || !hasApi) return;
    setLoading(true);
    setError(null);
    try {
      const data: GraphData = await api.wiki.getGraphData(activeProject);
      setGraphData({
        nodes: data.nodes,
        links: data.edges.map((e: GraphEdge) => ({
          source: e.source,
          target: e.target,
          weight: e.weight,
          reciprocal: e.reciprocal,
          tagSimilarity: e.tagSimilarity,
          contentSimilarity: e.contentSimilarity,
        })),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [activeProject]);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  const communityCategories = useMemo(() => {
    if (!graphData) return new Map<string, { fill: string; stroke: string; label: string; size: number; hasName: boolean }>();
    return buildCommunities(graphData.nodes);
  }, [graphData]);

  const groupsInitialized = useRef(false);
  useEffect(() => {
    if (!graphData || groupsInitialized.current) return;
    setActiveGroups(new Set(communityCategories.keys()));
    groupsInitialized.current = true;
  }, [graphData, communityCategories]);

  const searchLower = search.toLowerCase();
  const matchingNodeIds = useMemo(() => {
    if (!searchLower || !graphData) return null;
    return new Set(
      graphData.nodes
        .filter((n) => n.label.toLowerCase().includes(searchLower) || n.id.toLowerCase().includes(searchLower))
        .map((n) => n.id)
    );
  }, [searchLower, graphData]);

  const neighborMap = useMemo(() => {
    if (!graphData) return new Map<string, Set<string>>();
    const map = new Map<string, Set<string>>();
    const touch = (id: string): Set<string> => {
      let set = map.get(id);
      if (!set) {
        set = new Set();
        map.set(id, set);
      }
      return set;
    };
    for (const link of graphData.links) {
      const s = linkEndId(link.source);
      const t = linkEndId(link.target);
      touch(s).add(t);
      touch(t).add(s);
    }
    return map;
  }, [graphData]);

  const selectedNodeLinks = useMemo(() => {
    if (!selectedNode || !graphData) return { incoming: [] as string[], outgoing: [] as string[] };
    const incoming: string[] = [];
    const outgoing: string[] = [];
    for (const link of graphData.links) {
      const s = linkEndId(link.source);
      const t = linkEndId(link.target);
      if (s === selectedNode.id) outgoing.push(t);
      if (t === selectedNode.id) incoming.push(s);
    }
    return { incoming, outgoing };
  }, [selectedNode, graphData]);

  function isHighlighted(nodeId: string): boolean {
    if (hoveredNode) {
      return nodeId === hoveredNode.id || (neighborMap.get(hoveredNode.id)?.has(nodeId) ?? false);
    }
    if (matchingNodeIds) {
      return matchingNodeIds.has(nodeId);
    }
    return true;
  }

  function handleNodeClick(node: GraphNode & { x?: number; y?: number }) {
    setSelectedNode(node);
  }

  function toggleGroup(group: string) {
    setActiveGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  }

  // Label-Overlap-Tracking: belegte Bereiche pro Frame
  const labelRectsRef = useRef<Array<{ x1: number; y1: number; x2: number; y2: number }>>([]);
  const lastPaintFrameRef = useRef(0);

  const paintNode = useCallback(
    (node: GraphNode & { x?: number; y?: number }, ctx: CanvasRenderingContext2D) => {
      if (!node.x || !node.y) return;
      const category = getCommunityKey(node);
      if (!activeGroups.has(category)) return;

      // Frame-Wechsel erkennen → belegte Bereiche zurücksetzen
      const now = performance.now();
      if (now - lastPaintFrameRef.current > 8) {
        labelRectsRef.current = [];
        lastPaintFrameRef.current = now;
      }

      const colors = communityCategories.get(category) || FALLBACK_COLOR;
      const shape = DIR_SHAPES[node.group]?.shape || 'circle';
      const highlighted = isHighlighted(node.id);
      const isSelected = selectedNode?.id === node.id;
      const zoom = fgRef.current?.zoom?.() || 1;
      // Radius aus PageRank [0,1] statt reinem Degree — zentrale Knoten werden groesser
      const baseRadius = 3 + 12 * node.pagerank;
      const radius = baseRadius / Math.max(1, zoom * 0.5);
      const alpha = highlighted ? 1 : 0.15;

      paintShape(ctx, shape, node.x, node.y, radius);

      if (isSelected) {
        ctx.shadowColor = HIGHLIGHT_COLOR;
        ctx.shadowBlur = 12 / zoom;
        ctx.fillStyle = HIGHLIGHT_COLOR;
      } else {
        ctx.shadowBlur = 0;
        ctx.fillStyle = highlighted ? colors.fill : `${colors.fill}26`;
      }
      ctx.globalAlpha = alpha;
      ctx.fill();

      ctx.strokeStyle = isSelected ? HIGHLIGHT_COLOR : colors.stroke;
      ctx.lineWidth = (isSelected ? 1 : 0.5) / Math.max(1, zoom * 0.5);
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;

      const fontSize = Math.max(2, 12 / zoom);
      const wantLabel = isSelected || (hoveredNode?.id === node.id) || (highlighted && radius * zoom > 6);
      if (wantLabel) {
        const fontSpec = `${isSelected ? 'bold ' : ''}${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.font = fontSpec;
        const textW = ctx.measureText(node.label).width;
        const labelY = node.y + radius + 3 / zoom;
        const pad = 1 / zoom;
        const rect = {
          x1: node.x - textW / 2 - pad,
          y1: labelY - pad,
          x2: node.x + textW / 2 + pad,
          y2: labelY + fontSize + pad,
        };

        // Überlappungs-Check (selected/hovered immer anzeigen)
        const forceShow = isSelected || hoveredNode?.id === node.id;
        const overlaps = !forceShow && labelRectsRef.current.some(
          (r) => rect.x1 < r.x2 && rect.x2 > r.x1 && rect.y1 < r.y2 && rect.y2 > r.y1,
        );

        if (!overlaps) {
          labelRectsRef.current.push(rect);

          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';

          // Halo in Hintergrundfarbe → max Kontrast gegen Text.
          ctx.globalAlpha = highlighted ? 1 : 0.5;
          ctx.strokeStyle = themeColors.bg;
          ctx.lineWidth = 4 / zoom;
          ctx.lineJoin = 'round';
          ctx.strokeText(node.label, node.x, labelY);

          // Text in Theme-Label-Farbe (Schwarz/Weiss je nach Mode) — Community
          // wird durch Knotenfarbe gezeigt, nicht durch Textfarbe. labelDim
          // bringt seine eigene Transparenz mit, daher globalAlpha=1.
          ctx.fillStyle = highlighted ? themeColors.label : themeColors.labelDim;
          ctx.globalAlpha = 1;
          ctx.fillText(node.label, node.x, labelY);
        }
      }
    },
    [activeGroups, hoveredNode, selectedNode, matchingNodeIds, neighborMap, themeColors, communityCategories]
  );

  const paintLink = useCallback(
    (link: InternalLink & { source: GraphNode & { x?: number; y?: number }; target: GraphNode & { x?: number; y?: number } }, ctx: CanvasRenderingContext2D) => {
      const s = link.source;
      const t = link.target;
      if (!s.x || !s.y || !t.x || !t.y) return;
      const sCat = getCommunityKey(s);
      const tCat = getCommunityKey(t);
      if (!activeGroups.has(sCat) || !activeGroups.has(tCat)) return;

      const isHovered = hoveredNode && (s.id === hoveredNode.id || t.id === hoveredNode.id);
      const isSearchMatch = matchingNodeIds && (matchingNodeIds.has(s.id) || matchingNodeIds.has(t.id));

      // Gewicht auf [0, 1] normieren — weight ist [0.3, 1.0]
      const weightNorm = Math.max(0, Math.min(1, (link.weight - 0.3) / 0.7));
      const baseWidth = 0.5 + 1.6 * weightNorm;

      const z = fgRef.current?.zoom?.() || 1;
      const zScale = Math.max(1, z * 0.5);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = isHovered ? themeColors.edgeHover : themeColors.edge;
      ctx.lineWidth = (isHovered ? baseWidth + 0.8 : baseWidth) / zScale;
      // Alpha: starke Kanten praegnanter, dimmen bei Hover/Suche wie gehabt
      const weightAlpha = 0.3 + 0.5 * weightNorm;
      ctx.globalAlpha = isHovered || isSearchMatch ? 0.85 : (matchingNodeIds || hoveredNode) ? 0.08 : weightAlpha;
      ctx.stroke();
      ctx.globalAlpha = 1;
    },
    [activeGroups, hoveredNode, matchingNodeIds, themeColors]
  );

  const filteredData = useMemo(() => {
    if (!graphData) return null;
    const visibleNodes = graphData.nodes.filter((n) => activeGroups.has(getCommunityKey(n)));
    const visibleIds = new Set(visibleNodes.map((n) => n.id));
    return {
      nodes: visibleNodes,
      links: graphData.links.filter(
        (l) => visibleIds.has(linkEndId(l.source)) && visibleIds.has(linkEndId(l.target)),
      ),
    };
  }, [graphData, activeGroups]);

  const stats = useMemo(() => {
    if (!graphData) return null;
    const groups: Record<string, number> = {};
    for (const n of graphData.nodes) {
      const cat = getCommunityKey(n);
      groups[cat] = (groups[cat] || 0) + 1;
    }
    return {
      totalNodes: graphData.nodes.length,
      totalEdges: graphData.links.length,
      groups,
    };
  }, [graphData]);

  const zoomToFit = useCallback(() => {
    if (fgRef.current) {
      fgRef.current.zoomToFit(400, 40);
    }
  }, []);

  // Erst nach warmupTicks + Render-Zeit zoomen, sonst steht die Simulation noch.
  const initialFitDone = useRef(false);
  useEffect(() => {
    if (!filteredData || filteredData.nodes.length === 0 || initialFitDone.current) return;
    const timer = setTimeout(() => {
      zoomToFit();
      initialFitDone.current = true;
    }, 800);
    return () => clearTimeout(timer);
  }, [filteredData, zoomToFit]);

  useEffect(() => {
    if (fgRef.current) {
      fgRef.current.d3Force('link')?.distance(linkDistance);
      fgRef.current.d3Force('charge')?.strength(-60);
      fgRef.current.d3ReheatSimulation();
    }
  }, [linkDistance]);

  useEffect(() => {
    if (!fgRef.current || !filteredData) return;
    const fg = fgRef.current;
    fg.d3Force('charge')?.strength(-25);
    // Gravitation: zieht Cluster zum Zentrum, verhindert Abdriften
    fg.d3Force('center')?.strength(0.1);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const d3Force3d = require('d3-force-3d');
      if (d3Force3d.forceRadial) {
        fg.d3Force('gravity', d3Force3d.forceRadial(120).strength(0.06));
      }
      if (d3Force3d.forceCollide) {
        fg.d3Force('collide',
          d3Force3d.forceCollide()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .radius((node: any) => {
              const nodeR = 3 + 12 * (node.pagerank ?? 0);
              const labelLen = (node.label?.length ?? 4) * 3;
              return Math.max(nodeR + 4, labelLen);
            })
            .iterations(4),
        );
      }
    } catch { /* Fallback: nur Charge-Abstoßung */ }
    fg.d3ReheatSimulation();
  }, [filteredData]);

  function getLabelForId(id: string): string {
    const node = graphData?.nodes.find((n) => n.id === id);
    return node ? node.label : id;
  }

  if (!activeProject) {
    return (
      <div className="page-empty">
        <p>Kein Projekt ausgewählt.</p>
      </div>
    );
  }

  return (
    <div className="graph-page">
      {error && (
        <div className="graph-error">
          <p>{error}</p>
          <button className="btn btn-secondary btn-sm" onClick={loadGraph}>Erneut laden</button>
        </div>
      )}

      <div className="graph-container-full" ref={containerRef}>
        {/* Dynamische Legende — gruppiert nach Häufigkeit, max 2 Spalten */}
        <div className="graph-legend">
          <div className="graph-legend-grid">
            {[...communityCategories.entries()]
              .filter(([key, val]) => val.hasName && (stats?.groups[key] || 0) > 0)
              .sort((a, b) => (stats?.groups[b[0]] || 0) - (stats?.groups[a[0]] || 0))
              .map(([key, val]) => {
                const count = stats?.groups[key] || 0;
                const active = activeGroups.has(key);
                return (
                  <button
                    key={key}
                    className={`graph-legend-item${active ? '' : ' inactive'}`}
                    onClick={() => toggleGroup(key)}
                  >
                    <span className="graph-legend-dot" style={{ backgroundColor: active ? val.fill : '#ccc' }} />
                    <span className="graph-legend-label">{val.label}</span>
                    <span className="graph-legend-count">{count}</span>
                  </button>
                );
              })}
          </div>
        </div>

        {/* Suchfeld */}
        <div className="graph-search">
          <input
            type="text"
            placeholder="Knoten suchen..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="graph-search-clear" onClick={() => setSearch('')}>
              &times;
            </button>
          )}
        </div>

        {/* Graph Canvas */}
        {filteredData && filteredData.nodes.length > 0 ? (
          <ForceGraph2D
            ref={fgRef}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            graphData={filteredData as any}
            width={dimensions.width}
            height={dimensions.height}
            backgroundColor={themeColors.bg}
            nodeId="id"
            nodeCanvasObject={paintNode}
            nodePointerAreaPaint={(node: GraphNode & { x?: number; y?: number }, color, ctx) => {
              if (!node.x || !node.y) return;
              const z = fgRef.current?.zoom?.() || 1;
              const baseR = 3 + 12 * node.pagerank;
              const radius = baseR / Math.max(1, z * 0.5);
              ctx.beginPath();
              ctx.arc(node.x, node.y, radius + 2, 0, 2 * Math.PI);
              ctx.fillStyle = color;
              ctx.fill();
            }}
            linkCanvasObject={paintLink}
            onNodeClick={handleNodeClick}
            onNodeHover={(node: GraphNode | null) => setHoveredNode(node)}
            onBackgroundClick={() => { setSelectedNode(null); setHoveredNode(null); }}
            warmupTicks={50}
            cooldownTicks={150}
            d3AlphaDecay={0.02}
            d3VelocityDecay={0.3}
            enableZoomInteraction={true}
            enablePanInteraction={true}
            enableNodeDrag={true}
          />
        ) : !loading ? (
          <div className="graph-empty">
            <p>Noch keine Wiki-Seiten vorhanden.</p>
            <p style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>
              Lade Rohdaten hoch und starte einen Ingest, um den Knowledge Graph aufzubauen.
            </p>
          </div>
        ) : null}

        {/* Detail-Panel */}
        {selectedNode && (
          <div className="graph-detail-panel">
            <div className="graph-detail-header">
              <h3>{selectedNode.label}</h3>
              <button className="graph-detail-close" onClick={() => setSelectedNode(null)}>
                &times;
              </button>
            </div>
            <div className="graph-detail-meta">
              <span
                className="graph-detail-badge"
                style={{ backgroundColor: communityCategories.get(getCommunityKey(selectedNode))?.fill }}
              >
                {communityCategories.get(getCommunityKey(selectedNode))?.label}
              </span>
              <span className="graph-detail-tag">{DIR_SHAPES[selectedNode.group]?.label || selectedNode.group}</span>
              {selectedNode.tags && selectedNode.tags.length > 0 && selectedNode.tags.slice(0, 4).map((tag) => (
                <span key={tag} className="graph-detail-tag">{tag}</span>
              ))}
              <span className="graph-detail-degree">{selectedNode.degree} Verbindungen</span>
            </div>
            <div className="graph-detail-path">{selectedNode.id}</div>

            {([
              ['Verlinkt auf', selectedNodeLinks.outgoing],
              ['Verlinkt von', selectedNodeLinks.incoming],
            ] as const).map(([title, ids]) => ids.length > 0 && (
              <div key={title} className="graph-detail-links">
                <h4>{title} ({ids.length})</h4>
                <ul>
                  {ids.map((id) => (
                    <li key={id} onClick={() => {
                      const node = graphData?.nodes.find((n) => n.id === id) as (GraphNode & { x?: number; y?: number }) | undefined;
                      if (node) handleNodeClick(node);
                    }}>
                      {getLabelForId(id)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {/* Toolbar: Zoom-to-Fit, Stats, Abstand, Refresh */}
        <div className="graph-toolbar">
          <button
            className="graph-toolbar-btn"
            onClick={zoomToFit}
            title="Alles zeigen"
          >
            {'\u2922'}
          </button>
          <div className="graph-toolbar-slider">
            <label title="Abstand zwischen verbundenen Knoten">
              <span>Abstand</span>
              <input
                type="range"
                min="5"
                max="200"
                step="5"
                value={linkDistance}
                onChange={(e) => setLinkDistance(Number(e.target.value))}
              />
            </label>
          </div>
          <button
            className="graph-toolbar-btn"
            onClick={loadGraph}
            disabled={loading}
            title="Graph aktualisieren"
          >
            {'\u21BB'}
          </button>
          {stats && (
            <span className="graph-toolbar-stats">
              {stats.totalNodes} Knoten &middot; {stats.totalEdges} Kanten
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
