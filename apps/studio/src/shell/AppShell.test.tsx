import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AppShell } from '@/shell/AppShell';
import { renderWithStudio } from '@/test/render';
import { FakeTransport } from '@/test/fake-transport';
import { defaultBoard, installLayoutStub, scriptStudio, stubCanvas, stubWorker } from '@/test/fixtures';

let restoreLayout: () => void = () => undefined;
beforeEach(() => {
  restoreLayout = installLayoutStub();
  stubCanvas();
  stubWorker();
});
afterEach(() => {
  vi.unstubAllGlobals();
  restoreLayout();
});

const STAGE_TABS = ['Kanban', 'Cartografía', 'Diffs', 'FinOps', 'Skills'];

function stageTabs(): HTMLElement {
  return screen.getByRole('tablist', { name: 'Vistas' });
}

function selectedStageTab(): string | null {
  const selected = within(stageTabs())
    .getAllByRole('tab')
    .find(tab => tab.getAttribute('aria-selected') === 'true');
  return selected?.textContent?.trim() ?? null;
}

function viewState(name: string): string | null {
  return document.querySelector<HTMLElement>(`[data-view="${name}"]`)?.dataset.state ?? null;
}

async function mountShell(fake = scriptStudio(new FakeTransport())) {
  const user = userEvent.setup();
  const view = renderWithStudio(<AppShell />, { transport: fake });
  await waitFor(() => expect(viewState('board')).toBe('ready'));
  return { fake, user, view };
}

describe('SH three-column shell', () => {
  test('SH-01 four landmark regions; the dock floats over the stage', async () => {
    await mountShell();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Proyectos' })).toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(screen.getByRole('complementary', { name: 'Inspector' })).toBeInTheDocument();
    const dock = screen.getByRole('region', { name: 'Dock' });
    expect(main).toContainElement(dock);
    expect([...dock.classList].some(name => name === 'absolute' || name === 'fixed')).toBe(true);
  });

  test('SH-02 the Inspector collapses with its button and Ctrl+J, motion-safe only, and the state persists', async () => {
    const { fake, user, view } = await mountShell();
    const shell = () => {
      const element = document.querySelector<HTMLElement>('[data-inspector]');
      if (!element) throw new Error('the shell root must expose data-inspector');
      return element;
    };
    const toggle = () => screen.getByRole('button', { name: 'Alternar Inspector' });
    expect(shell()).toHaveAttribute('data-inspector', 'expanded');
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');

    await user.click(toggle());
    expect(shell()).toHaveAttribute('data-inspector', 'collapsed');
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');

    const motionTokens = [shell(), document.querySelector<HTMLElement>('aside, [role="complementary"]')]
      .flatMap(element => [...(element?.classList ?? [])])
      .filter(name => /(^|:)(transition|duration-|ease-|animate-)/.test(name));
    expect(motionTokens.some(name => name.startsWith('motion-safe:transition'))).toBe(true);
    for (const name of motionTokens) expect(name, name).toMatch(/^motion-safe:/);

    view.unmount();
    renderWithStudio(<AppShell />, { transport: fake });
    await waitFor(() => expect(shell()).toHaveAttribute('data-inspector', 'collapsed'));

    await user.keyboard('{Control>}j{/Control}');
    expect(shell()).toHaveAttribute('data-inspector', 'expanded');
  });

  test('SH-05 switching project from the rail calls project.open, resets the stores and shows Loading', async () => {
    const { fake, user } = await mountShell();
    const rail = screen.getByRole('navigation', { name: 'Proyectos' });
    const pendingBoard = fake.defer('board.get');

    await user.click(within(rail).getByRole('button', { name: /omnipage/ }));
    expect(fake.lastCall('project.open')).toEqual({ path: 'C:/dev/omnipage' });
    await waitFor(() => expect(viewState('board')).toBe('loading'));

    act(() => pendingBoard.resolve(defaultBoard('standard')));
    await waitFor(() => expect(viewState('board')).toBe('ready'));
    expect(fake.calls('board.get').length).toBeGreaterThanOrEqual(2);
  });

  test('SH-07 stage tabs switch with Ctrl+1…Ctrl+5 and the active tab persists', async () => {
    const { fake, user, view } = await mountShell();
    expect(
      within(stageTabs())
        .getAllByRole('tab')
        .map(tab => tab.textContent?.trim()),
    ).toEqual(STAGE_TABS);
    expect(selectedStageTab()).toBe('Kanban');

    for (const [key, name] of [
      ['2', 'Cartografía'],
      ['5', 'Skills'],
      ['3', 'Diffs'],
      ['1', 'Kanban'],
      ['4', 'FinOps'],
    ] as const) {
      await user.keyboard(`{Control>}${key}{/Control}`);
      expect(selectedStageTab(), `Ctrl+${key}`).toBe(name);
    }

    view.unmount();
    renderWithStudio(<AppShell />, { transport: fake });
    await waitFor(() => expect(selectedStageTab()).toBe('FinOps'));
  });

  test('SH-10 Ctrl+K opens a modal palette with fuzzy search; Esc closes it and restores focus', async () => {
    const { user } = await mountShell();
    const origin = within(stageTabs()).getByRole('tab', { name: 'Kanban' });
    act(() => origin.focus());

    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const search = within(dialog).getByRole('combobox');
    const optionNames = () =>
      within(dialog)
        .queryAllByRole('option')
        .map(option => option.textContent ?? '');

    for (const [query, expected] of [
      ['crtg', 'Cartografía'], // view
      ['mmry', '001-memory'], // spec
      ['apptxt', 'src/app.txt'], // file (files.tree)
      ['nueva', 'Nueva Spec'], // action
    ] as const) {
      await user.clear(search);
      await user.type(search, query);
      await waitFor(() =>
        expect(
          optionNames().some(name => name.includes(expected)),
          `${query} → ${expected}`,
        ).toBe(true),
      );
    }

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(origin);
  });
});
