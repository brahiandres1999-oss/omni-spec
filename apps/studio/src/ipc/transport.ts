/**
 * StudioTransport: the only seam between the frontend and the host (plan §11.0).
 *
 * Commands use logical names (`board.get`, `pty.write`, `window.set_caption_layout`…). The Tauri transport
 * maps them to the allow-listed Tauri commands (SEC-02): engine methods go through `engine_call`, host
 * commands to their own `snake_case` command. Tauri event names cannot contain `.`, so the host emits
 * `project:changed`, `pty:output`…; the transport translates them back.
 */
export interface StudioTransport {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  listen(event: string, handler: (payload: unknown) => void): () => void;
}

/** Host commands handled by Rust itself; everything else is forwarded to the engine. */
const HOST_COMMANDS: Readonly<Record<string, string>> = {
  'project.open': 'project_open',
  'recent.list': 'recent_list',
  'engine.stderr': 'engine_stderr',
  'pty.open': 'pty_open',
  'pty.write': 'pty_write',
  'pty.resize': 'pty_resize',
  'pty.close': 'pty_close',
  'fs.rescan': 'fs_rescan',
  'window.set_caption_layout': 'window_set_caption_layout',
};

type TauriInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
type TauriListen = (event: string, handler: (event: { payload: unknown }) => void) => Promise<() => void>;

export function tauriEventName(event: string): string {
  return event.replaceAll('.', ':');
}

/** Builds the transport over Tauri's `invoke`/`listen` (injected so this module stays testable). */
export function createTauriTransport(api: { invoke: TauriInvoke; listen: TauriListen }): StudioTransport {
  return {
    async invoke(command, args = {}) {
      const host = HOST_COMMANDS[command];
      if (!host) return api.invoke('engine_call', { method: command, params: args });
      if (command === 'window.set_caption_layout') return api.invoke(host, { layout: args });
      const result = await api.invoke(host, args);
      // recent_list answers `{ entries, error }`: the frontend only needs the entries.
      if (command === 'recent.list' && result && typeof result === 'object' && 'entries' in result)
        return (result as { entries: unknown }).entries;
      return result;
    },
    listen(event, handler) {
      let active = true;
      let unlisten: (() => void) | null = null;
      void api
        .listen(tauriEventName(event), message => {
          if (active) handler(message.payload);
        })
        .then(stop => {
          if (active) unlisten = stop;
          else stop();
        });
      return () => {
        if (!active) return;
        active = false;
        unlisten?.();
      };
    },
  };
}

/** True inside the Tauri WebView (the global is injected by the runtime). */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
