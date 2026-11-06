/**
 * xterm.js ⇄ ConPTY bridge (plan §11.4 VT-01…04).
 *
 * Receives the terminal and its addons (real xterm objects in the app, doubles in tests) and talks to the
 * host only through the StudioClient: `pty.output` events in, `pty.write` / `pty.resize` / `pty.close`
 * commands out. Container resizes are debounced into one `pty.resize` with the final size.
 */
import type { StudioClient } from '@/ipc/client';

export interface TerminalAddon {
  activate(terminal: never): void;
  dispose(): void;
}

export interface FitAddonLike extends TerminalAddon {
  fit(): void;
}

export interface XtermLike {
  cols: number;
  rows: number;
  open(parent: HTMLElement): void;
  write(data: string | Uint8Array): void;
  onData(listener: (data: string) => void): { dispose(): void };
  loadAddon(addon: TerminalAddon): void;
  dispose(): void;
  focus?(): void;
}

export interface XtermParts {
  terminal: XtermLike;
  fit: FitAddonLike;
  webgl?: TerminalAddon | null;
}

/** Builds the xterm objects for one session; `null` when no renderer is available (headless). */
export type TerminalFactory = () => XtermParts | null;

export interface AttachOptions extends XtermParts {
  client: StudioClient;
  sessionId: string;
  container: HTMLElement;
  /** Close the PTY when the bridge is disposed (default). The app closes sessions through the store. */
  closeOnDispose?: boolean;
  resizeDebounceMs?: number;
}

export interface XtermHandle {
  fit(): void;
  dispose(): Promise<void>;
}

export const RESIZE_DEBOUNCE_MS = 120;

export function attachXterm(options: AttachOptions): XtermHandle {
  const { client, sessionId, container, terminal, fit } = options;
  const debounce = options.resizeDebounceMs ?? RESIZE_DEBOUNCE_MS;
  let disposed = false;

  terminal.open(container);
  terminal.loadAddon(fit);
  let webgl = options.webgl ?? null;
  if (webgl) {
    try {
      terminal.loadAddon(webgl);
    } catch {
      // No WebGL2 (remote desktop, blocked GPU): xterm keeps its DOM renderer.
      webgl = null;
    }
  }

  const stopOutput = client.subscribe('pty.output', payload => {
    if (!disposed && payload.id === sessionId) terminal.write(payload.data);
  });

  const input = terminal.onData(data => {
    if (disposed) return;
    void client.call('pty.write', { id: sessionId, data }).catch(() => undefined);
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  let sent = { cols: terminal.cols, rows: terminal.rows };
  const sendSize = () => {
    timer = null;
    if (disposed) return;
    const size = { cols: terminal.cols, rows: terminal.rows };
    if (size.cols === sent.cols && size.rows === sent.rows) return;
    sent = size;
    void client.call('pty.resize', { id: sessionId, ...size }).catch(() => undefined);
  };
  const refit = () => {
    if (disposed) return;
    try {
      fit.fit();
    } catch {
      // The container may be hidden (inactive tab): keep the previous size.
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(sendSize, debounce);
  };

  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => refit());
  observer?.observe(container);

  return {
    fit: refit,
    async dispose() {
      if (disposed) return;
      disposed = true;
      if (timer) clearTimeout(timer);
      observer?.disconnect();
      stopOutput();
      input.dispose();
      webgl?.dispose();
      terminal.dispose();
      if (options.closeOnDispose !== false) await client.call('pty.close', { id: sessionId }).catch(() => undefined);
    },
  };
}
