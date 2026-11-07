/**
 * Omni Studio shell (STUDIO-DESIGN-SYSTEM.md §1–§2, plan §11.5): seamless title bar over three elastic
 * columns — rail, stage (one page: the conversation, Specs, Memoria, Uso…) and the «Resumen» panel — plus the
 * command palette (docs/STUDIO-AGENT-COCKPIT.md, Fase 3 vuelta 2a).
 *
 * Shortcuts: Ctrl+N new conversation, Ctrl+B left rail, Ctrl+J Resumen panel, Ctrl+K palette.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import { useEnsureLoaded, useRefreshOn, useStudio } from '@/app/studio-context';
import { CommandPalette, type PaletteItem } from '@/components/ui/command-palette';
import {
  Brain,
  File,
  Gauge,
  KanbanSquare,
  MessageSquare,
  PanelRight,
  Plus,
  ScanSearch,
  Settings,
  SquareTerminal,
} from '@/components/ui/icon';
import { cn } from '@/components/ui/interaction';
import { messages } from '@/i18n/messages.es';
import { StudioError } from '@/ipc/client';
import { refreshProject } from '@/stores/app';
import { allFiles } from '@/stores/files';
import { STAGE_TABS } from '@/stores/layout';
import { Inspector } from './Inspector';
import { Rail } from './Rail';
import { SettingsDialog } from './SettingsDialog';
import { Stage } from './Stage';
import { TitleBar } from './TitleBar';

declare global {
  interface Window {
    __OMNI_STUDIO_BOOT__?: { processStartEpochMs?: number; hydratedEpochMs?: number };
  }
}

export function AppShell() {
  const { client, layout, snapshot, project, projectId, adoptSnapshot, dispatch, ui } = useStudio();
  const projectRef = useRef(project);
  projectRef.current = project;
  const collapsed = useStore(layout, state => state.inspectorCollapsed);
  const railCollapsed = useStore(layout, state => state.railCollapsed);
  useEnsureLoaded(snapshot);
  useRefreshOn(['board'], snapshot);
  const current = useStore(snapshot, state => state.data);

  // The first snapshot decides the project root (filters, stores) of this window.
  useEffect(() => {
    if (current && projectId === null) adoptSnapshot(current);
  }, [adoptSnapshot, current, projectId]);

  // E2E-01: mark the moment the board is painted with real data.
  const boardStatus = useStore(
    useStore(project.board, state => state.resource),
    state => state.status,
  );
  useEffect(() => {
    if (projectId === null || boardStatus !== 'ready') return;
    if (performance.getEntriesByName('studio:hydrated').length > 0) return;
    performance.mark('studio:hydrated');
    const boot = window.__OMNI_STUDIO_BOOT__ ?? {};
    window.__OMNI_STUDIO_BOOT__ = boot;
    boot.hydratedEpochMs = performance.timeOrigin + performance.now();
  }, [boardStatus, projectId]);

  // Host events: a project opened from outside (argv, second instance) and the engine lifecycle.
  useEffect(() => {
    const stopOpened = client.subscribe('project.opened', ({ snapshot: opened }) => {
      const resource = snapshot.getState();
      if (resource.status === 'ready') resource.setData(opened);
      else void resource.load();
      adoptSnapshot(opened);
      if (ui.getState().engine.status === 'error') ui.getState().setEngine({ status: 'ok' });
    });
    let restartedAt = 0;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const stopEngine = client.subscribe('engine.state', payload => {
      clearTimeout(settle);
      if ('state' in payload) {
        if (payload.state === 'restarting') {
          restartedAt = Date.now();
          ui.getState().setEngine({ status: 'restarting', message: messages.engine.restarting });
        } else if (payload.state === 'dead') {
          ui.getState().setEngine({ status: 'dead', message: messages.engine.dead });
        } else {
          // Keep the notice up long enough to be read, then revalidate everything in place.
          settle = setTimeout(
            () => {
              ui.getState().setEngine({ status: 'ok' });
              void snapshot.getState().refresh();
              refreshProject(projectRef.current);
            },
            Math.max(0, 1_200 - (Date.now() - restartedAt)),
          );
        }
        return;
      }
      ui.getState().setEngine({ status: 'error', message: StudioError.from(payload).message });
      void snapshot.getState().refresh();
    });
    return () => {
      clearTimeout(settle);
      stopOpened();
      stopEngine();
    };
  }, [adoptSnapshot, client, snapshot, ui]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key === 'j') dispatch({ type: 'inspector.toggle' });
      else if (key === 'b') layout.getState().toggleRail();
      else if (key === 'k') ui.getState().setPaletteOpen(!ui.getState().paletteOpen);
      else if (key === 'n') dispatch({ type: 'conversation.new' });
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dispatch, layout, ui]);

  const rail = railCollapsed ? '0rem' : 'clamp(13rem,16vw,16rem)';
  const panel = collapsed ? '0rem' : 'clamp(18rem,28vw,30rem)';
  return (
    <div className="flex h-dvh flex-col bg-canvas text-fg">
      <TitleBar />
      <div
        data-rail={railCollapsed ? 'collapsed' : 'expanded'}
        data-inspector={collapsed ? 'collapsed' : 'expanded'}
        style={{ gridTemplateColumns: `${rail} minmax(0,1fr) ${panel}` }}
        className={cn(
          'grid min-h-0 flex-1',
          'motion-safe:transition-[grid-template-columns] motion-safe:duration-200 motion-safe:ease-out',
        )}
      >
        {/* A folded rail leaves the tab order too. */}
        {railCollapsed ? <div aria-hidden="true" /> : <Rail />}
        <Stage />
        <Inspector />
      </div>
      <EngineNotice />
      <Palette />
      <SettingsDialog />
    </div>
  );
}

/** Floating notice while the engine restarts or after it gave up (E2E-10). */
function EngineNotice() {
  const { ui } = useStudio();
  const engine = useStore(ui, state => state.engine);
  if (engine.status === 'ok') return null;
  return (
    <div
      role="status"
      className={cn(
        'fixed start-1/2 top-12 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-floating px-3.5 py-1.5 text-xs',
        engine.status === 'restarting' ? 'border-accent/50 text-fg' : 'border-breach/50 text-breach',
      )}
    >
      {engine.status === 'restarting' ? (
        <span aria-hidden="true" className="size-1.5 rounded-full bg-accent motion-safe:animate-pulse" />
      ) : null}
      {engine.message}
    </div>
  );
}

const VIEW_ICONS = {
  chat: MessageSquare,
  kanban: KanbanSquare,
  memory: Brain,
  finops: Gauge,
} as const;

function Palette() {
  const { ui, snapshot, project, dispatch } = useStudio();
  const open = useStore(ui, state => state.paletteOpen);
  const origin = useStore(ui, state => state.paletteOrigin);
  const specs = useStore(snapshot, state => state.data?.specs);
  const filesResource = useStore(project.files, state => state.resource);
  const tree = useStore(filesResource, state => state.data);

  useEffect(() => {
    if (open && filesResource.getState().status === 'idle') void filesResource.getState().load();
  }, [filesResource, open]);

  const items = useMemo<PaletteItem[]>(() => {
    const views = STAGE_TABS.map<PaletteItem>(tab => ({
      id: `view:${tab}`,
      group: 'view',
      label: messages.shell.tabs[tab],
      icon: VIEW_ICONS[tab],
      run: () => dispatch({ type: 'stage.open', tab }),
    }));
    const specItems = (specs ?? []).map<PaletteItem>(spec => ({
      id: `spec:${spec.id}`,
      group: 'spec',
      label: spec.slug,
      hint: spec.title,
      icon: KanbanSquare,
      run: () => dispatch({ type: 'spec.focus', id: spec.id }),
    }));
    const fileItems = allFiles(tree).map<PaletteItem>(path => ({
      id: `file:${path}`,
      group: 'file',
      label: path,
      icon: File,
      run: () => dispatch({ type: 'file.open', path }),
    }));
    const actions: PaletteItem[] = [
      {
        id: 'action:spec.new',
        group: 'action',
        label: messages.shell.newSpec,
        icon: Plus,
        run: () => dispatch({ type: 'spec.new' }),
      },
      {
        id: 'action:terminal.new',
        group: 'action',
        label: messages.terminal.new,
        icon: SquareTerminal,
        run: () => dispatch({ type: 'terminal.new' }),
      },
      {
        id: 'action:inspector.toggle',
        group: 'action',
        label: messages.shell.toggleInspector,
        icon: PanelRight,
        run: () => dispatch({ type: 'inspector.toggle' }),
      },
      {
        id: 'action:project.scan',
        group: 'action',
        label: messages.board.ctaScan,
        icon: ScanSearch,
        run: () => dispatch({ type: 'project.scan' }),
      },
      {
        id: 'action:settings',
        group: 'action',
        label: messages.shell.settings,
        icon: Settings,
        run: () => dispatch({ type: 'settings.open' }),
      },
    ];
    return [...views, ...actions, ...specItems, ...fileItems];
  }, [dispatch, specs, tree]);

  return (
    <CommandPalette
      open={open}
      onOpenChange={next => ui.getState().setPaletteOpen(next)}
      items={items}
      returnFocusTo={origin}
      labels={{
        title: messages.shell.palette,
        empty: messages.shell.paletteEmpty,
        groups: messages.shell.paletteGroups,
      }}
    />
  );
}
