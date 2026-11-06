import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { renderWithStudio } from '@/test/render';
import { FinopsView } from '@/views/FinopsView';
import { FakeTransport } from '@/test/fake-transport';
import { BREAKER_LIMITS, finops, finopsTask, installLayoutStub, scriptStudio } from '@/test/fixtures';

/** FinOps contract: root `[data-view="finops"]`; one row per breaker task `[data-task-id="<id>"]`. */
let restoreLayout: () => void = () => undefined;
beforeEach(() => {
  restoreLayout = installLayoutStub();
});
afterEach(() => restoreLayout());

async function readyFinops(): Promise<HTMLElement> {
  return waitFor(() => {
    const root = document.querySelector<HTMLElement>('[data-view="finops"][data-state="ready"]');
    if (!root) throw new Error('finops never became ready');
    return root;
  });
}

function taskRow(id: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`[data-task-id="${id}"]`);
  if (!row) throw new Error(`task row ${id} is not rendered`);
  return row;
}

describe('VF finops view', () => {
  test('VF-01 tokens/s meter shows the value and a 60 s sparkline', async () => {
    const fake = scriptStudio(new FakeTransport());
    renderWithStudio(<FinopsView />, { transport: fake });
    const root = await readyFinops();
    const value = within(root).getByText('142 t/s');
    expect(value).toHaveClass('font-mono', 'tabular-nums');
    const sparkline = within(root).getByRole('img', { name: /60 s/ });
    expect(sparkline).toHaveAttribute('data-window-seconds', '60');

    act(() => fake.emit('finops.tick', finops({ tokensPerSecond: 37 })));
    expect(await within(root).findByText('37 t/s')).toBeInTheDocument();
  });

  test('VF-02 the breaker budget bar shows used and remaining with exact numbers', async () => {
    const fake = scriptStudio(new FakeTransport());
    renderWithStudio(<FinopsView />, { transport: fake });
    await readyFinops();
    const row = taskRow('T-1');
    const meter = within(row).getByRole('meter', { name: 'Presupuesto T-1' });
    expect(meter).toHaveAttribute('aria-valuenow', '20000');
    expect(meter).toHaveAttribute('aria-valuemax', String(BREAKER_LIMITS.tokenBudget));
    expect(row.textContent).toContain('20.000');
    expect(row.textContent).toContain('60.000');
  });

  test('VF-03 the 25k/min rate window shows its headroom', async () => {
    const fake = scriptStudio(new FakeTransport());
    renderWithStudio(<FinopsView />, { transport: fake });
    await readyFinops();
    const row = taskRow('T-1');
    const meter = within(row).getByRole('meter', { name: 'Ventana de tasa T-1' });
    expect(meter).toHaveAttribute('aria-valuemax', String(BREAKER_LIMITS.maxTokensPerWindow));
    expect(meter).toHaveAttribute('aria-valuenow', '20000');
    expect(row.textContent).toMatch(/(^|[^\d.])5\.000/);
    expect(row.textContent).toMatch(/25\.000\s*\/\s*min/);
  });

  test('VF-04 per-task badges cover the 4 breaker states and show the reason when OPEN', async () => {
    const fake = scriptStudio(new FakeTransport()).respond(
      'finops.snapshot',
      finops({
        tasks: [
          finopsTask({ taskId: 'T-1', state: 'CLOSED' }),
          finopsTask({ taskId: 'T-2', state: 'HALF_OPEN' }),
          finopsTask({ taskId: 'T-3', state: 'OPEN', reason: 'TOKEN_BUDGET_EXCEEDED', remainingBudget: 0 }),
          finopsTask({ taskId: 'T-4', state: 'DEAD_LETTER' }),
        ],
      }),
    );
    renderWithStudio(<FinopsView />, { transport: fake });
    await readyFinops();
    for (const [id, state] of [
      ['T-1', 'CLOSED'],
      ['T-2', 'HALF_OPEN'],
      ['T-3', 'OPEN'],
      ['T-4', 'DEAD_LETTER'],
    ] as const) {
      const badge = taskRow(id).querySelector<HTMLElement>('[data-breaker-state]');
      expect(badge, id).not.toBeNull();
      expect(badge).toHaveAttribute('data-breaker-state', state);
      expect(badge?.textContent?.trim().length).toBeGreaterThan(0);
    }
    const reason = taskRow('T-3').querySelector<HTMLElement>('[data-reason="TOKEN_BUDGET_EXCEEDED"]');
    expect(reason).not.toBeNull();
    expect(reason?.textContent?.trim().length).toBeGreaterThan(0);
    for (const id of ['T-1', 'T-2', 'T-4']) expect(taskRow(id).querySelector('[data-reason]')).toBeNull();
  });

  test('VF-05 the credential source label', async () => {
    const cases = [
      [{ kind: 'passthrough', provider: 'claude' }, 'Suscripción delegada'],
      [{ kind: 'byok', provider: 'anthropic' }, 'API Key (DPAPI)'],
      [{ kind: 'local', provider: 'ollama', costPerToken: 0 }, 'Ollama local · $0'],
    ] as const;
    for (const [credentialSource, label] of cases) {
      const fake = scriptStudio(new FakeTransport()).respond('finops.snapshot', finops({ credentialSource }));
      const view = renderWithStudio(<FinopsView />, { transport: fake });
      const root = await readyFinops();
      expect(within(root).getByText(label)).toBeInTheDocument();
      view.unmount();
    }
  });

  test('VF-06 no events is an explicit idle state, not Empty with a CTA', async () => {
    const fake = scriptStudio(new FakeTransport()).respond(
      'finops.snapshot',
      finops({ stream: 'idle', tokensPerSecond: 0, session: { tokens: 0 }, tasks: [] }),
    );
    renderWithStudio(<FinopsView />, { transport: fake });
    const root = await readyFinops();
    expect(root.querySelector('[data-stream="idle"]')).not.toBeNull();
    expect(within(root).getByText('0 t/s')).toBeInTheDocument();
    expect(document.querySelector('[data-view="finops"][data-state="empty"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Abrir Terminal' })).toBeNull();
  });
});
