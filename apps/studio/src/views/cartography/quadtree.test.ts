import { describe, expect, test } from 'vitest';
import { buildQuadtree, pick } from '@/views/cartography/quadtree';

describe('VC quadtree picking', () => {
  test('VC-03 picks the node under the pointer, also when zoomed and panned', () => {
    const tree = buildQuadtree([
      { id: 1, x: 100, y: 100, r: 5 },
      { id: 2, x: 130, y: 100, r: 5 },
    ]);
    const identity = { x: 0, y: 0, zoom: 1, width: 1200, height: 800 };
    expect(pick(tree, { x: 102, y: 101 }, identity)).toBe(1);
    expect(pick(tree, { x: 128, y: 100 }, identity)).toBe(2);
    expect(pick(tree, { x: 115, y: 100 }, identity)).toBeNull();

    // zoom 2 around origin (50, 50): screen = (world - 50) * 2 → node 1 at (100, 100), node 2 at (160, 100).
    const zoomed = { x: 50, y: 50, zoom: 2, width: 1200, height: 800 };
    expect(pick(tree, { x: 108, y: 100 }, zoomed)).toBe(1);
    expect(pick(tree, { x: 160, y: 104 }, zoomed)).toBe(2);
    expect(pick(tree, { x: 125, y: 100 }, zoomed)).toBeNull();

    // A dense grid: every centre picks its own node.
    const grid = Array.from({ length: 1_000 }, (_, index) => ({
      id: index,
      x: (index % 40) * 20,
      y: Math.floor(index / 40) * 20,
      r: 4,
    }));
    const dense = buildQuadtree(grid);
    for (const node of [grid[0], grid[41], grid[999], grid[517]]) {
      if (!node) throw new Error('fixture node missing');
      expect(pick(dense, { x: node.x, y: node.y }, identity)).toBe(node.id);
    }
    expect(pick(dense, { x: 10, y: 10 }, identity)).toBeNull();
  });
});
