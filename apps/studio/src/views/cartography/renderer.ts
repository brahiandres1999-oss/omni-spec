/**
 * Canvas 2D renderer of the module graph (VC-01, VC-02, VC-05, VC-06).
 *
 * Contract: draws directly on the given context, one `arc` per visible node and one straight `lineTo` per
 * visible edge (no arrowheads, no Path2D). World → screen is `(world - viewport.{x,y}) * zoom`; the caller may
 * set a device-pixel-ratio transform beforehand. Edges are batched by style: `value` solid, `type_only`
 * dashed, `synthetic` dotted. Contract barriers get a square frame and barrels a centre mark, so both read
 * on the node and in the legend.
 */
import { canvasInk, colors } from '@/design/tokens';
import type { EdgeType, GraphNode } from '@/ipc/types';
import { heatColor } from './heat-scale';
import type { Viewport } from './quadtree';

export interface SceneNode extends GraphNode {
  x: number;
  y: number;
  /** 0…1 heat (centrality or Blast Radius); undefined draws the neutral fill. */
  heat?: number;
  selected?: boolean;
  /** Part of the selected node's lineage. */
  lineage?: boolean;
}

export interface SceneEdge {
  s: number;
  t: number;
  type: EdgeType;
}

export interface GraphScene {
  nodes: SceneNode[];
  edges: SceneEdge[];
}

export const NODE_RADIUS = 6;

export const EDGE_DASH: Readonly<Record<EdgeType, number[]>> = {
  value: [],
  type_only: [6, 4],
  synthetic: [1.5, 3],
};

/** Radius in world units: a little larger for hubs, constant otherwise. */
export function nodeRadius(node: Pick<GraphNode, 'dIn'>): number {
  return NODE_RADIUS + Math.min(6, Math.sqrt(node.dIn));
}

const toScreen = (x: number, y: number, viewport: Viewport) => ({
  x: (x - viewport.x) * viewport.zoom,
  y: (y - viewport.y) * viewport.zoom,
});

/** Liang–Barsky: does the segment touch the [0,w]×[0,h] screen rectangle? */
function segmentVisible(ax: number, ay: number, bx: number, by: number, w: number, h: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return clip(-dx, ax) && clip(dx, w - ax) && clip(-dy, ay) && clip(dy, h - ay);
}

export function drawGraph(ctx: CanvasRenderingContext2D, scene: GraphScene, viewport: Viewport): void {
  const { width, height, zoom } = viewport;
  const byId = new Map<number, SceneNode>();
  for (const node of scene.nodes) byId.set(node.id, node);

  ctx.save();
  ctx.lineCap = 'round';

  // Edges, one stroke per style.
  for (const type of ['value', 'type_only', 'synthetic'] as const) {
    for (const lineage of [false, true]) {
      let open = false;
      for (const edge of scene.edges) {
        if (edge.type !== type) continue;
        const source = byId.get(edge.s);
        const target = byId.get(edge.t);
        if (!source || !target) continue;
        const inLineage = Boolean(source.lineage || source.selected) && Boolean(target.lineage || target.selected);
        if (inLineage !== lineage) continue;
        const a = toScreen(source.x, source.y, viewport);
        const b = toScreen(target.x, target.y, viewport);
        if (!segmentVisible(a.x, a.y, b.x, b.y, width, height)) continue;
        if (!open) {
          ctx.beginPath();
          ctx.setLineDash(EDGE_DASH[type]);
          ctx.strokeStyle = lineage ? canvasInk.edgeLineage : canvasInk.edge;
          ctx.lineWidth = lineage ? 1.75 : 1;
          open = true;
        }
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      if (open) ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  // Nodes.
  for (const node of scene.nodes) {
    const centre = toScreen(node.x, node.y, viewport);
    const radius = Math.max(1.5, nodeRadius(node) * zoom);
    if (centre.x < -radius || centre.y < -radius || centre.x > width + radius || centre.y > height + radius) continue;

    ctx.beginPath();
    ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = node.heat === undefined ? colors.fgMuted : heatColor(node.heat);
    ctx.fill();
    ctx.lineWidth = node.selected ? 2 : 1;
    ctx.strokeStyle = node.selected ? colors.accentBright : canvasInk.nodeOutline;
    ctx.stroke();

    if (node.contractLevel > 0) {
      // Contract barrier: square frame around the node.
      const side = radius * 2 + 6;
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = colors.fg;
      ctx.strokeRect(centre.x - side / 2, centre.y - side / 2, side, side);
    }
    if (node.isBarrel) {
      // Barrel: filled centre mark.
      const mark = Math.max(2, radius * 0.6);
      ctx.fillStyle = colors.canvas;
      ctx.fillRect(centre.x - mark / 2, centre.y - mark / 2, mark, mark);
    }
  }

  ctx.restore();
}
