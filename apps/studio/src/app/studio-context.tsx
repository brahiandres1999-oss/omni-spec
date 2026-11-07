/**
 * StudioProvider: wires one StudioClient to every store and exposes `dispatch` for the explicit actions
 * the views offer (Empty-state CTAs, rail, palette). Views read the stores through hooks; the context value
 * only changes when the project switches, so live data (FinOps ticks) never re-renders unrelated views.
 */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { ChangeArea, StudioClient } from '@/ipc/client';
import type { SnapshotPayload } from '@/ipc/types';
import {
  createProjectStores,
  createRecentStore,
  createSnapshotStore,
  createUiStore,
  type ProjectStores,
  type UiStore,
} from '@/stores/app';
import { type ConversationsStore, createConversationsStore } from '@/stores/conversations';
import { createLayoutStore, type InspectorTab, type LayoutStore, type StageTab } from '@/stores/layout';
import { createTerminalStore, type TerminalStore } from '@/stores/terminal';
import type { TerminalFactory } from '@/terminal/xterm-adapter';

export type StudioAction =
  | { type: 'spec.hotfix' }
  | { type: 'spec.new' }
  | { type: 'project.scan' }
  | { type: 'skills.rescan' }
  | { type: 'stage.open'; tab: StageTab }
  | { type: 'inspector.open'; tab: InspectorTab }
  | { type: 'spec.focus'; id: string }
  | { type: 'file.open'; path: string }
  | { type: 'project.open'; path: string }
  | { type: 'terminal.new' }
  | { type: 'inspector.toggle' }
  | { type: 'settings.open' }
  | { type: 'conversation.new' };

export interface StudioContextValue {
  client: StudioClient;
  layout: LayoutStore;
  terminal: TerminalStore;
  ui: UiStore;
  snapshot: ReturnType<typeof createSnapshotStore>;
  recent: ReturnType<typeof createRecentStore>;
  /** Studio conversations of every project in the rail. */
  conversations: ConversationsStore;
  project: ProjectStores;
  /** `null` until the shell knows the project root; standalone views use a default project. */
  projectId: string | null;
  terminalFactory: TerminalFactory | null;
  dispatch(action: StudioAction): void;
  openProject(path: string): Promise<void>;
  adoptSnapshot(snapshot: SnapshotPayload): void;
}

const StudioContext = createContext<StudioContextValue | null>(null);

const STANDALONE = 'default';

export interface StudioProviderProps {
  client: StudioClient;
  children: ReactNode;
  onAction?: (action: StudioAction) => void;
  terminalFactory?: TerminalFactory | null;
}

export function StudioProvider({ client, children, onAction, terminalFactory = null }: StudioProviderProps) {
  const [base] = useState(() => ({
    layout: createLayoutStore(),
    terminal: createTerminalStore(client),
    ui: createUiStore(),
    snapshot: createSnapshotStore(client),
    recent: createRecentStore(client),
    conversations: createConversationsStore(client),
  }));
  const projects = useRef(new Map<string, ProjectStores>());
  const [projectId, setProjectId] = useState<string | null>(null);
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  const project = useMemo(() => {
    const id = projectId ?? STANDALONE;
    let stores = projects.current.get(id);
    if (!stores) {
      stores = createProjectStores(client, id);
      projects.current.set(id, stores);
    }
    return stores;
  }, [client, projectId]);

  const projectRef = useRef(project);
  projectRef.current = project;

  const adoptSnapshot = useCallback((snapshot: SnapshotPayload) => {
    setProjectId(current => {
      if (current === snapshot.root) return current;
      // A switch starts from fresh stores: every view goes back to Loading (EG-08, SH-05).
      projects.current.delete(snapshot.root);
      return snapshot.root;
    });
  }, []);

  const openProject = useCallback(
    async (path: string) => {
      const snapshot = (await client.call('project.open', { path })) as SnapshotPayload;
      const resource = base.snapshot.getState();
      if (resource.status === 'ready') resource.setData(snapshot);
      else await resource.load();
      adoptSnapshot(snapshot);
      void base.recent.getState().refresh();
    },
    [adoptSnapshot, base, client],
  );

  const dispatch = useCallback(
    (action: StudioAction) => {
      onActionRef.current?.(action);
      const { layout, ui, terminal } = base;
      const current = projectRef.current;
      switch (action.type) {
        case 'stage.open':
          layout.getState().setStageTab(action.tab);
          break;
        case 'inspector.open':
          layout.getState().setInspectorCollapsed(false);
          layout.getState().setInspectorTab(action.tab);
          break;
        case 'inspector.toggle':
          layout.getState().toggleInspector();
          break;
        case 'spec.new':
          // The chat is the cockpit: a new spec starts as a conversation that runs the OmniSpec skill.
          layout.getState().setStageTab('chat');
          current.chat.getState().setDraft('/omni-specify ');
          break;
        case 'spec.hotfix':
          layout.getState().setStageTab('chat');
          current.chat.getState().setDraft('/omni-specify --light ');
          break;
        case 'spec.focus':
          layout.getState().setStageTab('kanban');
          current.board.getState().requestFocus(action.id);
          break;
        case 'file.open':
          layout.getState().setInspectorCollapsed(false);
          layout.getState().setInspectorTab('review');
          ui.getState().focusDiffFile(action.path);
          break;
        case 'project.scan':
          void client
            .call('fs.rescan', {})
            .catch(() => undefined)
            .then(() => {
              void current.graph.getState().resource.getState().refresh();
              void current.board.getState().resource.getState().refresh();
            });
          break;
        case 'skills.rescan':
          void current.skills.getState().resource.getState().refresh();
          break;
        case 'project.open':
          void openProject(action.path).catch(() => undefined);
          break;
        case 'terminal.new':
          layout.getState().setInspectorCollapsed(false);
          layout.getState().setInspectorTab('terminal');
          void terminal
            .getState()
            .open()
            .catch(() => undefined);
          break;
        case 'settings.open':
          ui.getState().setSettingsOpen(true);
          break;
        case 'conversation.new':
          layout.getState().setStageTab('chat');
          void current.chat.getState().reset();
          break;
      }
    },
    [base, client, openProject],
  );

  const value = useMemo<StudioContextValue>(
    () => ({
      client,
      ...base,
      project,
      projectId,
      terminalFactory,
      dispatch,
      openProject,
      adoptSnapshot,
    }),
    [adoptSnapshot, base, client, dispatch, openProject, project, projectId, terminalFactory],
  );

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio(): StudioContextValue {
  const value = useContext(StudioContext);
  if (!value) throw new Error('useStudio must be used inside <StudioProvider>');
  return value;
}

/** Loads a resource once when the consumer mounts and it was never loaded. */
export function useEnsureLoaded(resource: { getState(): { status: string; load(): Promise<void> } }): void {
  useEffect(() => {
    if (resource.getState().status === 'idle') void resource.getState().load();
  }, [resource]);
}

/** Revalidates in place whenever the engine reports a change in one of `areas` (IC-03, ST-03). */
export function useRefreshOn(
  areas: readonly ChangeArea[],
  resource: { getState(): { refresh(): Promise<void> } },
): void {
  const { client } = useStudio();
  const key = areas.join(',');
  useEffect(() => {
    const stop = client.watch(key.split(',') as ChangeArea[], () => {
      void resource.getState().refresh();
    });
    return stop;
  }, [client, key, resource]);
}

export { useStore };
