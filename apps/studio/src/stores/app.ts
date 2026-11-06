/**
 * App-level stores: the project snapshot and recent projects (one per window), transient UI state (palette,
 * dock draft, focus requests) and the per-project domain stores, recreated when the project switches (EG-08).
 */
import { createStore } from 'zustand/vanilla';
import type { StudioClient } from '@/ipc/client';
import type { RecentProject, SnapshotPayload } from '@/ipc/types';
import { createBoardStore } from './board';
import { createFilesStore } from './files';
import { createFinopsStore } from './finops';
import { createGraphStore } from './graph';
import { createResourceStore } from './resource';
import { createReviewStore } from './review';
import { createSkillsStore } from './skills';

export function createProjectStores(client: StudioClient, projectId: string) {
  return {
    projectId,
    board: createBoardStore(client, { projectId }),
    graph: createGraphStore(client),
    finops: createFinopsStore(client),
    skills: createSkillsStore(client),
    files: createFilesStore(client),
    /** Review stores by spec (the diff view is per spec; the diff itself is the working tree). */
    reviews: new Map<string, ReturnType<typeof createReviewStore>>(),
  };
}

export type ProjectStores = ReturnType<typeof createProjectStores>;

export function reviewFor(client: StudioClient, project: ProjectStores, spec: string) {
  let store = project.reviews.get(spec);
  if (!store) {
    store = createReviewStore(client, { spec });
    project.reviews.set(spec, store);
  }
  return store;
}

export function createSnapshotStore(client: StudioClient) {
  return createResourceStore<SnapshotPayload>(() => client.call('project.snapshot', {}));
}

export function createRecentStore(client: StudioClient) {
  return createResourceStore<RecentProject[]>(async () => {
    const result = await client.call('recent.list', {});
    return Array.isArray(result) ? result : ((result as { entries?: RecentProject[] })?.entries ?? []);
  });
}

export interface UiState {
  paletteOpen: boolean;
  /** Element focused when the palette opened; focus returns there on close (SH-10). */
  paletteOrigin: HTMLElement | null;
  settingsOpen: boolean;
  dock: { mode: string | null; draft: string; focusNonce: number };
  diffFocus: { path: string; nonce: number } | null;
  setPaletteOpen(open: boolean): void;
  setSettingsOpen(open: boolean): void;
  setDockMode(mode: string): void;
  setDockDraft(draft: string): void;
  focusDock(patch?: { mode?: string; draft?: string }): void;
  focusDiffFile(path: string): void;
}

export function createUiStore() {
  return createStore<UiState>()((set, get) => ({
    paletteOpen: false,
    paletteOrigin: null,
    settingsOpen: false,
    dock: { mode: null, draft: '', focusNonce: 0 },
    diffFocus: null,
    setPaletteOpen: paletteOpen =>
      set(
        paletteOpen && !get().paletteOpen
          ? {
              paletteOpen,
              paletteOrigin: document.activeElement instanceof HTMLElement ? document.activeElement : null,
            }
          : { paletteOpen },
      ),
    setSettingsOpen: settingsOpen => set({ settingsOpen }),
    setDockMode: mode => set({ dock: { ...get().dock, mode } }),
    setDockDraft: draft => set({ dock: { ...get().dock, draft } }),
    focusDock: (patch = {}) => set({ dock: { ...get().dock, ...patch, focusNonce: get().dock.focusNonce + 1 } }),
    focusDiffFile: path => set({ diffFocus: { path, nonce: (get().diffFocus?.nonce ?? 0) + 1 } }),
  }));
}

export type UiStore = ReturnType<typeof createUiStore>;
