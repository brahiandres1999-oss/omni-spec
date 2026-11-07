import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AppShell } from '@/shell/AppShell';
import { renderWithStudio } from '@/test/render';
import { FakeTransport } from '@/test/fake-transport';
import {
  diff,
  fileTree,
  installLayoutStub,
  scriptStudio,
  stubCanvas,
  stubWorker,
  threeHunkFile,
} from '@/test/fixtures';

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

const inspectorTabs = () => within(screen.getByRole('complementary', { name: 'Resumen' })).getByRole('tablist');

async function openInspectorTab(user: ReturnType<typeof userEvent.setup>, name: string): Promise<HTMLElement> {
  const tab = within(inspectorTabs()).getByRole('tab', { name });
  await user.click(tab);
  const panelId = tab.getAttribute('aria-controls');
  return waitFor(() => {
    const panel = panelId ? document.getElementById(panelId) : null;
    if (!panel) throw new Error(`no tabpanel for ${name}`);
    return panel;
  });
}

describe('SH inspector', () => {
  test('SH-03 the Resumen panel has Revisión, Archivos and Terminal with arrow-key navigation', async () => {
    const fake = scriptStudio(new FakeTransport());
    const user = userEvent.setup();
    renderWithStudio(<AppShell />, { transport: fake });
    await screen.findByRole('complementary', { name: 'Resumen' });

    const tabs = within(inspectorTabs()).getAllByRole('tab');
    expect(tabs.map(tab => tab.textContent?.trim())).toEqual(['Revisión', 'Archivos', 'Terminal']);

    const [review, files] = tabs;
    if (!review || !files) throw new Error('missing panel tabs');
    await user.click(review);
    expect(review).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(files);
    expect(files).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(review);
  });

  test('SH-11 the Memoria page shows what the memory holds, with the empty states', async () => {
    const fake = scriptStudio(new FakeTransport()).respond('memory.summary', {
      mode: 'studio',
      path: 'C:/Users/me/AppData/Local/OmniStudio/workspaces/abc/memory.db',
      counts: { observations: 1, decisions: 0, conversations: 3, modules: 119, dependencies: 479 },
      observations: [
        {
          category: 'gotcha',
          scope: 'auth',
          summary: 'El login usa cookies httpOnly',
          createdAt: '2026-11-06T10:00:00Z',
        },
      ],
      decisions: [],
    });
    const user = userEvent.setup();
    renderWithStudio(<AppShell />, { transport: fake });
    const rail = await screen.findByRole('navigation', { name: 'Conversaciones y proyectos' });
    await user.click(
      within(within(rail).getByRole('list', { name: 'Páginas' })).getByRole('button', { name: 'Memoria' }),
    );

    const page = await screen.findByRole('region', { name: 'Memoria' });
    expect(await within(page).findByText('El login usa cookies httpOnly')).toBeInTheDocument();
    expect(within(page).getByText(/Trampa · auth/)).toBeInTheDocument();
    expect(within(page).getByText('119')).toBeInTheDocument();
    expect(within(page).getByText('Todavía no hay decisiones registradas.')).toBeInTheDocument();
    expect(page).toHaveTextContent('Modo Studio');
  });

  test('SH-12 the Archivos tab: virtualized files.tree, overscroll-contain, git marks; a modified file opens its diff', async () => {
    const fake = scriptStudio(new FakeTransport())
      .respond('files.tree', fileTree(3_000))
      .respond('diff.get', diff([threeHunkFile(), threeHunkFile('CHANGELOG.md')]));
    const user = userEvent.setup();
    renderWithStudio(<AppShell />, { transport: fake });
    await screen.findByRole('complementary', { name: 'Resumen' });
    const panel = await openInspectorTab(user, 'Archivos');

    const tree = await within(panel).findByRole('tree');
    const region = panel.querySelector<HTMLElement>('[data-scroll-region="files"]');
    expect(region).not.toBeNull();
    expect(region).toHaveClass('overscroll-contain');
    const items = await waitFor(() => {
      const rendered = within(tree).getAllByRole('treeitem');
      if (rendered.length === 0) throw new Error('no tree items rendered');
      return rendered;
    });
    expect(items.length).toBeLessThanOrEqual(200);

    const changelog = within(tree).getByRole('treeitem', { name: /CHANGELOG\.md/ });
    expect(changelog).toHaveAttribute('data-git', 'modified');
    expect(within(tree).getByRole('treeitem', { name: /README\.md/ })).not.toHaveAttribute('data-git', 'modified');

    await user.click(changelog);
    // A changed file opens in Revisión, in the same panel.
    const review = within(inspectorTabs()).getByRole('tab', { name: 'Revisión' });
    await waitFor(() => expect(review).toHaveAttribute('aria-selected', 'true'));
    await waitFor(() => expect(document.querySelector('[data-diff-file="CHANGELOG.md"]')).not.toBeNull());
  });
});
