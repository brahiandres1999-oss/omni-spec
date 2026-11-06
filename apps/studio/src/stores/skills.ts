/** Skills store (VS): catalog from `skills.list`; toggles are confirmed by the server, never optimistic. */
import { createStore } from 'zustand/vanilla';
import { type StudioClient, StudioError } from '@/ipc/client';
import type { SkillsPayload } from '@/ipc/types';
import { createResourceStore, type ResourceStore } from './resource';

export interface SkillsState {
  resource: ResourceStore<SkillsPayload>;
  pending: Record<string, boolean>;
  failures: Record<string, StudioError>;
  toggle(name: string, enabled: boolean): Promise<void>;
}

export function createSkillsStore(client: StudioClient) {
  return createStore<SkillsState>()((set, get) => {
    const resource = createResourceStore<SkillsPayload>(() => client.call('skills.list', {}), {
      isEmpty: data => data.items.length === 0,
    });
    return {
      resource,
      pending: {},
      failures: {},
      async toggle(name, enabled) {
        if (get().pending[name]) return;
        const { [name]: _previous, ...failures } = get().failures;
        set({ pending: { ...get().pending, [name]: true }, failures });
        try {
          await client.call('skills.toggle', { name, enabled });
          await resource.getState().refresh();
        } catch (reason) {
          set({ failures: { ...get().failures, [name]: StudioError.from(reason) } });
        } finally {
          const { [name]: _done, ...rest } = get().pending;
          set({ pending: rest });
        }
      },
    };
  });
}

export type SkillsStore = ReturnType<typeof createSkillsStore>;
