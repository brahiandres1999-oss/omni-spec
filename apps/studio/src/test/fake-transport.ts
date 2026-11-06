/**
 * In-memory StudioTransport for tests (contract: docs/NEXTGEN-PHASE4-TEST-PLAN.md §11.0).
 *
 * - Records every invoke as `{ command, args }` (command = logical method name, e.g. `board.get`, `pty.write`).
 * - Responses are scripted per command: a persistent default (`respond`/`fail`) plus a FIFO of one-shot
 *   responses (`respondOnce`/`failOnce`/`defer`) that are consumed first.
 * - Engine errors reject with the JSON-RPC error object the host forwards: `{ code, message, data: { code, detail, retryable } }`.
 * - An unscripted command rejects with a plain Error and is recorded in `unscripted` (fail-fast, never a silent `undefined`).
 * - `emit(event, payload)` calls the listeners registered through `listen` synchronously; `listenerCount` exposes leaks.
 */
import type { StudioTransport } from '@/ipc/transport';

export type InvokeArgs = Record<string, unknown>;

export interface RecordedInvoke {
  readonly command: string;
  readonly args: InvokeArgs;
}

export interface RpcErrorPayload {
  readonly code: number;
  readonly message: string;
  readonly data: {
    readonly code: string;
    readonly detail: string;
    readonly retryable: boolean;
  };
}

export type ResponderFn = (args: InvokeArgs) => unknown;

export interface Deferred<T = unknown> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

export function deferred<T = unknown>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

type Handler = (args: InvokeArgs) => Promise<unknown>;

const valueHandler =
  (value: unknown): Handler =>
  async args =>
    typeof value === 'function' ? (value as ResponderFn)(args) : structuredClone(value);

const errorHandler =
  (error: RpcErrorPayload): Handler =>
  async () => {
    throw structuredClone(error);
  };

export class FakeTransport implements StudioTransport {
  readonly invokes: RecordedInvoke[] = [];
  readonly unscripted: string[] = [];
  private readonly defaults = new Map<string, Handler>();
  private readonly queues = new Map<string, Handler[]>();
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();

  /** Persistent response for `command`: a value (deep-cloned per call) or a function of the args. */
  respond(command: string, value: unknown): this {
    this.defaults.set(command, valueHandler(value));
    return this;
  }

  /** One-shot response consumed by the next invoke of `command` (FIFO, before the default). */
  respondOnce(command: string, value: unknown): this {
    this.enqueue(command, valueHandler(value));
    return this;
  }

  /** Persistent JSON-RPC error for `command`. */
  fail(command: string, error: RpcErrorPayload): this {
    this.defaults.set(command, errorHandler(error));
    return this;
  }

  /** One-shot JSON-RPC error for the next invoke of `command`. */
  failOnce(command: string, error: RpcErrorPayload): this {
    this.enqueue(command, errorHandler(error));
    return this;
  }

  /** One-shot response held open until the test settles it (in-flight states). */
  defer<T = unknown>(command: string): Deferred<T> {
    const gate = deferred<T>();
    this.enqueue(command, () => gate.promise);
    return gate;
  }

  invoke(command: string, args: InvokeArgs = {}): Promise<unknown> {
    this.invokes.push({ command, args });
    const handler = this.queues.get(command)?.shift() ?? this.defaults.get(command);
    if (!handler) {
      this.unscripted.push(command);
      return Promise.reject(new Error(`FakeTransport: no response scripted for "${command}"`));
    }
    return handler(args);
  }

  listen(event: string, handler: (payload: unknown) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    // Wrap so the same function registered twice counts (and unlistens) independently.
    const entry = (payload: unknown) => handler(payload);
    set.add(entry);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      set.delete(entry);
    };
  }

  /** Delivers an engine/host event to every current listener, synchronously. */
  emit(event: string, payload: unknown): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(structuredClone(payload));
  }

  /** Live listeners for `event`, or for every event when omitted. */
  listenerCount(event?: string): number {
    if (event !== undefined) return this.listeners.get(event)?.size ?? 0;
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }

  /** Args of every invoke of `command`, in order. */
  calls(command: string): InvokeArgs[] {
    return this.invokes.filter(entry => entry.command === command).map(entry => entry.args);
  }

  /** Args of the last invoke of `command`; throws when it was never invoked. */
  lastCall(command: string): InvokeArgs {
    const all = this.calls(command);
    const last = all[all.length - 1];
    if (!last) throw new Error(`FakeTransport: "${command}" was never invoked`);
    return last;
  }

  private enqueue(command: string, handler: Handler): void {
    let queue = this.queues.get(command);
    if (!queue) {
      queue = [];
      this.queues.set(command, queue);
    }
    queue.push(handler);
  }
}
