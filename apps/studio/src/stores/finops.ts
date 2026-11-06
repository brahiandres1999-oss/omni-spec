/**
 * FinOps store (VF, ST-06): `finops.snapshot` plus live `finops.tick` pushes. Ticks arrive at up to 20 Hz;
 * the store applies at most one every 250 ms (≤ 4 Hz) and always applies the trailing tick.
 */
import { createStore } from 'zustand/vanilla';
import type { StudioClient } from '@/ipc/client';
import type { FinopsPayload } from '@/ipc/types';
import { createResourceStore, type ResourceStore } from './resource';

export const TICK_INTERVAL_MS = 250;
export const SPARKLINE_WINDOW_MS = 60_000;

export interface RateSample {
  at: number;
  value: number;
}

export interface FinopsState {
  resource: ResourceStore<FinopsPayload>;
  history: RateSample[];
  /** Subscribes to live ticks while at least one consumer is mounted; returns the release function. */
  live(): () => void;
}

export function createFinopsStore(client: StudioClient) {
  let consumers = 0;
  let unlisten: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: FinopsPayload | null = null;

  const store = createStore<FinopsState>()((set, get) => {
    const resource = createResourceStore<FinopsPayload>(() => client.call('finops.snapshot', {}), {
      isEmpty: data => data.credentialSource === null && data.tasks.length === 0 && data.stream === 'idle',
    });

    const record = (value: number) => {
      const now = Date.now();
      const history = get().history.filter(sample => now - sample.at <= SPARKLINE_WINDOW_MS);
      set({ history: [...history, { at: now, value }] });
    };

    const flush = () => {
      timer = null;
      const next = pending;
      pending = null;
      if (!next) return;
      resource.getState().setData(next);
      record(next.tokensPerSecond);
    };

    resource.subscribe((state, previous) => {
      if (state.data && previous.status === 'loading' && state.data !== previous.data)
        record(state.data.tokensPerSecond);
    });

    return {
      resource,
      history: [],
      live() {
        consumers++;
        if (!unlisten)
          unlisten = client.subscribe('finops.tick', payload => {
            pending = payload as unknown as FinopsPayload;
            timer ??= setTimeout(flush, TICK_INTERVAL_MS);
          });
        let released = false;
        return () => {
          if (released) return;
          released = true;
          consumers--;
          if (consumers > 0) return;
          unlisten?.();
          unlisten = null;
          if (timer) clearTimeout(timer);
          timer = null;
          pending = null;
        };
      },
    };
  });
  return store;
}

export type FinopsStore = ReturnType<typeof createFinopsStore>;
