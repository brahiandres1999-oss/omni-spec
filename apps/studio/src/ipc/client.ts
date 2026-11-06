/**
 * Typed Studio client over a StudioTransport (plan §11.1).
 *
 * - `call(method, params)`: engine methods and host commands. Identical reads in flight share one
 *   invocation (IC-04); mutations are never deduplicated.
 * - Errors become `StudioError { kind, code, message, detail, retryable }` (IC-02): the human message never
 *   carries the opaque code, which stays in `code` for the technical `<details>`.
 * - `watch(areas, handler)`: `project.changed` filtered by area (IC-03).
 */
import { messages } from '@/i18n/messages.es';
import type { EngineEventPayloads, EngineRequestParams } from './generated';
import type { StudioTransport } from './transport';
import type { HostCommandParams, HostEventPayloads } from './types';

export type StudioMethod = keyof EngineRequestParams | keyof HostCommandParams;
export type StudioParams<M extends StudioMethod> = M extends keyof EngineRequestParams
  ? EngineRequestParams[M]
  : M extends keyof HostCommandParams
    ? HostCommandParams[M]
    : never;

export type StudioEvent = keyof EngineEventPayloads | keyof HostEventPayloads;
export type StudioEventPayload<E extends StudioEvent> = E extends keyof EngineEventPayloads
  ? EngineEventPayloads[E]
  : E extends keyof HostEventPayloads
    ? HostEventPayloads[E]
    : never;

export type ChangeArea = 'board' | 'graph' | 'diff' | 'files' | 'finops' | 'skills';

export type StudioErrorKind = 'error' | 'protected';

/** Codes that mean "a human gate says no", rendered as the Protected state rather than an error. */
const PROTECTED_CODES = new Set(['GATE_LOCKED']);

export class StudioError extends Error {
  readonly kind: StudioErrorKind;
  readonly code: string;
  readonly detail: string;
  readonly retryable: boolean;

  constructor(init: { kind: StudioErrorKind; code: string; message: string; detail: string; retryable: boolean }) {
    super(init.message);
    this.name = 'StudioError';
    this.kind = init.kind;
    this.code = init.code;
    this.detail = init.detail;
    this.retryable = init.retryable;
  }

  /** Maps whatever the transport rejected with (JSON-RPC error object, Error, string) to a StudioError. */
  static from(reason: unknown): StudioError {
    if (reason instanceof StudioError) return reason;
    const rpc = reason as { message?: unknown; data?: { code?: unknown; detail?: unknown; retryable?: unknown } };
    if (rpc && typeof rpc === 'object' && rpc.data && typeof rpc.data.code === 'string') {
      const code = rpc.data.code;
      const detail = typeof rpc.data.detail === 'string' ? rpc.data.detail : String(rpc.message ?? '');
      return new StudioError({
        kind: PROTECTED_CODES.has(code) ? 'protected' : 'error',
        code,
        message: humanMessage(code),
        detail,
        retryable: rpc.data.retryable === true,
      });
    }
    const detail = reason instanceof Error ? reason.message : String(reason);
    return new StudioError({
      kind: 'error',
      code: 'UNEXPECTED',
      message: messages.errors.fallback ?? '',
      detail,
      retryable: true,
    });
  }
}

function humanMessage(code: string): string {
  const text = messages.errors[code] ?? messages.errors.fallback ?? '';
  // Defensive: the human sentence must never echo the opaque code (blueprint §4.7.3).
  return text.includes(code) ? (messages.errors.fallback ?? '') : text;
}

/** Methods with side effects: never deduplicated, never cached. */
const MUTATIONS = new Set<string>([
  'gate.approve',
  'review.decideHunk',
  'review.stageApproved',
  'review.addRemark',
  'skills.toggle',
  'project.open',
  'pty.open',
  'pty.write',
  'pty.resize',
  'pty.close',
  'fs.rescan',
  'window.set_caption_layout',
]);

export interface StudioClient {
  call<M extends StudioMethod>(method: M, params?: StudioParams<M>): Promise<unknown>;
  subscribe<E extends StudioEvent>(event: E, handler: (payload: StudioEventPayload<E>) => void): () => void;
  watch(areas: readonly ChangeArea[], handler: (changed: ChangeArea[]) => void): () => void;
}

/** Stable key of a read: method + params with sorted keys. */
function readKey(method: string, params: unknown): string {
  const sort = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sort);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([, entry]) => entry !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([name, entry]) => [name, sort(entry)]),
      );
    return value;
  };
  return `${method} ${JSON.stringify(sort(params ?? {}))}`;
}

export function createStudioClient(transport: StudioTransport): StudioClient {
  const inflight = new Map<string, Promise<unknown>>();

  const invoke = (method: string, params: Record<string, unknown>) =>
    transport.invoke(method, params).catch((reason: unknown) => {
      throw StudioError.from(reason);
    });

  return {
    call(method, params) {
      const args = (params ?? {}) as Record<string, unknown>;
      if (MUTATIONS.has(method)) return invoke(method, args);
      const key = readKey(method, args);
      const pending = inflight.get(key);
      if (pending) return pending;
      const request = invoke(method, args).finally(() => inflight.delete(key));
      inflight.set(key, request);
      return request;
    },
    subscribe(event, handler) {
      return transport.listen(event, payload => handler(payload as never));
    },
    watch(areas, handler) {
      const wanted = new Set<string>(areas);
      return transport.listen('project.changed', payload => {
        const changed = ((payload as { areas?: unknown })?.areas ?? []) as ChangeArea[];
        const hits = Array.isArray(changed) ? changed.filter(area => wanted.has(area)) : [];
        if (hits.length > 0) handler(hits);
      });
    },
  };
}
