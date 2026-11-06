/** Shell layout, persisted per user in localStorage (ST-08, SH-02, SH-07). */
import { createStore } from 'zustand/vanilla';
import { readJson, writeJson } from './storage';

export const STAGE_TABS = ['chat', 'kanban', 'cartography', 'diffs', 'finops', 'skills'] as const;
export const INSPECTOR_TABS = ['terminal', 'overview', 'finops', 'files'] as const;
export type StageTab = (typeof STAGE_TABS)[number];
export type InspectorTab = (typeof INSPECTOR_TABS)[number];

interface PersistedLayout {
  inspectorCollapsed: boolean;
  inspectorTab: InspectorTab;
  stageTab: StageTab;
}

export interface LayoutState extends PersistedLayout {
  toggleInspector(): void;
  setInspectorCollapsed(collapsed: boolean): void;
  setInspectorTab(tab: InspectorTab): void;
  setStageTab(tab: StageTab): void;
}

// v2: the agent chat became the first stage tab, so earlier layouts (opening on Kanban) start fresh.
const KEY = 'layout.v2';
const DEFAULTS: PersistedLayout = { inspectorCollapsed: false, inspectorTab: 'terminal', stageTab: 'chat' };

function isLayout(value: unknown): value is PersistedLayout {
  const entry = value as Partial<PersistedLayout> | null;
  return (
    !!entry &&
    typeof entry.inspectorCollapsed === 'boolean' &&
    (INSPECTOR_TABS as readonly string[]).includes(entry.inspectorTab ?? '') &&
    (STAGE_TABS as readonly string[]).includes(entry.stageTab ?? '')
  );
}

export function createLayoutStore() {
  const initial = readJson<PersistedLayout>(KEY, DEFAULTS, isLayout);
  return createStore<LayoutState>()((set, get) => {
    const update = (patch: Partial<PersistedLayout>) => {
      set(patch);
      const { inspectorCollapsed, inspectorTab, stageTab } = get();
      writeJson(KEY, { inspectorCollapsed, inspectorTab, stageTab });
    };
    return {
      ...initial,
      toggleInspector: () => update({ inspectorCollapsed: !get().inspectorCollapsed }),
      setInspectorCollapsed: inspectorCollapsed => update({ inspectorCollapsed }),
      setInspectorTab: inspectorTab => update({ inspectorTab }),
      setStageTab: stageTab => update({ stageTab }),
    };
  });
}

export type LayoutStore = ReturnType<typeof createLayoutStore>;
