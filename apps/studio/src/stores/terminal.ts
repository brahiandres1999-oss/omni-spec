/**
 * Terminal sessions (ST-07): a map of ConPTY sessions by id. Each session owns its `pty.exit` subscription,
 * released when the session closes. The xterm bridge (`terminal/xterm-adapter.ts`) owns the output stream.
 */
import { createStore } from 'zustand/vanilla';
import type { StudioClient } from '@/ipc/client';

export interface TerminalSession {
  id: string;
  status: 'running' | 'exited';
  exitCode: number | null;
}

export interface TerminalState {
  sessions: Record<string, TerminalSession>;
  activeId: string | null;
  opening: boolean;
  open(size?: { cols: number; rows: number }): Promise<string>;
  close(id: string): Promise<void>;
  /** Drops a session whose PTY was already closed elsewhere (the xterm adapter's dispose). */
  forget(id: string): void;
  setActive(id: string): void;
}

export function createTerminalStore(client: StudioClient) {
  const unlisten = new Map<string, () => void>();

  return createStore<TerminalState>()((set, get) => {
    const drop = (id: string) => {
      unlisten.get(id)?.();
      unlisten.delete(id);
      const { [id]: _closed, ...sessions } = get().sessions;
      const remaining = Object.keys(sessions);
      const activeId = get().activeId === id ? (remaining[remaining.length - 1] ?? null) : get().activeId;
      set({ sessions, activeId });
    };

    return {
      sessions: {},
      activeId: null,
      opening: false,
      async open(size = { cols: 120, rows: 30 }) {
        set({ opening: true });
        try {
          const { id } = (await client.call('pty.open', size)) as { id: string };
          unlisten.set(
            id,
            client.subscribe('pty.exit', payload => {
              if (payload.id !== id) return;
              const session = get().sessions[id];
              if (session)
                set({
                  sessions: { ...get().sessions, [id]: { ...session, status: 'exited', exitCode: payload.code } },
                });
            }),
          );
          set({ sessions: { ...get().sessions, [id]: { id, status: 'running', exitCode: null } }, activeId: id });
          return id;
        } finally {
          set({ opening: false });
        }
      },
      async close(id) {
        try {
          await client.call('pty.close', { id });
        } finally {
          drop(id);
        }
      },
      forget: drop,
      setActive(id) {
        if (get().sessions[id]) set({ activeId: id });
      },
    };
  });
}

export type TerminalStore = ReturnType<typeof createTerminalStore>;

/** The session the dock writes to: the active one, while its shell is still running (D-19). */
export function activeRunningSession(state: Pick<TerminalState, 'sessions' | 'activeId'>): string | null {
  const session = state.activeId ? state.sessions[state.activeId] : undefined;
  return session?.status === 'running' ? session.id : null;
}
