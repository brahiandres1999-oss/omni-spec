/**
 * Point quadtree for pointer picking on the module graph (VC-03). Pure: build once per layout, query per
 * pointer move. Points carry a hit radius in world units.
 */
export interface PickPoint {
  id: number;
  x: number;
  y: number;
  r: number;
}

export interface Viewport {
  /** World coordinate shown at the screen origin. */
  x: number;
  y: number;
  zoom: number;
  width: number;
  height: number;
}

interface Node {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  points: PickPoint[];
  children: Node[] | null;
}

export interface Quadtree {
  root: Node | null;
  maxRadius: number;
}

const CAPACITY = 8;
const MAX_DEPTH = 12;

function insert(node: Node, point: PickPoint, depth: number): void {
  if (node.children) {
    const child = node.children.find(
      candidate =>
        point.x >= candidate.x0 && point.x <= candidate.x1 && point.y >= candidate.y0 && point.y <= candidate.y1,
    );
    if (child) {
      insert(child, point, depth + 1);
      return;
    }
  }
  node.points.push(point);
  if (!node.children && node.points.length > CAPACITY && depth < MAX_DEPTH) {
    const mx = (node.x0 + node.x1) / 2;
    const my = (node.y0 + node.y1) / 2;
    const make = (x0: number, y0: number, x1: number, y1: number): Node => ({
      x0,
      y0,
      x1,
      y1,
      points: [],
      children: null,
    });
    node.children = [
      make(node.x0, node.y0, mx, my),
      make(mx, node.y0, node.x1, my),
      make(node.x0, my, mx, node.y1),
      make(mx, my, node.x1, node.y1),
    ];
    const points = node.points;
    node.points = [];
    for (const entry of points) insert(node, entry, depth);
  }
}

export function buildQuadtree(points: readonly PickPoint[]): Quadtree {
  if (points.length === 0) return { root: null, maxRadius: 0 };
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  let maxRadius = 0;
  for (const point of points) {
    x0 = Math.min(x0, point.x);
    y0 = Math.min(y0, point.y);
    x1 = Math.max(x1, point.x);
    y1 = Math.max(y1, point.y);
    maxRadius = Math.max(maxRadius, point.r);
  }
  const size = Math.max(x1 - x0, y1 - y0, 1);
  const root: Node = { x0, y0, x1: x0 + size, y1: y0 + size, points: [], children: null };
  for (const point of points) insert(root, point, 0);
  return { root, maxRadius };
}

/** Screen → world: the inverse of `screen = (world - viewport.{x,y}) * zoom`. */
export function toWorld(screen: { x: number; y: number }, viewport: Viewport): { x: number; y: number } {
  return { x: screen.x / viewport.zoom + viewport.x, y: screen.y / viewport.zoom + viewport.y };
}

/** Minimum hit radius in screen pixels, so tiny nodes stay clickable when zoomed out. */
const MIN_SCREEN_HIT = 3;

/** Id of the node under the pointer (closest centre within its radius), or `null`. */
export function pick(tree: Quadtree, screen: { x: number; y: number }, viewport: Viewport): number | null {
  if (!tree.root) return null;
  const world = toWorld(screen, viewport);
  const reach = Math.max(tree.maxRadius, MIN_SCREEN_HIT / viewport.zoom);
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const visit = (node: Node) => {
    if (
      world.x < node.x0 - reach ||
      world.x > node.x1 + reach ||
      world.y < node.y0 - reach ||
      world.y > node.y1 + reach
    )
      return;
    for (const point of node.points) {
      const distance = Math.hypot(point.x - world.x, point.y - world.y);
      const radius = Math.max(point.r, MIN_SCREEN_HIT / viewport.zoom);
      if (distance <= radius && distance < bestDistance) {
        best = point.id;
        bestDistance = distance;
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree.root);
  return best;
}
