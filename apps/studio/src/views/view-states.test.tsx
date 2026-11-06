/**
 * FS — the 4-state contract (blueprint §4.7.3, plan §11.3): 5 views × 4 states = 20 tests.
 *
 * Contract used by every view: its root element carries `data-view="<name>"` and
 * `data-state="loading|ready|empty|error|protected"`; the root keeps the same `data-layout` and layout
 * classes in every state, and rows declare their height token in `data-row-height`.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderWithStudio } from '@/test/render';
import { BoardView } from '@/views/BoardView';
import { CartographyView } from '@/views/CartographyView';
import { DiffView } from '@/views/DiffView';
import { FinopsView } from '@/views/FinopsView';
import { SkillsView } from '@/views/SkillsView';
import { FakeTransport } from '@/test/fake-transport';
import {
  board,
  defaultBoard,
  diff,
  EMPTY_CTAS,
  emptyFinops,
  emptyGraph,
  finops,
  GATE2_TEXT,
  gateLocked,
  graph,
  installLayoutStub,
  RETRY_LABEL,
  rpcError,
  scriptStudio,
  skills,
  stubCanvas,
  stubWorker,
} from '@/test/fixtures';

type ViewName = keyof typeof EMPTY_CTAS;
type ViewState = 'loading' | 'empty' | 'error' | 'protected';

interface ViewCase {
  name: ViewName;
  method: string;
  element: () => ReactElement;
  ready: () => unknown;
  empty: () => unknown;
}

const VIEWS: ViewCase[] = [
  {
    name: 'board',
    method: 'board.get',
    element: () => <BoardView />,
    ready: () => defaultBoard('standard'),
    empty: () => board('standard', []),
  },
  {
    name: 'cartography',
    method: 'cartography.graph',
    element: () => <CartographyView />,
    ready: graph,
    empty: emptyGraph,
  },
  {
    name: 'diff',
    method: 'diff.get',
    element: () => <DiffView spec="001" />,
    ready: () => diff(),
    empty: () => diff([]),
  },
  {
    name: 'finops',
    method: 'finops.snapshot',
    element: () => <FinopsView />,
    ready: () => finops(),
    empty: emptyFinops,
  },
  {
    name: 'skills',
    method: 'skills.list',
    element: () => <SkillsView />,
    ready: () => skills(),
    empty: () => skills([]),
  },
];

const STATES: ViewState[] = ['loading', 'empty', 'error', 'protected'];

let restoreLayout: () => void = () => undefined;
beforeEach(() => {
  restoreLayout = installLayoutStub();
  stubCanvas();
  stubWorker();
});
afterEach(() => {
  vi.unstubAllGlobals();
  restoreLayout();
});

function viewRoot(name: ViewName, state: string): Promise<HTMLElement> {
  return waitFor(() => {
    const element = document.querySelector<HTMLElement>(`[data-view="${name}"][data-state="${state}"]`);
    if (!element) throw new Error(`[data-view="${name}"] never reached data-state="${state}"`);
    return element;
  });
}

const LAYOUT_CLASS =
  /^(grid|grid-cols-|grid-rows-|auto-rows-|auto-cols-|gap-|flex$|flex-col$|flex-row$|h-|min-h-|max-h-|w-|min-w-|max-w-|p-|px-|py-|pt-|pb-|ps-|pe-)/;

function layoutSignature(root: HTMLElement) {
  return {
    layout: root.dataset.layout ?? '',
    classes: [...root.classList].filter(name => LAYOUT_CLASS.test(name)).sort(),
    rowHeights: [
      ...new Set([...root.querySelectorAll<HTMLElement>('[data-row-height]')].map(row => row.dataset.rowHeight ?? '')),
    ].sort(),
  };
}

/** Visible text of the root with the technical <details> removed. */
function textOutsideDetails(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  for (const details of clone.querySelectorAll('details')) details.remove();
  return clone.textContent ?? '';
}

async function assertLoading(view: ViewCase) {
  const fake = scriptStudio(new FakeTransport());
  const slot = fake.defer(view.method);
  renderWithStudio(view.element(), { transport: fake });

  const skeleton = await viewRoot(view.name, 'loading');
  expect(skeleton).toHaveAttribute('aria-busy', 'true');
  const before = layoutSignature(skeleton);

  slot.resolve(view.ready());
  const ready = await viewRoot(view.name, 'ready');
  expect(ready.getAttribute('aria-busy')).not.toBe('true');
  const after = layoutSignature(ready);

  expect(before.layout, 'skeleton declares its layout template').not.toBe('');
  expect(after.layout).toBe(before.layout);
  expect(after.classes).toEqual(before.classes);
  expect(before.rowHeights.length, 'skeleton rows declare a height token').toBeGreaterThan(0);
  for (const height of before.rowHeights) expect(after.rowHeights).toContain(height);
}

async function assertEmpty(view: ViewCase) {
  const fake = scriptStudio(new FakeTransport()).respond(view.method, view.empty());
  const onAction = vi.fn();
  const user = userEvent.setup();
  renderWithStudio(view.element(), { transport: fake, onAction });

  const root = await viewRoot(view.name, 'empty');
  for (const cta of EMPTY_CTAS[view.name]) {
    await user.click(within(root).getByRole('button', { name: cta.label }));
    expect(onAction).toHaveBeenLastCalledWith(expect.objectContaining(cta.action));
  }
  expect(onAction).toHaveBeenCalledTimes(EMPTY_CTAS[view.name].length);
}

async function assertError(view: ViewCase) {
  const detail = `${view.method} timed out after 10000 ms`;
  const fake = scriptStudio(new FakeTransport()).failOnce(view.method, rpcError('ENGINE_TIMEOUT', detail, true));
  fake.respond(view.method, view.ready());
  const user = userEvent.setup();
  renderWithStudio(view.element(), { transport: fake });

  const root = await viewRoot(view.name, 'error');
  const alert = within(root).getByRole('alert');
  const visible = textOutsideDetails(alert).trim();
  expect(visible.length).toBeGreaterThan(0);
  expect(visible, 'no opaque error code outside <details>').not.toMatch(/\b[A-Z]{2,}(?:_[A-Z]+)+\b/);
  const details = root.querySelector('details');
  if (!details) throw new Error('the Error state must expose a <details> with the technical detail');
  expect(details.textContent).toContain('ENGINE_TIMEOUT');
  expect(details.textContent).toContain(detail);

  const attempts = fake.calls(view.method).length;
  await user.click(within(root).getByRole('button', { name: RETRY_LABEL }));
  await viewRoot(view.name, 'ready');
  expect(fake.calls(view.method)).toHaveLength(attempts + 1);
}

async function assertProtected(view: ViewCase) {
  const reason = 'Quedan 2 hunks sin decidir y la verificación no está atestada';
  const fake = scriptStudio(new FakeTransport()).fail(view.method, gateLocked(reason));
  renderWithStudio(view.element(), { transport: fake });

  const root = await viewRoot(view.name, 'protected');
  expect(within(root).getByText(GATE2_TEXT)).toBeInTheDocument();
  expect(within(root).getByText(reason, { exact: false })).toBeInTheDocument();
  expect(within(root).queryAllByRole('button', { name: /aprobar|autorizar/i })).toHaveLength(0);
  expect(screen.queryAllByRole('button', { name: /aprobar|autorizar/i })).toHaveLength(0);
}

const ASSERT: Record<ViewState, (view: ViewCase) => Promise<void>> = {
  loading: assertLoading,
  empty: assertEmpty,
  error: assertError,
  protected: assertProtected,
};

describe('FS four-state contract', () => {
  for (const view of VIEWS) {
    for (const state of STATES) {
      test(`FS ${view.name} ${state}`, () => ASSERT[state](view));
    }
  }
});
