/**
 * User settings (Ajustes, docs/STUDIO-AGENT-COCKPIT.md Fase 3 Q11, Q17, Q25), persisted per user in
 * localStorage. Studio starts every conversation asking for every edit and command; the user's own default
 * level and what Enter does while the agent works are chosen here.
 */
import { createStore } from 'zustand/vanilla';
import { readJson, writeJson } from './storage';

/** Studio's permission levels (Q25); each agent maps them to its own mode (Claude: `--permission-mode`). */
export const PERMISSION_LEVELS = ['ask', 'default', 'auto', 'bypass', 'plan'] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

export const isPermissionLevel = (value: unknown): value is PermissionLevel =>
  typeof value === 'string' && (PERMISSION_LEVELS as readonly string[]).includes(value);

export interface Settings {
  /** Level a new conversation starts with. */
  defaultPermission: PermissionLevel;
  /** Enter while the agent works: queue the message (Q17) or interrupt the turn and send it. */
  enterWhileBusy: 'queue' | 'interrupt';
  /** Windows notice when a conversation asks for approval or finishes out of sight (vuelta 3). */
  notifyApproval: boolean;
  notifyDone: boolean;
}

const KEY = 'settings.v1';
export const DEFAULT_SETTINGS: Settings = {
  defaultPermission: 'ask',
  enterWhileBusy: 'queue',
  notifyApproval: true,
  notifyDone: true,
};

function isSettings(value: unknown): value is Partial<Settings> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Saved settings over the defaults; unknown or broken values fall back one by one. */
export function readSettings(): Settings {
  const saved = readJson<Partial<Settings>>(KEY, {}, isSettings);
  return {
    defaultPermission: isPermissionLevel(saved.defaultPermission)
      ? saved.defaultPermission
      : DEFAULT_SETTINGS.defaultPermission,
    enterWhileBusy: saved.enterWhileBusy === 'interrupt' ? 'interrupt' : 'queue',
    notifyApproval: typeof saved.notifyApproval === 'boolean' ? saved.notifyApproval : DEFAULT_SETTINGS.notifyApproval,
    notifyDone: typeof saved.notifyDone === 'boolean' ? saved.notifyDone : DEFAULT_SETTINGS.notifyDone,
  };
}

export interface SettingsState extends Settings {
  update(patch: Partial<Settings>): void;
}

export function createSettingsStore() {
  return createStore<SettingsState>()((set, get) => ({
    ...readSettings(),
    update(patch) {
      set(patch);
      const { defaultPermission, enterWhileBusy, notifyApproval, notifyDone } = get();
      writeJson(KEY, { defaultPermission, enterWhileBusy, notifyApproval, notifyDone });
    },
  }));
}

export type SettingsStore = ReturnType<typeof createSettingsStore>;
