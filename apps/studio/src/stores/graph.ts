/**
 * Cartography store (VC): `cartography.graph` and the on-demand Blast Radius of the selected module (D-14:
 * the heat of one target is computed only when it is selected).
 */
import { createStore } from 'zustand/vanilla';
import { type StudioClient, StudioError } from '@/ipc/client';
import type { GraphPayload, HeatPayload } from '@/ipc/types';
import { createResourceStore, type ResourceStore } from './resource';

export interface GraphState {
  resource: ResourceStore<GraphPayload>;
  selected: string | null;
  heat: { status: 'idle' | 'loading' | 'ready' | 'error'; data?: HeatPayload; error?: StudioError };
  select(path: string | null): Promise<void>;
}

export function createGraphStore(client: StudioClient) {
  let ticket = 0;
  return createStore<GraphState>()((set, get) => ({
    resource: createResourceStore<GraphPayload>(() => client.call('cartography.graph', {}), {
      isEmpty: data => !data.indexed || data.nodes.length === 0,
    }),
    selected: null,
    heat: { status: 'idle' },
    async select(path) {
      const mine = ++ticket;
      if (path === null || path === get().selected) {
        if (path === null) set({ selected: null, heat: { status: 'idle' } });
        return;
      }
      set({ selected: path, heat: { status: 'loading' } });
      try {
        const data = (await client.call('blastRadius.heat', { target: path })) as HeatPayload;
        if (mine === ticket) set({ heat: { status: 'ready', data } });
      } catch (reason) {
        if (mine === ticket) set({ heat: { status: 'error', error: StudioError.from(reason) } });
      }
    },
  }));
}

export type GraphStore = ReturnType<typeof createGraphStore>;
