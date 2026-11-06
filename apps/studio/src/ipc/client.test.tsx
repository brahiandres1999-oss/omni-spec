/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { act, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { createStudioClient, StudioError } from '@/ipc/client';
import { STUDIO_PROTOCOL_VERSION } from '@/ipc/generated';
import { renderWithStudio } from '@/test/render';
import { BoardView } from '@/views/BoardView';
import { FakeTransport } from '@/test/fake-transport';
import { defaultBoard, gateLocked, rpcError, scriptStudio } from '@/test/fixtures';

const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

describe('IC ipc client', () => {
  test('IC-01 generated.ts matches what gen:ipc produces from schema/studio-ipc.schema.json', () => {
    const schema = JSON.parse(readFileSync(`${REPO_ROOT}schema/studio-ipc.schema.json`, 'utf8')) as {
      properties: { protocolVersion: { const: number } };
    };
    const regenerated = execFileSync(process.execPath, [`${APP_ROOT}scripts/gen-ipc-types.mjs`, '--stdout'], {
      cwd: APP_ROOT,
      encoding: 'utf8',
    });
    const committed = readFileSync(`${APP_ROOT}src/ipc/generated.ts`, 'utf8');
    expect(committed, 'src/ipc/generated.ts is stale: run npm run gen:ipc').toBe(regenerated);
    expect(STUDIO_PROTOCOL_VERSION).toBe(schema.properties.protocolVersion.const);
  });

  test('IC-02 engine error codes map to typed StudioError kinds', async () => {
    const fake = new FakeTransport()
      .fail('gate.approve', gateLocked('Quedan 2 hunks sin decidir'))
      .fail('project.snapshot', rpcError('NODE_UNSUPPORTED', 'node v20.11.0 < 22.19.0', false))
      .fail('board.get', rpcError('ENGINE_TIMEOUT', 'board.get timed out after 10000 ms', true));
    const client = createStudioClient(fake);

    const locked: unknown = await client.call('gate.approve', { spec: '001', gate: 2 }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(locked).toBeInstanceOf(StudioError);
    expect(locked).toBeInstanceOf(Error);
    expect(locked).toMatchObject({
      kind: 'protected',
      code: 'GATE_LOCKED',
      detail: 'Quedan 2 hunks sin decidir',
      retryable: false,
    });

    const node: unknown = await client.call('project.snapshot', {}).then(
      () => null,
      (error: unknown) => error,
    );
    expect(node).toMatchObject({ kind: 'error', code: 'NODE_UNSUPPORTED', retryable: false });

    const timeout: unknown = await client.call('board.get', { route: 'standard' }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(timeout).toMatchObject({ kind: 'error', code: 'ENGINE_TIMEOUT', retryable: true });

    // The human message never leaks the opaque code (blueprint §4.7.3 Error state).
    for (const error of [locked, node, timeout]) {
      expect(error).toBeInstanceOf(StudioError);
      const { message, code } = error as { message: string; code: string };
      expect(message.trim().length).toBeGreaterThan(0);
      expect(message).not.toContain(code);
    }
  });

  test('IC-03 project.changed invalidates only the affected keys and leaves no listener behind', async () => {
    const fake = scriptStudio(new FakeTransport());
    const client = createStudioClient(fake);
    const onBoard = vi.fn();
    const onGraph = vi.fn();
    const stopBoard = client.watch(['board'], onBoard);
    const stopGraph = client.watch(['graph'], onGraph);

    fake.emit('project.changed', { areas: ['board', 'diff'] });
    expect(onBoard).toHaveBeenCalledTimes(1);
    expect(onGraph).not.toHaveBeenCalled();
    fake.emit('project.changed', { areas: ['graph'] });
    expect(onBoard).toHaveBeenCalledTimes(1);
    expect(onGraph).toHaveBeenCalledTimes(1);

    stopBoard();
    stopGraph();
    expect(fake.listenerCount()).toBe(0);

    // Same contract through a mounted view: it refetches on its area and unsubscribes on unmount.
    const view = renderWithStudio(<BoardView />, { transport: fake });
    await waitFor(() => expect(fake.calls('board.get')).toHaveLength(1));
    act(() => {
      fake.emit('project.changed', { areas: ['graph'] });
      fake.emit('project.changed', { areas: ['board'] });
    });
    await waitFor(() => expect(fake.calls('board.get')).toHaveLength(2));
    view.unmount();
    expect(fake.listenerCount()).toBe(0);
  });

  test('IC-04 two identical reads in flight share one invocation; mutations are never deduplicated', async () => {
    const fake = new FakeTransport();
    const slot = fake.defer('board.get');
    const client = createStudioClient(fake);
    const payload = defaultBoard('standard');

    const first = client.call('board.get', { route: 'standard' });
    const second = client.call('board.get', { route: 'standard' });
    await vi.waitFor(() => expect(fake.calls('board.get')).toHaveLength(1));
    slot.resolve(payload);
    await expect(first).resolves.toEqual(payload);
    await expect(second).resolves.toEqual(payload);
    expect(fake.calls('board.get')).toHaveLength(1);

    // Settled reads invoke again (in-flight dedup, not a cache); other params are another key.
    fake.respond('board.get', (args: Record<string, unknown>) =>
      defaultBoard(args.route === 'light' ? 'light' : 'standard'),
    );
    await Promise.all([client.call('board.get', { route: 'standard' }), client.call('board.get', { route: 'light' })]);
    expect(fake.calls('board.get')).toHaveLength(3);

    fake.respond('review.decideHunk', { ok: true });
    await Promise.all([
      client.call('review.decideHunk', { spec: '001', hunkId: 'h', decision: 'approve' }),
      client.call('review.decideHunk', { spec: '001', hunkId: 'h', decision: 'approve' }),
    ]);
    expect(fake.calls('review.decideHunk')).toHaveLength(2);
  });
});
