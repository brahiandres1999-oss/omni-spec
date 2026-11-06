import { act, screen } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createStudioClient, StudioError } from '@/ipc/client';
import { createBoardStore } from '@/stores/board';
import { createLayoutStore } from '@/stores/layout';
import { createReviewStore } from '@/stores/review';
import { createTerminalStore } from '@/stores/terminal';
import { renderWithStudio } from '@/test/render';
import { BoardView } from '@/views/BoardView';
import { FinopsView } from '@/views/FinopsView';
import { FakeTransport } from '@/test/fake-transport';
import { finops, hunkId, installLayoutStub, rpcError, scriptStudio } from '@/test/fixtures';

let restoreLayout: () => void = () => undefined;
beforeEach(() => {
  restoreLayout = installLayoutStub();
});
afterEach(() => {
  vi.useRealTimers();
  restoreLayout();
});

describe('ST domain stores', () => {
  test('ST-04 board filters persist per project in localStorage', () => {
    const client = createStudioClient(scriptStudio(new FakeTransport()));
    const alpha = createBoardStore(client, { projectId: 'C:/dev/omni-spec' });
    expect(alpha.getState().filters).toEqual({ tags: [], risk: [], owner: [] });

    alpha.getState().setFilters({ tags: ['ui'], risk: ['high'] });
    expect(alpha.getState().filters).toEqual({ tags: ['ui'], risk: ['high'], owner: [] });
    expect(localStorage.length).toBeGreaterThan(0);

    const reopened = createBoardStore(client, { projectId: 'C:/dev/omni-spec' });
    expect(reopened.getState().filters).toEqual({ tags: ['ui'], risk: ['high'], owner: [] });
    const otherProject = createBoardStore(client, { projectId: 'C:/dev/omnipage' });
    expect(otherProject.getState().filters).toEqual({ tags: [], risk: [], owner: [] });
  });

  test('ST-05 hunk decisions stay pending until the server confirms; no optimistic updates', async () => {
    const fake = new FakeTransport();
    const client = createStudioClient(fake);
    const store = createReviewStore(client, { spec: '001' });
    const approved = hunkId('src/app.txt:1');
    const rejected = hunkId('src/app.txt:2');

    const slot = fake.defer('review.decideHunk');
    const deciding = store.getState().decide(approved, 'approve');
    await vi.waitFor(() => expect(fake.calls('review.decideHunk')).toHaveLength(1));
    expect(fake.lastCall('review.decideHunk')).toMatchObject({ spec: '001', hunkId: approved, decision: 'approve' });
    expect(store.getState().decisions[approved]).toEqual({ status: 'pending', decision: 'approve' });

    slot.resolve({ hunkId: approved, decision: 'approve' });
    await deciding;
    expect(store.getState().decisions[approved]).toEqual({ status: 'confirmed', decision: 'approve' });

    // A server refusal leaves no trace of the attempted decision.
    fake.failOnce('review.decideHunk', rpcError('HUNK_STALE', 'the working tree changed', true));
    await expect(store.getState().decide(rejected, 'reject')).rejects.toBeInstanceOf(StudioError);
    expect(store.getState().decisions[rejected]).toBeUndefined();
    expect(store.getState().decisions[approved]).toEqual({ status: 'confirmed', decision: 'approve' });
  });

  test('ST-06 20 Hz FinOps ticks render the FinOps view at most at 4 Hz and never re-render the board', async () => {
    const fake = scriptStudio(new FakeTransport());
    const commits = { finops: 0, board: 0 };
    renderWithStudio(
      <>
        <Profiler id="finops" onRender={() => commits.finops++}>
          <FinopsView />
        </Profiler>
        <Profiler id="board" onRender={() => commits.board++}>
          <BoardView />
        </Profiler>
      </>,
      { transport: fake },
    );
    await screen.findByText('142 t/s');
    expect(document.querySelector('[data-view="board"][data-state="ready"]')).not.toBeNull();

    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'Date',
      ],
    });
    const before = { ...commits };
    // 40 ticks at 20 Hz = 2 s of telemetry.
    for (let tick = 1; tick <= 40; tick++) {
      act(() => {
        fake.emit('finops.tick', finops({ tokensPerSecond: 100 + tick }));
        vi.advanceTimersByTime(50);
      });
    }
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    const finopsRenders = commits.finops - before.finops;
    expect(finopsRenders).toBeGreaterThan(0);
    expect(finopsRenders).toBeLessThanOrEqual(2 * 4 + 1);
    expect(commits.board - before.board).toBe(0);
    // The trailing tick is never lost.
    expect(screen.getByText('140 t/s')).toBeInTheDocument();
  });

  test('ST-07 terminal sessions live in a map; closing one releases its subscription', async () => {
    const fake = new FakeTransport()
      .respondOnce('pty.open', { id: 'pty-1' })
      .respondOnce('pty.open', { id: 'pty-2' })
      .respond('pty.close', null);
    const client = createStudioClient(fake);
    const store = createTerminalStore(client);

    expect(await store.getState().open({ cols: 120, rows: 30 })).toBe('pty-1');
    expect(await store.getState().open({ cols: 120, rows: 30 })).toBe('pty-2');
    expect(Object.keys(store.getState().sessions).sort()).toEqual(['pty-1', 'pty-2']);
    const listenersWithTwo = fake.listenerCount();
    expect(listenersWithTwo).toBeGreaterThan(0);

    await store.getState().close('pty-1');
    expect(fake.lastCall('pty.close')).toEqual({ id: 'pty-1' });
    expect(Object.keys(store.getState().sessions)).toEqual(['pty-2']);
    expect(fake.listenerCount()).toBeLessThan(listenersWithTwo);

    // The surviving session still receives its exit code (CP-11).
    fake.emit('pty.exit', { id: 'pty-2', code: 0 });
    expect(store.getState().sessions['pty-2']).toMatchObject({ status: 'exited', exitCode: 0 });

    await store.getState().close('pty-2');
    expect(store.getState().sessions).toEqual({});
    expect(fake.listenerCount()).toBe(0);
  });

  test('ST-08 inspector collapse, inspector tab and stage tab persist per user in localStorage', () => {
    const layout = createLayoutStore();
    layout.getState().toggleInspector();
    const collapsed = layout.getState().inspectorCollapsed;
    layout.getState().setInspectorTab('files');
    layout.getState().setStageTab('skills');
    expect(localStorage.length).toBeGreaterThan(0);

    const reopened = createLayoutStore();
    expect(reopened.getState()).toMatchObject({
      inspectorCollapsed: collapsed,
      inspectorTab: 'files',
      stageTab: 'skills',
    });
    reopened.getState().toggleInspector();
    expect(createLayoutStore().getState().inspectorCollapsed).toBe(!collapsed);
  });
});
