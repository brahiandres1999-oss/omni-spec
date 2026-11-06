/**
 * Review store (VD, ST-05): the working-tree diff, per-hunk decisions confirmed by the server (no optimistic
 * updates), staging of the approved hunks (D-10), Gate 2 and inline corrections (D-8).
 */
import { createStore } from 'zustand/vanilla';
import { type StudioClient, StudioError } from '@/ipc/client';
import type { DiffPayload } from '@/ipc/types';
import { createResourceStore, type ResourceStore } from './resource';

export type Decision = 'approve' | 'reject';

export interface DecisionEntry {
  status: 'pending' | 'confirmed' | 'stale';
  decision: Decision;
}

export interface RemarkInput {
  file: string;
  line: number;
  side: 'old' | 'new';
  text: string;
}

export const REMARK_MAX = 2_000;

export function remarkIsValid(text: string): boolean {
  return text.trim().length > 0 && text.length <= REMARK_MAX;
}

export interface ReviewState {
  spec: string;
  resource: ResourceStore<DiffPayload>;
  decisions: Record<string, DecisionEntry>;
  gate: { status: 'idle' | 'pending' | 'locked' | 'approved' | 'failed'; error?: StudioError };
  staging: { status: 'idle' | 'pending' | 'done' | 'failed'; staged?: number; error?: StudioError };
  decide(hunkId: string, decision: Decision): Promise<void>;
  stageApproved(): Promise<void>;
  approveGate(): Promise<void>;
  addRemark(input: RemarkInput): Promise<void>;
}

interface HunkLocation {
  file: string;
  header: string;
  index: number;
}

function locate(data: DiffPayload | undefined): Map<string, HunkLocation> {
  const where = new Map<string, HunkLocation>();
  for (const file of data?.files ?? [])
    (file.hunks ?? []).forEach((hunk, index) => {
      where.set(hunk.id, { file: file.path, header: hunk.header, index });
    });
  return where;
}

/** Every hunk has a confirmed decision (stale and pending ones still need one). */
export function allDecided(data: DiffPayload | undefined, decisions: Record<string, DecisionEntry>): boolean {
  const ids = [...locate(data).keys()];
  return ids.length > 0 && ids.every(id => decisions[id]?.status === 'confirmed');
}

export function createReviewStore(client: StudioClient, options: { spec: string }) {
  // Without a spec the engine falls back to the active one (`specRef` is optional in the schema).
  const specParam: { spec?: string } = options.spec ? { spec: options.spec } : {};
  const store = createStore<ReviewState>()((set, get) => {
    const resource = createResourceStore<DiffPayload>(() => client.call('diff.get', {}), {
      isEmpty: data => data.files.length === 0,
    });

    return {
      spec: options.spec,
      resource,
      decisions: {},
      gate: { status: 'idle' },
      staging: { status: 'idle' },
      async decide(hunkId, decision) {
        const previous = get().decisions[hunkId];
        set({ decisions: { ...get().decisions, [hunkId]: { status: 'pending', decision } } });
        try {
          await client.call('review.decideHunk', { ...specParam, hunkId, decision });
          set({ decisions: { ...get().decisions, [hunkId]: { status: 'confirmed', decision } } });
        } catch (reason) {
          const { [hunkId]: _attempt, ...rest } = get().decisions;
          set({ decisions: previous ? { ...rest, [hunkId]: previous } : rest });
          throw StudioError.from(reason);
        }
      },
      async stageApproved() {
        set({ staging: { status: 'pending' } });
        try {
          const result = (await client.call('review.stageApproved', specParam)) as { staged?: number };
          set({ staging: { status: 'done', staged: result?.staged ?? 0 } });
        } catch (reason) {
          set({ staging: { status: 'failed', error: StudioError.from(reason) } });
        }
      },
      async approveGate() {
        set({ gate: { status: 'pending' } });
        try {
          await client.call('gate.approve', { ...specParam, gate: 2 });
          set({ gate: { status: 'approved' } });
        } catch (reason) {
          const error = StudioError.from(reason);
          set({ gate: { status: error.kind === 'protected' ? 'locked' : 'failed', error } });
        }
      },
      async addRemark(input) {
        if (!remarkIsValid(input.text)) throw new RangeError('remark text must be 1–2000 characters');
        await client.call('review.addRemark', { ...specParam, ...input });
      },
    };
  });

  // VD-09: after a refresh, decisions of unchanged hunks survive; a hunk whose content changed (same file
  // and header, new id) inherits the old decision as `stale`; vanished hunks drop their decision.
  let known = locate(undefined);
  store.getState().resource.subscribe(state => {
    if (!state.data) return;
    const next = locate(state.data);
    if (next.size === known.size && [...next.keys()].every(id => known.has(id))) return;
    const decisions = store.getState().decisions;
    const reconciled: Record<string, DecisionEntry> = {};
    for (const [id, entry] of Object.entries(decisions)) {
      if (next.has(id)) {
        reconciled[id] = entry;
        continue;
      }
      const old = known.get(id);
      if (!old) continue;
      const successor = [...next].find(
        ([candidate, where]) =>
          !decisions[candidate] &&
          where.file === old.file &&
          (where.header === old.header || where.index === old.index),
      );
      if (successor) reconciled[successor[0]] = { status: 'stale', decision: entry.decision };
    }
    known = next;
    store.setState({ decisions: reconciled, staging: { status: 'idle' } });
  });

  return store;
}

export type ReviewStore = ReturnType<typeof createReviewStore>;
