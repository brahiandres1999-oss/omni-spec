/**
 * The 4-state resource machine every view renders (plan §11.2 ST-01…03, §11.3).
 *
 *   idle → loading → ready | empty | error | protected
 *
 * - `load()` enters `loading` (first load, reload after a project switch).
 * - `retry()` only exists from `error` and repeats this store's request alone (ST-02).
 * - `refresh()` revalidates in place: `ready` data stays visible with `revalidating: true` (ST-03, CLS = 0).
 * - Illegal transitions throw (fail-fast); responses of superseded requests are discarded.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { StudioError } from '@/ipc/client';

export type ResourceStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error' | 'protected';

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: ResourceStatus,
    readonly to: ResourceStatus,
  ) {
    super(`illegal resource transition ${from} → ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

const SETTLED: readonly ResourceStatus[] = ['ready', 'empty', 'error', 'protected'];

const TABLE: Readonly<Record<ResourceStatus, readonly ResourceStatus[]>> = {
  idle: ['loading'],
  loading: SETTLED,
  // A settled resource can reload, or settle again after an in-place revalidation.
  ready: ['loading', ...SETTLED],
  empty: ['loading', ...SETTLED],
  error: ['loading'],
  protected: ['loading'],
};

/** Pure transition table: returns `to` or throws IllegalTransitionError. */
export function transition(from: ResourceStatus, to: ResourceStatus): ResourceStatus {
  if (!TABLE[from].includes(to)) throw new IllegalTransitionError(from, to);
  return to;
}

export interface ResourceState<T> {
  status: ResourceStatus;
  data: T | undefined;
  error: StudioError | undefined;
  revalidating: boolean;
  load(): Promise<void>;
  retry(): Promise<void>;
  refresh(): Promise<void>;
  /** Replaces the data without a request (live pushes such as `finops.tick`). */
  setData(data: T): void;
}

export interface ResourceOptions<T> {
  isEmpty?: (data: T) => boolean;
}

export type ResourceStore<T> = StoreApi<ResourceState<T>>;

export function createResourceStore<T>(
  fetcher: () => Promise<unknown>,
  options: ResourceOptions<T> = {},
): ResourceStore<T> {
  let generation = 0;

  return createStore<ResourceState<T>>()((set, get) => {
    const settle = (data: T) => {
      const next = options.isEmpty?.(data) ? 'empty' : 'ready';
      set({ status: transition(get().status, next), data, error: undefined, revalidating: false });
    };
    const fail = (reason: unknown) => {
      const error = StudioError.from(reason);
      const next = error.kind === 'protected' ? 'protected' : 'error';
      set({ status: transition(get().status, next), error, revalidating: false });
    };
    const run = async (mode: 'load' | 'refresh' | 'restart') => {
      const ticket = ++generation;
      if (mode === 'load') set({ status: transition(get().status, 'loading'), error: undefined, revalidating: false });
      else if (mode === 'refresh') set({ revalidating: true });
      try {
        const data = (await fetcher()) as T;
        if (ticket === generation) settle(data);
      } catch (reason) {
        if (ticket === generation) fail(reason);
      }
    };

    return {
      status: 'idle',
      data: undefined,
      error: undefined,
      revalidating: false,
      load: () => run('load'),
      async retry() {
        const { status } = get();
        if (status !== 'error') throw new IllegalTransitionError(status, 'loading');
        await run('load');
      },
      refresh() {
        const { status } = get();
        if (status === 'idle') return Promise.resolve();
        // A request in flight is superseded by a fresh one (its answer would already be stale).
        if (status === 'loading') return run('restart');
        // Only data that is on screen is revalidated in place; anything else reloads visibly.
        return run(status === 'ready' || status === 'empty' ? 'refresh' : 'load');
      },
      setData(data) {
        const { status } = get();
        if (status !== 'ready' && status !== 'empty') return;
        generation++;
        settle(data);
      },
    };
  });
}
