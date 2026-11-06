/**
 * Board store (VB, ST-04): the read-only projection of `board.get` (D-11), its filters persisted per
 * project, the filter options seen so far and per-card gate approvals.
 */
import { createStore } from 'zustand/vanilla';
import { type StudioClient, StudioError } from '@/ipc/client';
import type { BoardCard, BoardFilters, BoardPayload, BoardRoute } from '@/ipc/types';
import { createResourceStore, type ResourceStore } from './resource';
import { readJson, writeJson } from './storage';

const EMPTY_FILTERS: BoardFilters = { tags: [], risk: [], owner: [] };

function isFilters(value: unknown): value is BoardFilters {
  const entry = value as Partial<BoardFilters> | null;
  const list = (items: unknown) => Array.isArray(items) && items.every(item => typeof item === 'string');
  return !!entry && list(entry.tags) && list(entry.risk) && list(entry.owner);
}

export const hasActiveFilters = (filters: BoardFilters) =>
  filters.tags.length > 0 || filters.risk.length > 0 || filters.owner.length > 0;

export interface GateAttempt {
  status: 'pending' | 'locked' | 'failed';
  error?: StudioError;
}

export interface BoardState {
  route: BoardRoute;
  filters: BoardFilters;
  /** Every tag, risk level and owner seen in this project, so options never vanish while filtering. */
  options: BoardFilters;
  gateAttempts: Record<string, GateAttempt>;
  /** Card the rail asked to focus (SH-04); the nonce re-triggers the same id. */
  focusRequest: { id: string; nonce: number } | null;
  resource: ResourceStore<BoardPayload>;
  setRoute(route: BoardRoute): void;
  setFilters(patch: Partial<BoardFilters>): void;
  toggleFilter(group: keyof BoardFilters, value: string): void;
  clearFilters(): void;
  approveGate(card: string, gate: 1 | 2): Promise<void>;
  requestFocus(id: string): void;
}

export function createBoardStore(client: StudioClient, options: { projectId: string; route?: BoardRoute }) {
  const key = `board-filters:${options.projectId}`;

  const store = createStore<BoardState>()((set, get) => {
    const resource = createResourceStore<BoardPayload>(
      () => {
        const { route, filters } = get();
        return client.call('board.get', { route, filters });
      },
      {
        isEmpty: data =>
          !hasActiveFilters(get().filters) &&
          data.unrouted.length === 0 &&
          data.lanes.every(lane => lane.cards.length === 0),
      },
    );

    const changeFilters = (filters: BoardFilters) => {
      set({ filters });
      writeJson(key, filters);
      void resource.getState().refresh();
    };

    return {
      route: options.route ?? 'standard',
      filters: readJson(key, EMPTY_FILTERS, isFilters),
      options: EMPTY_FILTERS,
      gateAttempts: {},
      focusRequest: null,
      resource,
      setRoute(route) {
        if (route === get().route) return;
        set({ route });
        void resource.getState().refresh();
      },
      setFilters(patch) {
        changeFilters({ ...get().filters, ...patch });
      },
      toggleFilter(group, value) {
        const current = get().filters[group];
        const next = current.includes(value) ? current.filter(item => item !== value) : [...current, value];
        changeFilters({ ...get().filters, [group]: next });
      },
      clearFilters() {
        changeFilters(EMPTY_FILTERS);
      },
      async approveGate(card, gate) {
        set({ gateAttempts: { ...get().gateAttempts, [card]: { status: 'pending' } } });
        try {
          await client.call('gate.approve', { spec: card, gate });
          const { [card]: _settled, ...rest } = get().gateAttempts;
          set({ gateAttempts: rest });
          void resource.getState().refresh();
        } catch (reason) {
          const error = StudioError.from(reason);
          set({
            gateAttempts: {
              ...get().gateAttempts,
              [card]: { status: error.kind === 'protected' ? 'locked' : 'failed', error },
            },
          });
        }
      },
      requestFocus(id) {
        set({ focusRequest: { id, nonce: (get().focusRequest?.nonce ?? 0) + 1 } });
      },
    };
  });

  // Accumulate filter options from every payload (union, sorted).
  const merge = (current: string[], incoming: Iterable<string>) =>
    [...new Set([...current, ...incoming])].sort((a, b) => a.localeCompare(b, 'es'));
  store.getState().resource.subscribe(state => {
    if (!state.data) return;
    const cards: BoardCard[] = [...state.data.lanes.flatMap(lane => lane.cards), ...state.data.unrouted];
    const { options: seen, filters } = store.getState();
    const next: BoardFilters = {
      tags: merge(seen.tags, [...cards.flatMap(card => card.tags), ...filters.tags]),
      risk: merge(seen.risk, [...cards.flatMap(card => (card.risk ? [card.risk] : [])), ...filters.risk]),
      owner: merge(seen.owner, [...cards.flatMap(card => (card.owner ? [card.owner] : [])), ...filters.owner]),
    };
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((item, index) => item === b[index]);
    if (!same(next.tags, seen.tags) || !same(next.risk, seen.risk) || !same(next.owner, seen.owner))
      store.setState({ options: next });
  });

  return store;
}

export type BoardStore = ReturnType<typeof createBoardStore>;
