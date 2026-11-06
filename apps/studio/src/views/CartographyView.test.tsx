import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderWithStudio } from '@/test/render';
import { CartographyView } from '@/views/CartographyView';
import { computeLayout } from '@/views/cartography/layout.worker';
import { drawGraph, type GraphScene } from '@/views/cartography/renderer';
import { FakeTransport } from '@/test/fake-transport';
import {
  createRecordingContext,
  type FakeWorkerRecord,
  graph,
  type GraphNodePayload,
  graphNode,
  installLayoutStub,
  type RecordedOp,
  scriptStudio,
  stubCanvas,
  stubWorker,
} from '@/test/fixtures';

let restoreLayout: () => void = () => undefined;
let workers: FakeWorkerRecord[] = [];
beforeEach(() => {
  restoreLayout = installLayoutStub();
  stubCanvas();
  workers = stubWorker();
});
afterEach(() => {
  vi.unstubAllGlobals();
  restoreLayout();
});

async function readyCartography(): Promise<HTMLElement> {
  return waitFor(() => {
    const root = document.querySelector<HTMLElement>('[data-view="cartography"][data-state="ready"]');
    if (!root) throw new Error('cartography never became ready');
    return root;
  });
}

/** Signature of the draw calls a single node at (300, 300) produces. */
function nodeOps(node: GraphNodePayload): RecordedOp[] {
  const recording = createRecordingContext();
  const scene: GraphScene = { nodes: [{ ...node, x: 300, y: 300 }], edges: [] };
  drawGraph(recording.ctx, scene, { x: 0, y: 0, zoom: 1, width: 1200, height: 800 });
  return recording.ops.filter(op =>
    [
      'arc',
      'rect',
      'fillRect',
      'strokeRect',
      'lineTo',
      'moveTo',
      'fill',
      'stroke',
      'fillText',
      'ellipse',
      'roundRect',
    ].includes(op.op),
  );
}

const signature = (ops: RecordedOp[]) =>
  JSON.stringify(ops.map(op => [op.op, String(op.fillStyle), String(op.strokeStyle), op.lineDash]));

describe('VC cartography view', () => {
  test('VC-06 contract barriers and barrels appear in the legend and on the node', async () => {
    const fake = scriptStudio(new FakeTransport());
    renderWithStudio(<CartographyView />, { transport: fake });
    const root = await readyCartography();
    const legend = within(root).getByRole('list', { name: 'Leyenda' });
    expect(within(legend).getByText('Barrera de contrato')).toBeInTheDocument();
    expect(within(legend).getByText('Barrel')).toBeInTheDocument();

    const plain = nodeOps(graphNode({ id: 0, path: 'src/plain.ts' }));
    const contract = nodeOps(graphNode({ id: 0, path: 'src/core.ts', contractLevel: 1 }));
    const barrel = nodeOps(graphNode({ id: 0, path: 'src/index.ts', isBarrel: true }));
    expect(contract.length).toBeGreaterThan(plain.length);
    expect(barrel.length).toBeGreaterThan(plain.length);
    expect(signature(contract)).not.toBe(signature(barrel));
  });

  test('VC-07 the layout runs in a Web Worker with a fixed seed and is deterministic', async () => {
    const input = {
      nodes: graph().nodes.map(node => ({ id: node.id })),
      edges: graph().edges.map(edge => ({ s: edge.s, t: edge.t })),
      seed: 42,
    };
    type Position = { id: number; x: number; y: number };
    const first: Position[] = computeLayout(input);
    const second: Position[] = computeLayout(input);
    expect(second).toEqual(first);
    expect(first).toHaveLength(input.nodes.length);
    for (const position of first) {
      expect(Number.isFinite(position.x) && Number.isFinite(position.y)).toBe(true);
    }
    expect(new Set(first.map(position => `${position.x.toFixed(3)},${position.y.toFixed(3)}`)).size).toBe(
      input.nodes.length,
    );

    const fake = scriptStudio(new FakeTransport());
    renderWithStudio(<CartographyView />, { transport: fake });
    await readyCartography();
    await waitFor(() => expect(workers.length).toBeGreaterThan(0));
    const worker = workers[0];
    if (!worker) throw new Error('no layout worker was constructed');
    expect(worker.url).toMatch(/layout\.worker/);
    expect(worker.options).toMatchObject({ type: 'module' });
    await waitFor(() =>
      expect(
        worker.messages.some(
          message =>
            typeof message === 'object' && message !== null && typeof (message as { seed?: unknown }).seed === 'number',
        ),
      ).toBe(true),
    );
  });

  test('VC-08 selecting a node requests blastRadius.heat and paints its lineage by distance', async () => {
    const fake = scriptStudio(new FakeTransport());
    const user = userEvent.setup();
    renderWithStudio(<CartographyView />, { transport: fake });
    const root = await readyCartography();

    const modules = within(root).getByRole('listbox', { name: 'Módulos' });
    await user.click(within(modules).getByRole('option', { name: 'src/core.ts' }));
    expect(fake.lastCall('blastRadius.heat')).toMatchObject({ target: 'src/core.ts' });

    const lineage = await screen.findByRole('list', { name: 'Linaje' });
    const items = await waitFor(() => {
      const entries = within(lineage).getAllByRole('listitem');
      if (entries.length !== 3) throw new Error(`expected 3 lineage entries, got ${entries.length}`);
      return entries;
    });
    expect(items.map(item => item.dataset.distance)).toEqual(['1', '2', '3']);
    expect(items.map(item => item.textContent)).toEqual([
      expect.stringContaining('src/a.ts'),
      expect.stringContaining('src/index.ts'),
      expect.stringContaining('src/app.ts'),
    ]);
    expect(within(modules).getByRole('option', { name: 'src/core.ts' })).toHaveAttribute('aria-selected', 'true');
  });
});
