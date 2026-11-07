import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AppShell } from '@/shell/AppShell';
import { relativePath } from '@/stores/conversation-review';
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

const inspectorTabs = () =>
  within(screen.getByRole('complementary', { name: 'Resumen' })).getByRole('tablist', { name: 'Resumen' });

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
    // A changed file opens in Archivos › Cambios de git, the repo-wide diff, in the same panel.
    const git = within(within(panel).getByRole('tablist', { name: 'Vista de archivos' })).getByRole('tab', {
      name: 'Cambios de git',
    });
    await waitFor(() => expect(git).toHaveAttribute('aria-selected', 'true'));
    expect(within(inspectorTabs()).getByRole('tab', { name: 'Archivos' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(document.querySelector('[data-diff-file="CHANGELOG.md"]')).not.toBeNull());
  });

  test('SH-13 Revisión shows only the files this conversation touched, +N −M on the panel button, and their impact', async () => {
    expect(relativePath('C:\\dev\\omni-spec\\src\\a.ts', 'C:/dev/omni-spec')).toBe('src/a.ts');
    expect(relativePath('c:/DEV/omni-spec/b.ts', 'C:\\dev\\omni-spec\\')).toBe('b.ts');
    expect(relativePath('D:/other/c.ts', 'C:/dev/omni-spec')).toBe('D:/other/c.ts');

    const fake = scriptStudio(new FakeTransport()).respond('agent.status', {
      workspace: { mode: 'project', dir: 'C:/dev/omni-spec/specs' },
      active: 'claude',
      agents: [{ id: 'claude', label: 'Claude Code', available: true, path: 'claude.exe' }],
      state: 'idle',
      model: null,
      sessionId: null,
    });
    // First run: the conversation, with the panel closed.
    localStorage.setItem(
      'omni-studio:layout.v3',
      JSON.stringify({ railCollapsed: false, inspectorCollapsed: true, inspectorTab: 'review', stageTab: 'chat' }),
    );
    const user = userEvent.setup();
    renderWithStudio(<AppShell />, { transport: fake });
    await screen.findByRole('region', { name: 'Chat con el agente' });
    expect(screen.getByRole('button', { name: 'Mostrar u ocultar el panel Resumen' })).toBeInTheDocument();

    act(() => {
      const tool = (id: string, name: string, input: Record<string, unknown>) =>
        fake.emit('agent.event', { kind: 'tool', id, name, title: String(input.file_path ?? ''), input });
      tool('t1', 'Edit', { file_path: 'C:\\dev\\omni-spec\\src\\app.ts', old_string: 'a\nb', new_string: 'a\nc\nd' });
      tool('t2', 'Write', { file_path: 'C:/dev/omni-spec/README.md', content: '# Hola\n\nmundo' });
      tool('t3', 'Edit', { file_path: 'C:/dev/omni-spec/denied.ts', old_string: 'x', new_string: 'y' });
      tool('t4', 'Read', { file_path: 'C:/dev/omni-spec/package.json' });
      fake.emit('agent.event', { kind: 'tool_result', toolUseId: 't3', isError: true, output: 'rechazado' });
    });
    // Edit: −b +c +d; Write: three new lines. The rejected edit and the read changed nothing.
    const toggle = await screen.findByRole('button', { name: /esta conversación cambió \+5 −1 líneas/ });
    expect(toggle).toHaveTextContent('+5−1');

    await user.click(toggle);
    const panel = screen.getByRole('complementary', { name: 'Resumen' });
    const changes = await within(panel).findByRole('list', { name: 'Cambios' });
    expect(
      [...changes.querySelectorAll('[data-review-file]')].map(node => node.getAttribute('data-review-file')),
    ).toEqual(['src/app.ts', 'README.md']);
    expect(within(panel).getByText('2 archivos cambiados')).toBeInTheDocument();
    expect(within(panel).getByText('Archivo escrito entero')).toBeInTheDocument();

    await user.click(within(panel).getByRole('tab', { name: 'Impacto' }));
    const files = await within(panel).findByRole('list', { name: 'Archivos de esta conversación' });
    await user.click(within(files).getByRole('button', { name: 'src/app.ts' }));
    await waitFor(() => expect(fake.lastCall('blastRadius.heat')).toEqual({ target: 'src/app.ts' }));
    expect(within(panel).getByRole('button', { name: 'Ver el mapa de módulos' })).toBeInTheDocument();
  });

  test('SH-14 Ajustes is a modal with its seven sections; skills live in Personalizaciones; the default level persists', async () => {
    const fake = scriptStudio(new FakeTransport());
    const user = userEvent.setup();
    renderWithStudio(<AppShell />, { transport: fake });
    const rail = await screen.findByRole('navigation', { name: 'Conversaciones y proyectos' });
    await user.click(within(rail).getByRole('button', { name: 'Ajustes' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajustes' });
    const sections = within(within(dialog).getByRole('tablist', { name: 'Ajustes' })).getAllByRole('tab');
    expect(sections.map(tab => tab.textContent)).toEqual([
      'General',
      'Agentes',
      'Apariencia',
      'Atajos',
      'Notificaciones',
      'Personalizaciones',
      'Proyectos',
    ]);

    await user.click(within(dialog).getByRole('radio', { name: /Planificar/ }));
    expect(JSON.parse(localStorage.getItem('omni-studio:settings.v1') ?? '{}')).toMatchObject({
      defaultPermission: 'plan',
    });

    await user.click(within(dialog).getByRole('tab', { name: 'Personalizaciones' }));
    await waitFor(() => expect(fake.calls('skills.list').length).toBeGreaterThan(0));
    await user.click(within(dialog).getByRole('tab', { name: 'Atajos' }));
    expect(within(dialog).getByText('Interrumpir el turno y enviar')).toBeInTheDocument();

    // The pages that found a new place are gone from the palette.
    await user.keyboard('{Escape}');
    await user.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('dialog');
    const views = within(palette)
      .queryAllByRole('option')
      .map(option => option.textContent ?? '');
    expect(views.some(name => /Cartografía|Diffs|Skills/.test(name))).toBe(false);
  });
});
