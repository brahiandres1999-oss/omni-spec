/**
 * Shell layout, persisted per user in localStorage (ST-08, SH-02, SH-07). Fase 3 vuelta 2a: the stage shows one
 * page (the conversation, Specs, Memoria or Uso) chosen from the rail, the left rail folds with Ctrl+B and
 * the right panel «Resumen» (Revisión, Archivos, Terminal) starts closed and folds with Ctrl+J. Vuelta 2b moved
 * Cartografía into Revisión › Impacto, Diffs into Archivos › Cambios de git and Skills into Ajustes.
 */
import { createStore } from 'zustand/vanilla';
import { readJson, writeJson } from './storage';

export const STAGE_TABS = ['chat', 'kanban', 'memory', 'finops'] as const;
export const INSPECTOR_TABS = ['review', 'files', 'terminal'] as const;
export type StageTab = (typeof STAGE_TABS)[number];
export type InspectorTab = (typeof INSPECTOR_TABS)[number];

interface PersistedLayout {
  railCollapsed: boolean;
  inspectorCollapsed: boolean;
  inspectorTab: InspectorTab;
  stageTab: StageTab;
}

export interface LayoutState extends PersistedLayout {
  toggleRail(): void;
  toggleInspector(): void;
  setInspectorCollapsed(collapsed: boolean): void;
  setInspectorTab(tab: InspectorTab): void;
  setStageTab(tab: StageTab): void;
}

// v3: pages instead of tabs and a panel that starts closed (Fase 3, Q14), so earlier layouts start fresh.
const KEY = 'layout.v3';
const DEFAULTS: PersistedLayout = {
  railCollapsed: false,
  inspectorCollapsed: true,
  inspectorTab: 'review',
  stageTab: 'chat',
};

function isLayout(value: unknown): value is PersistedLayout {
  const entry = value as Partial<PersistedLayout> | null;
  return (
    !!entry &&
    typeof entry.railCollapsed === 'boolean' &&
    typeof entry.inspectorCollapsed === 'boolean' &&
    (INSPECTOR_TABS as readonly string[]).includes(entry.inspectorTab ?? '')
  );
}

const isStageTab = (value: unknown): value is StageTab =>
  typeof value === 'string' && (STAGE_TABS as readonly string[]).includes(value);

export function createLayoutStore() {
  const saved = readJson<PersistedLayout>(KEY, DEFAULTS, isLayout);
  // A page that moved elsewhere (Cartografía, Diffs, Skills) reopens the conversation.
  const initial = { ...saved, stageTab: isStageTab(saved.stageTab) ? saved.stageTab : 'chat' };
  return createStore<LayoutState>()((set, get) => {
    const update = (patch: Partial<PersistedLayout>) => {
      set(patch);
      const { railCollapsed, inspectorCollapsed, inspectorTab, stageTab } = get();
      writeJson(KEY, { railCollapsed, inspectorCollapsed, inspectorTab, stageTab });
    };
    return {
      ...initial,
      toggleRail: () => update({ railCollapsed: !get().railCollapsed }),
      toggleInspector: () => update({ inspectorCollapsed: !get().inspectorCollapsed }),
      setInspectorCollapsed: inspectorCollapsed => update({ inspectorCollapsed }),
      setInspectorTab: inspectorTab => update({ inspectorTab }),
      setStageTab: stageTab => update({ stageTab }),
    };
  });
}

export type LayoutStore = ReturnType<typeof createLayoutStore>;
