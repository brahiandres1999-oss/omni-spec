/**
 * App-level stores: the project snapshot and recent projects (one per window), transient UI state (palette,
 * dock draft, focus requests) and the per-project domain stores, recreated when the project switches (EG-08).
 */
import { createStore } from 'zustand/vanilla';
import type { StudioClient } from '@/ipc/client';
import type { BreakerState, RecentProject, SnapshotPayload } from '@/ipc/types';
import { createBoardStore } from './board';
import { createFilesStore } from './files';
import { createFinopsStore } from './finops';
import { createGraphStore } from './graph';
import { createResourceStore } from './resource';
import { createReviewStore } from './review';
import { createChatStore } from './chat';
import { createSkillsStore } from './skills';

export function createProjectStores(client: StudioClient, projectId: string) {
  return {
    projectId,
    board: createBoardStore(client, { projectId }),
    graph: createGraphStore(client),
    finops: createFinopsStore(client),
    skills: createSkillsStore(client),
    files: createFilesStore(client),
    chat: createChatStore(client, { projectId }),
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

const BREAKER_SEVERITY: BreakerState[] = ['CLOSED', 'HALF_OPEN', 'OPEN', 'DEAD_LETTER'];

/** Worst breaker state of the snapshot (the engine sends one entry per task). */
export function worstBreaker(snapshot: SnapshotPayload): BreakerState {
  const states = Array.isArray(snapshot.breakers)
    ? snapshot.breakers.map(entry => entry.state)
    : [snapshot.breakers.state];
  return states.reduce<BreakerState>(
    (worst, state) => (BREAKER_SEVERITY.indexOf(state) > BREAKER_SEVERITY.indexOf(worst) ? state : worst),
    'CLOSED',
  );
}

/** Revalidates every resource of a project (the engine came back after a restart). */
export function refreshProject(project: ProjectStores): void {
  void project.board.getState().resource.getState().refresh();
  void project.graph.getState().resource.getState().refresh();
  void project.finops.getState().resource.getState().refresh();
  void project.skills.getState().resource.getState().refresh();
  void project.files.getState().resource.getState().refresh();
  for (const review of project.reviews.values()) void review.getState().resource.getState().refresh();
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
  /** Engine lifecycle shown by the shell banner. */
  engine: { status: 'ok' | 'restarting' | 'dead' | 'error'; message?: string };
  setEngine(engine: UiState['engine']): void;
  setPaletteOpen(open: boolean): void;
  setSettingsOpen(open: boolean): void;
  setDockMode(mode: string): void;
  setDockDraft(draft: string): void;
  focusDock(patch?: { mode?: string; draft?: string }): void;
  focusDiffFile(path: string): void;
  /** Conversation to open once the engine of another project is up (a click in the rail switched project). */
  pendingConversation: { root: string; sessionId: string } | null;
  setPendingConversation(pending: UiState['pendingConversation']): void;
}

export function createUiStore() {
  return createStore<UiState>()((set, get) => ({
    paletteOpen: false,
    paletteOrigin: null,
    settingsOpen: false,
    dock: { mode: null, draft: '', focusNonce: 0 },
    diffFocus: null,
    engine: { status: 'ok' },
    pendingConversation: null,
    setPendingConversation: pendingConversation => set({ pendingConversation }),
    setEngine: engine => set({ engine }),
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
