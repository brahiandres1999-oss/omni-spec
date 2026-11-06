/**
 * Force layout of the module graph, run in a Web Worker (VC-07). Deterministic: d3-force with a seeded
 * random source and a fixed number of ticks, so the same input always yields the same positions.
 *
 * `computeLayout` is exported for tests; the worker entry answers `{ nodes, edges, seed }` messages with
 * `{ seed, positions }`.
 */
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
} from 'd3-force';

export interface LayoutInput {
  nodes: Array<{ id: number }>;
  edges: Array<{ s: number; t: number }>;
  seed: number;
}

export interface LayoutPosition {
  id: number;
  x: number;
  y: number;
}

/** Mulberry32: a tiny seeded PRNG in [0, 1). */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface LayoutNode extends SimulationNodeDatum {
  id: number;
}

export function computeLayout(input: LayoutInput): LayoutPosition[] {
  const nodes: LayoutNode[] = input.nodes.map(node => ({ id: node.id }));
  const known = new Set(nodes.map(node => node.id));
  const links = input.edges
    .filter(edge => known.has(edge.s) && known.has(edge.t) && edge.s !== edge.t)
    .map(edge => ({ source: edge.s, target: edge.t }));
  const ticks = Math.min(300, Math.max(60, Math.ceil(30_000 / Math.max(1, nodes.length))));

  const simulation = forceSimulation(nodes)
    .randomSource(seeded(input.seed))
    .force(
      'link',
      forceLink<LayoutNode, { source: number; target: number }>(links)
        .id(node => node.id)
        .distance(60),
    )
    .force('charge', forceManyBody<LayoutNode>().strength(-180).distanceMax(600))
    .force('collide', forceCollide<LayoutNode>(14))
    .force('center', forceCenter(0, 0))
    .stop();
  simulation.tick(ticks);

  return nodes.map(node => ({ id: node.id, x: node.x ?? 0, y: node.y ?? 0 }));
}

// Worker entry: only when running as a dedicated worker (never in the window or in tests).
const scope = globalThis as unknown as {
  window?: unknown;
  postMessage?: (message: unknown) => void;
  onmessage?: ((event: MessageEvent<LayoutInput>) => void) | null;
};
if (scope.window === undefined && 'WorkerGlobalScope' in globalThis) {
  scope.onmessage = event => {
    const positions = computeLayout(event.data);
    scope.postMessage?.({ seed: event.data.seed, positions });
  };
}
