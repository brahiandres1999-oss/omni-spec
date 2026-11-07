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

/** The page the stage shows, as the breadcrumb says it («Proyecto / Specs»). */
function currentPage(): string | null {
  const crumb = screen.getByRole('navigation', { name: 'Ruta de la página' });
  return crumb.querySelector('[aria-current="page"]')?.textContent?.trim() ?? null;
}

function pageButton(name: string): HTMLElement {
  const rail = screen.getByRole('navigation', { name: 'Conversaciones y proyectos' });
  return within(within(rail).getByRole('list', { name: 'Páginas' })).getByRole('button', { name });
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
  test('SH-01 four landmark regions and no dock: the stage shows one page', async () => {
    await mountShell();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Conversaciones y proyectos' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Resumen' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Dock' })).toBeNull();
    expect(screen.queryByRole('tablist', { name: 'Vistas' })).toBeNull();
    expect(currentPage()).toBe('Specs');
  });

  test('SH-02 the Resumen panel folds with its button and Ctrl+J, the rail with Ctrl+B, motion-safe only, and both persist', async () => {
    const { fake, user, view } = await mountShell();
    const shell = () => {
      const element = document.querySelector<HTMLElement>('[data-inspector]');
      if (!element) throw new Error('the shell root must expose data-inspector');
      return element;
    };
    const toggle = () => screen.getByRole('button', { name: 'Mostrar u ocultar el panel Resumen' });
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

    expect(shell()).toHaveAttribute('data-rail', 'expanded');
    await user.keyboard('{Control>}b{/Control}');
    expect(shell()).toHaveAttribute('data-rail', 'collapsed');
    expect(screen.queryByRole('navigation', { name: 'Conversaciones y proyectos' })).toBeNull();
    await user.keyboard('{Control>}b{/Control}');
    expect(shell()).toHaveAttribute('data-rail', 'expanded');
  });

  test('SH-05 switching project from the rail calls project.open, resets the stores and shows Loading', async () => {
    const { fake, user } = await mountShell();
    const rail = screen.getByRole('navigation', { name: 'Conversaciones y proyectos' });
    const pendingBoard = fake.defer('board.get');

    await user.click(within(rail).getByRole('button', { name: 'omnipage' }));
    expect(fake.lastCall('project.open')).toEqual({ path: 'C:/dev/omnipage' });
    await waitFor(() => expect(viewState('board')).toBe('loading'));

    act(() => pendingBoard.resolve(defaultBoard('standard')));
    await waitFor(() => expect(viewState('board')).toBe('ready'));
    expect(fake.calls('board.get').length).toBeGreaterThanOrEqual(2);
  });

  test('SH-07 the rail opens the pages Specs, Memoria and Uso; the page persists', async () => {
    const { fake, user, view } = await mountShell();
    expect(pageButton('Specs')).toHaveAttribute('aria-current', 'page');

    await user.click(pageButton('Memoria'));
    expect(currentPage()).toBe('Memoria');
    expect(screen.getByRole('region', { name: 'Memoria' })).toBeInTheDocument();
    await user.click(pageButton('Uso'));
    expect(currentPage()).toBe('Uso');
    expect(pageButton('Uso')).toHaveAttribute('aria-current', 'page');

    view.unmount();
    renderWithStudio(<AppShell />, { transport: fake });
    await waitFor(() => expect(currentPage()).toBe('Uso'));
  });

  test('SH-10 Ctrl+K opens a modal palette with fuzzy search; Esc closes it and restores focus', async () => {
    const { user } = await mountShell();
    const origin = pageButton('Specs');
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
