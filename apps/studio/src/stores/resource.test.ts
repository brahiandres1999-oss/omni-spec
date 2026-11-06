import { describe, expect, test, vi } from 'vitest';
import { createStudioClient } from '@/ipc/client';
import { createResourceStore, IllegalTransitionError, type ResourceStatus, transition } from '@/stores/resource';
import { FakeTransport } from '@/test/fake-transport';
import { board, defaultBoard, finops, gateLocked, rpcError } from '@/test/fixtures';

/** Records every status the store goes through, starting with the current one. */
function statuses(store: {
  getState(): { status: ResourceStatus };
  subscribe(listener: (state: { status: ResourceStatus }) => void): () => void;
}) {
  const seen: ResourceStatus[] = [store.getState().status];
  store.subscribe(state => {
    if (seen[seen.length - 1] !== state.status) seen.push(state.status);
  });
  return seen;
}

describe('ST resource store (4-state machine)', () => {
  test('ST-01 idle → loading → ready | empty | error | protected, and illegal transitions throw', async () => {
    const fake = new FakeTransport()
      .respondOnce('board.get', defaultBoard())
      .respondOnce('board.get', board('standard', []))
      .failOnce('board.get', rpcError('ENGINE_TIMEOUT', 'board.get timed out after 10000 ms', true))
      .failOnce('board.get', gateLocked('Compuerta 2 sin atestación'));
    const client = createStudioClient(fake);
    const fetchBoard = () => client.call('board.get', { route: 'standard' });
    const isEmpty = (data: unknown) =>
      (data as { lanes: Array<{ cards: unknown[] }> }).lanes.every(lane => lane.cards.length === 0);

    const expected: Array<[ResourceStatus, ResourceStatus[]]> = [
      ['ready', ['idle', 'loading', 'ready']],
      ['empty', ['idle', 'loading', 'empty']],
      ['error', ['idle', 'loading', 'error']],
      ['protected', ['idle', 'loading', 'protected']],
    ];
    for (const [outcome, path] of expected) {
      const store = createResourceStore(fetchBoard, { isEmpty });
      const seen = statuses(store);
      await store.getState().load();
      expect(seen, outcome).toEqual(path);
      if (outcome === 'ready') expect(store.getState().data).toEqual(defaultBoard());
      if (outcome === 'error') expect(store.getState().error).toMatchObject({ kind: 'error', code: 'ENGINE_TIMEOUT' });
      if (outcome === 'protected')
        expect(store.getState().error).toMatchObject({ kind: 'protected', code: 'GATE_LOCKED' });
    }

    // The pure transition table is fail-fast.
    expect(transition('idle', 'loading')).toBe('loading');
    for (const to of ['ready', 'empty', 'error', 'protected'] as const) expect(transition('loading', to)).toBe(to);
    expect(() => transition('idle', 'ready')).toThrow(IllegalTransitionError);
    expect(() => transition('idle', 'error')).toThrow(IllegalTransitionError);
    expect(() => transition('loading', 'idle')).toThrow(IllegalTransitionError);
    expect(() => transition('ready', 'idle')).toThrow(IllegalTransitionError);

    // retry() only exists from error: calling it on a ready store is an illegal transition.
    fake.respond('board.get', defaultBoard());
    const ready = createResourceStore(fetchBoard, { isEmpty });
    await ready.getState().load();
    await expect(Promise.resolve().then(() => ready.getState().retry())).rejects.toBeInstanceOf(IllegalTransitionError);
  });

  test('ST-02 retry from error repeats only the failed request and leaves the rest of the session intact', async () => {
    const fake = new FakeTransport()
      .failOnce('board.get', rpcError('ENGINE_TIMEOUT', 'board.get timed out after 10000 ms', true))
      .respond('board.get', defaultBoard())
      .respond('finops.snapshot', finops());
    const client = createStudioClient(fake);
    const boardFetcher = vi.fn(() => client.call('board.get', { route: 'standard' }));
    const finopsFetcher = vi.fn(() => client.call('finops.snapshot', {}));
    const boardStore = createResourceStore(boardFetcher);
    const finopsStore = createResourceStore(finopsFetcher);

    await Promise.all([boardStore.getState().load(), finopsStore.getState().load()]);
    expect(boardStore.getState().status).toBe('error');
    expect(finopsStore.getState().status).toBe('ready');
    const finopsData = finopsStore.getState().data;

    await boardStore.getState().retry();
    expect(boardStore.getState().status).toBe('ready');
    expect(boardFetcher).toHaveBeenCalledTimes(2);
    expect(finopsFetcher).toHaveBeenCalledTimes(1);
    expect(fake.calls('finops.snapshot')).toHaveLength(1);
    expect(finopsStore.getState().data).toBe(finopsData);
    expect(finopsStore.getState().status).toBe('ready');
  });

  test('ST-03 a refresh after project.changed keeps ready data visible while revalidating (no flash to loading)', async () => {
    const fake = new FakeTransport().respondOnce('board.get', defaultBoard('standard'));
    const client = createStudioClient(fake);
    const store = createResourceStore(() => client.call('board.get', { route: 'standard' }));
    await store.getState().load();
    const before = store.getState().data;
    const stop = client.watch(['board'], () => {
      void store.getState().refresh();
    });

    const seen = statuses(store);
    const slot = fake.defer('board.get');
    fake.emit('project.changed', { areas: ['board'] });
    await vi.waitFor(() => expect(store.getState().revalidating).toBe(true));
    expect(store.getState().status).toBe('ready');
    expect(store.getState().data).toBe(before);

    const next = defaultBoard('light');
    slot.resolve(next);
    await vi.waitFor(() => expect(store.getState().revalidating).toBe(false));
    expect(store.getState().data).toEqual(next);
    expect(seen).toEqual(['ready']);
    stop();
    expect(fake.listenerCount()).toBe(0);
  });
});
