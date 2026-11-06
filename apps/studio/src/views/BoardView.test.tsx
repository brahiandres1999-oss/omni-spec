import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { renderWithStudio } from '@/test/render';
import { BoardView } from '@/views/BoardView';
import { FakeTransport, type InvokeArgs } from '@/test/fake-transport';
import {
  BOARD_LANES,
  board,
  card,
  type CardPayload,
  defaultBoard,
  defaultCards,
  gateLocked,
  installLayoutStub,
  LANE_TITLES,
  scriptStudio,
} from '@/test/fixtures';

let restoreLayout: () => void = () => undefined;
beforeEach(() => {
  restoreLayout = installLayoutStub();
});
afterEach(() => restoreLayout());

async function readyBoard(): Promise<HTMLElement> {
  return waitFor(() => {
    const root = document.querySelector<HTMLElement>('[data-view="board"][data-state="ready"]');
    if (!root) throw new Error('board never became ready');
    return root;
  });
}

function cardElement(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-card-id="${id}"]`);
  if (!element) throw new Error(`card ${id} is not rendered`);
  return element;
}

/** Element whose own text is exactly `text`, inside `scope`. */
function exactText(scope: HTMLElement, text: string): HTMLElement {
  return within(scope).getByText((_content, element) => element?.textContent === text && element.children.length === 0);
}

describe('VB board view', () => {
  test('VB-01 each route renders its lanes: light 3, standard 4, full 6', async () => {
    for (const route of ['light', 'standard', 'full'] as const) {
      const fake = scriptStudio(new FakeTransport());
      const view = renderWithStudio(<BoardView route={route} />, { transport: fake });
      const root = await readyBoard();
      expect(fake.lastCall('board.get')).toMatchObject({ route });
      const lanes = within(root).getAllByRole('region');
      expect(lanes.map(lane => lane.getAttribute('aria-label'))).toEqual(BOARD_LANES[route].map(id => LANE_TITLES[id]));
      view.unmount();
    }
  });

  test('VB-02 a card shows the PJ-BRD-07 fields with numbers in tabular mono', async () => {
    const fake = scriptStudio(new FakeTransport()).respond(
      'board.get',
      board('full', [
        card({
          id: '007',
          slug: '007-login-flow',
          title: 'Login Flow',
          route: 'full',
          lane: 'implementation',
          tags: ['ui', 'auth'],
          risk: 'high',
          owner: 'ana',
          tasks: { done: 1, total: 3 },
          gates: { required: true, 1: 'approved', 2: 'missing' },
          attestation: 'valid',
        }),
      ]),
    );
    renderWithStudio(<BoardView route="full" />, { transport: fake });
    await readyBoard();
    const element = cardElement('007');
    for (const text of ['007', 'Login Flow', 'full', 'ui', 'auth', 'ana', '1/3'])
      expect(within(element).getAllByText(text, { exact: false }).length, text).toBeGreaterThan(0);
    expect(element).toHaveAttribute('data-risk', 'high');
    expect(element).toHaveAttribute('data-attestation', 'valid');
    expect(element.querySelector('[data-gate="1"]')).toHaveAttribute('data-gate-status', 'approved');
    expect(element.querySelector('[data-gate="2"]')).toHaveAttribute('data-gate-status', 'missing');
    for (const numeric of ['007', '1/3']) {
      const node = exactText(element, numeric);
      expect(node, numeric).toHaveClass('font-mono', 'tabular-nums');
    }
  });

  test('VB-03 the filter bar sends tag, risk and owner filters combined with AND', async () => {
    const all = defaultCards();
    const matches = (entry: CardPayload, filters: { tags?: string[]; risk?: string[]; owner?: string[] }) =>
      (!filters.tags?.length || filters.tags.every(tag => entry.tags.includes(tag))) &&
      (!filters.risk?.length || filters.risk.includes(entry.risk ?? '')) &&
      (!filters.owner?.length || filters.owner.includes(entry.owner ?? ''));
    const fake = scriptStudio(new FakeTransport()).respond('board.get', (args: InvokeArgs) =>
      board(
        'standard',
        all.filter(entry => matches(entry, (args.filters ?? {}) as Parameters<typeof matches>[1])),
      ),
    );
    const user = userEvent.setup();
    renderWithStudio(<BoardView route="standard" />, { transport: fake });
    await readyBoard();
    const toolbar = screen.getByRole('toolbar', { name: 'Filtros' });
    const group = (name: string) => within(toolbar).getByRole('group', { name });
    const visibleIds = () =>
      [...document.querySelectorAll<HTMLElement>('[data-card-id]')].map(el => el.dataset.cardId).sort();
    expect(visibleIds()).toEqual(['001', '002', '003']);

    await user.click(within(group('Etiqueta')).getByRole('button', { name: 'ui' }));
    await waitFor(() => expect(fake.lastCall('board.get').filters).toMatchObject({ tags: ['ui'] }));
    await waitFor(() => expect(visibleIds()).toEqual(['001', '002']));
    expect(within(group('Etiqueta')).getByRole('button', { name: 'ui' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(group('Riesgo')).getByRole('button', { name: 'high' }));
    await waitFor(() => expect(fake.lastCall('board.get').filters).toMatchObject({ tags: ['ui'], risk: ['high'] }));
    await waitFor(() => expect(visibleIds()).toEqual(['001']));

    await user.click(within(group('Responsable')).getByRole('button', { name: 'ana' }));
    await waitFor(() =>
      expect(fake.lastCall('board.get').filters).toEqual({ tags: ['ui'], risk: ['high'], owner: ['ana'] }),
    );
    expect(visibleIds()).toEqual(['001']);
  });

  test('VB-04 arrows move between cards, Enter opens the detail and Esc closes it', async () => {
    const fake = scriptStudio(new FakeTransport());
    const user = userEvent.setup();
    renderWithStudio(<BoardView route="standard" />, { transport: fake });
    await readyBoard();

    act(() => cardElement('001').focus());
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(cardElement('002'));
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(cardElement('001'));
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(cardElement('003'));
    await user.keyboard('{ArrowLeft}');
    expect(['001', '002']).toContain((document.activeElement as HTMLElement | null)?.dataset.cardId);

    act(() => cardElement('003').focus());
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: /Carto/ })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  test('VB-05 the board is read-only: nothing is draggable (D-11)', async () => {
    const fake = scriptStudio(new FakeTransport());
    renderWithStudio(<BoardView route="standard" />, { transport: fake });
    const root = await readyBoard();
    expect(root.querySelectorAll('[draggable="true"]')).toHaveLength(0);
    for (const element of root.querySelectorAll<HTMLElement>('[data-card-id]')) expect(element.draggable).toBe(false);
  });

  test('VB-06 "Aprobar Compuerta 1" calls gate.approve and shows Protected inline on GATE_LOCKED', async () => {
    const reason = 'Blast Radius de 004-payments sin revisar';
    const fake = scriptStudio(new FakeTransport()).failOnce('gate.approve', gateLocked(reason));
    const user = userEvent.setup();
    renderWithStudio(<BoardView route="full" />, { transport: fake });
    await readyBoard();
    expect(defaultBoard('full').lanes.find(lane => lane.id === 'gate-1')?.cards).toHaveLength(1);

    const payments = cardElement('004');
    await user.click(within(payments).getByRole('button', { name: 'Aprobar Compuerta 1' }));
    expect(fake.lastCall('gate.approve')).toMatchObject({ spec: '004', gate: 1 });
    await waitFor(() => expect(cardElement('004').querySelector('[data-state="protected"]')).not.toBeNull());
    expect(within(cardElement('004')).getByText(reason, { exact: false })).toBeInTheDocument();
    expect(within(cardElement('004')).queryByRole('button', { name: 'Aprobar Compuerta 1' })).toBeNull();
  });

  test('VB-07 a lane with 500 cards is virtualized (≤ 60 cards in the DOM)', async () => {
    const many = Array.from({ length: 500 }, (_, index) =>
      card({ id: String(index + 1).padStart(3, '0'), lane: 'specification', title: `Spec ${index + 1}` }),
    );
    const fake = scriptStudio(new FakeTransport()).respond('board.get', board('standard', many));
    renderWithStudio(<BoardView route="standard" />, { transport: fake });
    const root = await readyBoard();
    const lane = within(root).getByRole('region', { name: LANE_TITLES.specification });
    const rendered = lane.querySelectorAll('[data-card-id]').length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThanOrEqual(60);
  });
});
