/**
 * VC renderer — Canvas 2D drawing contract (`drawGraph(ctx, scene, viewport)`):
 * - draws directly on the given context (no Path2D), one `arc` per visible node and one straight
 *   segment (`lineTo`) per visible edge, no arrowheads;
 * - viewport maps world → screen as `(world - {x, y}) * zoom` over a `width × height` screen.
 */
import { describe, expect, test } from 'vitest';
import { drawGraph, type GraphScene } from '@/views/cartography/renderer';
import { createRecordingContext, type EdgeType, graphNode, type Point, type RecordedStroke } from '@/test/fixtures';

const VIEWPORT = { x: 0, y: 0, zoom: 1, width: 1200, height: 800 };

function scene(points: Array<[number, number]>, edges: Array<[number, number, EdgeType]>): GraphScene {
  return {
    nodes: points.map(([x, y], id) => ({ ...graphNode({ id, path: `src/m${id}.ts` }), x, y })),
    edges: edges.map(([s, t, type]) => ({ s, t, type })),
  };
}

const near = (a: Point, b: Point, tolerance: number) => Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;

/** The stroke that drew the segment from `from` to `to` (endpoints may be trimmed to the node radius). */
function strokeOf(strokes: RecordedStroke[], from: Point, to: Point): RecordedStroke {
  const found = strokes.find(stroke =>
    stroke.segments.some(
      segment =>
        (near(segment.from, from, 25) && near(segment.to, to, 25)) ||
        (near(segment.from, to, 25) && near(segment.to, from, 25)),
    ),
  );
  if (!found) throw new Error(`no stroked segment between (${from.x},${from.y}) and (${to.x},${to.y})`);
  return found;
}

describe('VC canvas renderer', () => {
  test('VC-01 draws N nodes and M edges with an exact call count', () => {
    const recording = createRecordingContext();
    const graph = scene(
      [
        [100, 100],
        [400, 100],
        [700, 100],
        [100, 500],
        [400, 500],
      ],
      [
        [0, 1, 'value'],
        [1, 2, 'value'],
        [3, 4, 'type_only'],
        [0, 3, 'synthetic'],
      ],
    );
    drawGraph(recording.ctx, graph, VIEWPORT);
    expect(recording.count('arc')).toBe(5);
    expect(recording.count('lineTo')).toBe(4);

    recording.reset();
    drawGraph(recording.ctx, scene([[100, 100]], []), VIEWPORT);
    expect(recording.count('arc')).toBe(1);
    expect(recording.count('lineTo')).toBe(0);
  });

  test('VC-02 viewport culling draws only what is visible', () => {
    const recording = createRecordingContext();
    const graph = scene(
      [
        [10, 10],
        [50, 50],
        [5_000, 5_000],
        [6_000, 6_000],
      ],
      [
        [0, 1, 'value'],
        [2, 3, 'value'],
        [1, 2, 'value'],
      ],
    );
    const small = { x: 0, y: 0, zoom: 1, width: 100, height: 100 };
    drawGraph(recording.ctx, graph, small);
    expect(recording.count('arc')).toBe(2);
    // 0–1 is visible, 1–2 enters the viewport, 2–3 lies entirely outside it.
    expect(recording.count('lineTo')).toBe(2);

    recording.reset();
    drawGraph(recording.ctx, graph, { ...small, zoom: 0.01 });
    expect(recording.count('arc')).toBe(4);
    expect(recording.count('lineTo')).toBe(3);

    recording.reset();
    drawGraph(recording.ctx, graph, { ...small, x: 4_990, y: 4_990 });
    expect(recording.count('arc')).toBe(1);
  });

  test('VC-05 value edges are solid, type_only dashed and synthetic dotted', () => {
    const recording = createRecordingContext();
    const graph = scene(
      [
        [100, 100],
        [500, 100],
        [100, 500],
        [500, 500],
      ],
      [
        [0, 1, 'value'],
        [0, 2, 'type_only'],
        [1, 3, 'synthetic'],
      ],
    );
    drawGraph(recording.ctx, graph, VIEWPORT);
    const value = strokeOf(recording.strokes, { x: 100, y: 100 }, { x: 500, y: 100 });
    const typeOnly = strokeOf(recording.strokes, { x: 100, y: 100 }, { x: 100, y: 500 });
    const synthetic = strokeOf(recording.strokes, { x: 500, y: 100 }, { x: 500, y: 500 });

    expect(value.lineDash).toEqual([]);
    expect(typeOnly.lineDash.length).toBeGreaterThanOrEqual(2);
    expect(typeOnly.lineDash[0]).toBeGreaterThanOrEqual(4);
    expect(synthetic.lineDash.length).toBeGreaterThanOrEqual(2);
    expect(synthetic.lineDash[0]).toBeLessThanOrEqual(2);
    expect(synthetic.lineDash).not.toEqual(typeOnly.lineDash);
  });
});
