import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { renderWithStudio } from '@/test/render';
import { DiffView } from '@/views/DiffView';
import { FakeTransport } from '@/test/fake-transport';
import {
  bigFile,
  binaryFile,
  diff,
  GATE2_TEXT,
  gateLocked,
  installLayoutStub,
  scriptStudio,
  threeHunkFile,
} from '@/test/fixtures';

/**
 * Diff contract: root `[data-view="diff"]`, scroll container `[data-scroll-region="diff"]`, one element per
 * rendered code line `[data-diff-line]`, per-file `[data-diff-file="<path>"]`, per-hunk header
 * `[data-hunk-id="<id>"]` (focusable, `data-decision` = undecided | pending | approve | reject | stale).
 */
let restoreLayout: () => void = () => undefined;
beforeEach(() => {
  restoreLayout = installLayoutStub();
});
afterEach(() => restoreLayout());

async function readyDiff(): Promise<HTMLElement> {
  return waitFor(() => {
    const root = document.querySelector<HTMLElement>('[data-view="diff"][data-state="ready"]');
    if (!root) throw new Error('diff never became ready');
    return root;
  });
}

function hunk(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-hunk-id="${id}"]`);
  if (!element) throw new Error(`hunk ${id.slice(0, 8)} is not rendered`);
  return element;
}

const base = threeHunkFile();
const hunkIds = (base.hunks ?? []).map(entry => entry.id);
const [H1 = '', H2 = '', H3 = ''] = hunkIds;

describe('VD diff view', () => {
  test('VD-01 a 10.000-line diff keeps ≤ 200 code rows in the DOM (virtualization PoC, D-6)', async () => {
    const fake = scriptStudio(new FakeTransport()).respond('diff.get', diff([bigFile(10_000)]));
    renderWithStudio(<DiffView spec="001" />, { transport: fake });
    const root = await readyDiff();
    const rows = root.querySelectorAll('[data-diff-line]').length;
    expect(rows).toBeGreaterThan(0);
    expect(rows).toBeLessThanOrEqual(200);
    expect(root.textContent).toContain('edited 1');
  });

  test('VD-02 switching unified ↔ side-by-side keeps the scroll position', async () => {
    const fake = scriptStudio(new FakeTransport()).respond('diff.get', diff([bigFile(2_000)]));
    const user = userEvent.setup();
    renderWithStudio(<DiffView spec="001" />, { transport: fake });
    const root = await readyDiff();
    const mode = within(root).getByRole('radiogroup', { name: 'Modo de vista' });
    expect(within(mode).getByRole('radio', { name: 'Unificado' })).toHaveAttribute('aria-checked', 'true');

    const scroller = () => {
      const element = document.querySelector<HTMLElement>('[data-scroll-region="diff"]');
      if (!element) throw new Error('missing [data-scroll-region="diff"]');
      return element;
    };
    act(() => {
      scroller().scrollTop = 4_000;
      fireEvent.scroll(scroller());
    });
    await user.click(within(mode).getByRole('radio', { name: 'Lado a lado' }));
    expect(within(mode).getByRole('radio', { name: 'Lado a lado' })).toHaveAttribute('aria-checked', 'true');
    expect(scroller().scrollTop).toBe(4_000);
    await user.click(within(mode).getByRole('radio', { name: 'Unificado' }));
    expect(scroller().scrollTop).toBe(4_000);
  });

  test('VD-03 approve and reject per hunk, by button and with the a / r shortcuts', async () => {
    const fake = scriptStudio(new FakeTransport()).respond('diff.get', diff([base]));
    const user = userEvent.setup();
    renderWithStudio(<DiffView spec="001" />, { transport: fake });
    await readyDiff();

    await user.click(within(hunk(H1)).getByRole('button', { name: 'Aprobar hunk' }));
    expect(fake.lastCall('review.decideHunk')).toMatchObject({ spec: '001', hunkId: H1, decision: 'approve' });
    await user.click(within(hunk(H2)).getByRole('button', { name: 'Rechazar hunk' }));
    expect(fake.lastCall('review.decideHunk')).toMatchObject({ spec: '001', hunkId: H2, decision: 'reject' });

    act(() => hunk(H3).focus());
    await user.keyboard('a');
    expect(fake.lastCall('review.decideHunk')).toMatchObject({ hunkId: H3, decision: 'approve' });
    await user.keyboard('r');
    expect(fake.lastCall('review.decideHunk')).toMatchObject({ hunkId: H3, decision: 'reject' });
    expect(fake.calls('review.decideHunk')).toHaveLength(4);
    await waitFor(() => expect(hunk(H3)).toHaveAttribute('data-decision', 'reject'));
  });

  test('VD-04 "Preparar hunks aprobados" stays disabled until every hunk is decided', async () => {
    const fake = scriptStudio(new FakeTransport())
      .respond('diff.get', diff([base]))
      .respond('review.stageApproved', { staged: 2 });
    const user = userEvent.setup();
    renderWithStudio(<DiffView spec="001" />, { transport: fake });
    const root = await readyDiff();
    const stage = () => within(root).getByRole('button', { name: 'Preparar hunks aprobados' });
    expect(stage()).toBeDisabled();

    await user.click(within(hunk(H1)).getByRole('button', { name: 'Aprobar hunk' }));
    await user.click(within(hunk(H2)).getByRole('button', { name: 'Rechazar hunk' }));
    await waitFor(() => expect(hunk(H2)).toHaveAttribute('data-decision', 'reject'));
    expect(stage()).toBeDisabled();
    await user.click(within(hunk(H3)).getByRole('button', { name: 'Aprobar hunk' }));
    await waitFor(() => expect(stage()).toBeEnabled());

    await user.click(stage());
    expect(fake.lastCall('review.stageApproved')).toMatchObject({ spec: '001' });
  });

  test('VD-05 selecting a line and writing a correction calls review.addRemark with file, line and side', async () => {
    const fake = scriptStudio(new FakeTransport()).respond('diff.get', diff([base]));
    const user = userEvent.setup();
    renderWithStudio(<DiffView spec="001" />, { transport: fake });
    await readyDiff();

    await user.click(screen.getByRole('button', { name: 'Comentar línea nueva 30' }));
    const text = 'Extrae esta lógica a un helper puro';
    await user.type(screen.getByRole('textbox', { name: 'Corrección' }), text);
    await user.click(screen.getByRole('button', { name: 'Enviar corrección' }));
    expect(fake.lastCall('review.addRemark')).toEqual(
      expect.objectContaining({ spec: '001', file: 'src/app.txt', line: 30, side: 'new', text }),
    );
  });

  test('VD-06 an empty or > 2.000-character correction is rejected inline (like RV-13)', async () => {
    const fake = scriptStudio(new FakeTransport()).respond('diff.get', diff([base]));
    const user = userEvent.setup();
    renderWithStudio(<DiffView spec="001" />, { transport: fake });
    await readyDiff();

    await user.click(screen.getByRole('button', { name: 'Comentar línea nueva 30' }));
    const box = screen.getByRole('textbox', { name: 'Corrección' });
    await user.type(box, '   ');
    await user.click(screen.getByRole('button', { name: 'Enviar corrección' }));
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/2\.000 caracteres/)).toBeInTheDocument();

    await user.clear(box);
    await user.click(box);
    await user.paste('x'.repeat(2_001));
    await user.click(screen.getByRole('button', { name: 'Enviar corrección' }));
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(fake.calls('review.addRemark')).toHaveLength(0);

    await user.clear(box);
    await user.click(box);
    await user.paste('x'.repeat(2_000));
    await user.click(screen.getByRole('button', { name: 'Enviar corrección' }));
    expect(fake.calls('review.addRemark')).toHaveLength(1);
  });

  test('VD-07 a locked Gate 2 shows the Protected banner with the exact blueprint text', async () => {
    const reason = 'La verificación no tiene atestación HMAC válida';
    const fake = scriptStudio(new FakeTransport())
      .respond('diff.get', diff([base]))
      .failOnce('gate.approve', gateLocked(reason));
    const user = userEvent.setup();
    renderWithStudio(<DiffView spec="001" />, { transport: fake });
    const root = await readyDiff();

    await user.click(within(root).getByRole('button', { name: 'Aprobar Compuerta 2' }));
    expect(fake.lastCall('gate.approve')).toMatchObject({ spec: '001', gate: 2 });
    expect(await within(root).findByText(GATE2_TEXT)).toBeInTheDocument();
    expect(within(root).getByText(reason, { exact: false })).toBeInTheDocument();
    expect(within(root).queryByRole('button', { name: 'Aprobar Compuerta 2' })).toBeNull();
  });

  test('VD-08 a binary file renders a "binario, sin vista previa" row', async () => {
    const fake = scriptStudio(new FakeTransport()).respond('diff.get', diff([binaryFile('assets/logo.bin'), base]));
    renderWithStudio(<DiffView spec="001" />, { transport: fake });
    await readyDiff();
    const file = document.querySelector<HTMLElement>('[data-diff-file="assets/logo.bin"]');
    if (!file) throw new Error('binary file is not listed');
    expect(within(file).getByText(/binario, sin vista previa/i)).toBeInTheDocument();
    expect(file.querySelectorAll('[data-diff-line]')).toHaveLength(0);
  });

  test('VD-09 project.changed refreshes the diff: unchanged hunks keep their decision, changed ones become HUNK_STALE', async () => {
    const edited = threeHunkFile('src/app.txt', 'edited-second');
    const [, editedSecond] = edited.hunks ?? [];
    if (!editedSecond) throw new Error('fixture: edited hunk missing');
    const fake = scriptStudio(new FakeTransport())
      .respondOnce('diff.get', diff([base]))
      .respond('diff.get', diff([edited]));
    const user = userEvent.setup();
    renderWithStudio(<DiffView spec="001" />, { transport: fake });
    await readyDiff();

    await user.click(within(hunk(H1)).getByRole('button', { name: 'Aprobar hunk' }));
    await user.click(within(hunk(H2)).getByRole('button', { name: 'Aprobar hunk' }));
    await waitFor(() => expect(hunk(H2)).toHaveAttribute('data-decision', 'approve'));

    act(() => fake.emit('project.changed', { areas: ['diff'] }));
    await waitFor(() => expect(fake.calls('diff.get')).toHaveLength(2));
    await waitFor(() => expect(hunk(editedSecond.id)).toHaveAttribute('data-decision', 'stale'));
    expect(hunk(H1)).toHaveAttribute('data-decision', 'approve');
    expect(hunk(H3)).toHaveAttribute('data-decision', 'undecided');
    expect(document.querySelector(`[data-hunk-id="${H2}"]`)).toBeNull();
  });
});
