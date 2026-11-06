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
  snapshot,
  stubCanvas,
  stubWorker,
  threeHunkFile,
  TREE_OID,
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

const inspectorTabs = () => within(screen.getByRole('complementary', { name: 'Inspector' })).getByRole('tablist');

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

/** The leaf element whose text is exactly `text`. */
function leaf(scope: HTMLElement, text: string): HTMLElement {
  return within(scope).getByText(
    (_content, element) => element?.textContent?.trim() === text && element.children.length === 0,
  );
}

describe('SH inspector', () => {
  test('SH-03 inspector tabs Terminal, Overview, FinOps, Files with arrow-key navigation', async () => {
    const fake = scriptStudio(new FakeTransport());
    const user = userEvent.setup();
    renderWithStudio(<AppShell />, { transport: fake });
    await screen.findByRole('complementary', { name: 'Inspector' });

    const tabs = within(inspectorTabs()).getAllByRole('tab');
    expect(tabs.map(tab => tab.textContent?.trim())).toEqual(['Terminal', 'Overview', 'FinOps', 'Files']);

    const [terminal, overview] = tabs;
    if (!terminal || !overview) throw new Error('missing inspector tabs');
    await user.click(terminal);
    expect(terminal).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(overview);
    expect(overview).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(terminal);
  });

  test('SH-11 the Overview tab shows breaker state, WAL size, tree OID and tasks in mono; no subagents or $', async () => {
    for (const [walBytes, walText] of [
      [0, '0 B'],
      [12_698, '12.4 KB'],
    ] as const) {
      const fake = scriptStudio(new FakeTransport()).respond(
        'project.snapshot',
        snapshot({ memory: { walBytes, specsTreeOid: TREE_OID } }),
      );
      const user = userEvent.setup();
      const view = renderWithStudio(<AppShell />, { transport: fake });
      await screen.findByRole('complementary', { name: 'Inspector' });
      const panel = await openInspectorTab(user, 'Overview');

      const values = await waitFor(() => [
        leaf(panel, 'CLOSED'),
        leaf(panel, walText),
        leaf(panel, TREE_OID.slice(0, 7)),
        leaf(panel, '4/7'),
      ]);
      for (const value of values) expect(value, value.textContent ?? '').toHaveClass('font-mono');
      expect(panel.textContent).not.toContain(TREE_OID);
      expect(panel.textContent).not.toMatch(/subagente/i);
      expect(panel.textContent).not.toContain('$');
      view.unmount();
    }
  });

  test('SH-12 the Files tab: virtualized files.tree, overscroll-contain, git marks; a modified file opens its diff', async () => {
    const fake = scriptStudio(new FakeTransport())
      .respond('files.tree', fileTree(3_000))
      .respond('diff.get', diff([threeHunkFile(), threeHunkFile('CHANGELOG.md')]));
    const user = userEvent.setup();
    renderWithStudio(<AppShell />, { transport: fake });
    await screen.findByRole('complementary', { name: 'Inspector' });
    const panel = await openInspectorTab(user, 'Files');

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
    const diffs = within(screen.getByRole('tablist', { name: 'Vistas' })).getByRole('tab', { name: 'Diffs' });
    await waitFor(() => expect(diffs).toHaveAttribute('aria-selected', 'true'));
    await waitFor(() => expect(document.querySelector('[data-diff-file="CHANGELOG.md"]')).not.toBeNull());
  });
});
