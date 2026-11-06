/**
 * VT — xterm.js ⇄ pty.* bridge. `attachXterm` receives the terminal and addons (real xterm objects in the
 * app, doubles here: happy-dom has no canvas/WebGL) and talks to the host only through the StudioClient:
 * events `pty.output { id, data }`; commands `pty.write { id, data }`, `pty.resize { id, cols, rows }`,
 * `pty.close { id }`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createStudioClient } from '@/ipc/client';
import { attachXterm } from '@/terminal/xterm-adapter';
import { FakeTransport } from '@/test/fake-transport';
import { scriptStudio } from '@/test/fixtures';

class FakeTerminal {
  cols = 120;
  rows = 30;
  readonly written: string[] = [];
  readonly addons: unknown[] = [];
  parent: HTMLElement | null = null;
  disposed = false;
  readonly dataDisposed = vi.fn();
  private dataListener: ((data: string) => void) | null = null;
  open(parent: HTMLElement): void {
    this.parent = parent;
  }
  write(data: string | Uint8Array): void {
    this.written.push(typeof data === 'string' ? data : new TextDecoder().decode(data));
  }
  onData(listener: (data: string) => void): { dispose(): void } {
    this.dataListener = listener;
    return { dispose: this.dataDisposed };
  }
  loadAddon(addon: { activate(terminal: unknown): void; dispose(): void }): void {
    addon.activate(this);
    this.addons.push(addon);
  }
  dispose(): void {
    this.disposed = true;
  }
  type(data: string): void {
    if (!this.dataListener) throw new Error('the adapter never subscribed to onData');
    this.dataListener(data);
  }
}

const addon = () => ({ activate: vi.fn(), dispose: vi.fn() });

interface ObserverRecord {
  callback: ResizeObserverCallback;
  targets: Element[];
  disconnected: boolean;
}
let observers: ObserverRecord[] = [];

beforeEach(() => {
  observers = [];
  class FakeResizeObserver {
    private readonly record: ObserverRecord;
    constructor(callback: ResizeObserverCallback) {
      this.record = { callback, targets: [], disconnected: false };
      observers.push(this.record);
    }
    observe(target: Element): void {
      this.record.targets.push(target);
    }
    unobserve(): void {}
    disconnect(): void {
      this.record.disconnected = true;
    }
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup() {
  const fake = scriptStudio(new FakeTransport());
  const client = createStudioClient(fake);
  const container = document.createElement('div');
  document.body.append(container);
  const terminal = new FakeTerminal();
  const fit = { ...addon(), fit: vi.fn() };
  const webgl = addon();
  const handle = attachXterm({ client, sessionId: 'pty-1', container, terminal, fit, webgl });
  return { fake, container, terminal, fit, webgl, handle };
}

describe('VT xterm adapter', () => {
  test('VT-01 PTY output for this session is written to xterm, other sessions are ignored', () => {
    const { fake, container, terminal, fit, webgl } = setup();
    expect(terminal.parent).toBe(container);
    expect(terminal.addons).toEqual(expect.arrayContaining([fit, webgl]));

    const trueColor = '\x1b[38;2;1;2;3mOMNI\x1b[0m\r\n';
    fake.emit('pty.output', { id: 'pty-1', data: trueColor });
    fake.emit('pty.output', { id: 'pty-2', data: 'not mine' });
    expect(terminal.written).toEqual([trueColor]);
  });

  test('VT-02 keyboard input calls pty.write', async () => {
    const { fake, terminal } = setup();
    terminal.type('dir\r');
    await vi.waitFor(() => expect(fake.calls('pty.write')).toHaveLength(1));
    expect(fake.lastCall('pty.write')).toEqual({ id: 'pty-1', data: 'dir\r' });
  });

  test('VT-03 ResizeObserver bursts become one debounced pty.resize with the final size', async () => {
    vi.useFakeTimers();
    const { fake, container, terminal, fit } = setup();
    const observer = observers.find(entry => entry.targets.includes(container));
    if (!observer) throw new Error('the adapter must observe its container with a ResizeObserver');

    for (const [cols, rows] of [
      [100, 25],
      [110, 28],
      [118, 33],
      [120, 40],
      [132, 41],
    ] as const) {
      terminal.cols = cols;
      terminal.rows = rows;
      observer.callback([], {} as ResizeObserver);
      await vi.advanceTimersByTimeAsync(10);
    }
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fake.calls('pty.resize')).toEqual([{ id: 'pty-1', cols: 132, rows: 41 }]);
    expect(fit.fit).toHaveBeenCalled();
  });

  test('VT-04 dispose closes the PTY and releases the WebGL addon, observer and listeners', async () => {
    const { fake, terminal, webgl, handle } = setup();
    const observer = observers[0];
    await handle.dispose();
    expect(fake.lastCall('pty.close')).toEqual({ id: 'pty-1' });
    expect(webgl.dispose).toHaveBeenCalledTimes(1);
    expect(terminal.disposed).toBe(true);
    expect(terminal.dataDisposed).toHaveBeenCalled();
    expect(observer?.disconnected).toBe(true);
    expect(fake.listenerCount('pty.output')).toBe(0);

    fake.emit('pty.output', { id: 'pty-1', data: 'late' });
    expect(terminal.written).toEqual([]);
  });
});
