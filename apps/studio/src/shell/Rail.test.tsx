import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AppShell } from '@/shell/AppShell';
import { renderWithStudio } from '@/test/render';
import { FakeTransport } from '@/test/fake-transport';
import { installLayoutStub, scriptStudio, stubCanvas, stubWorker } from '@/test/fixtures';

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

describe('SH rail', () => {
  test('SH-04 the rail is Proyectos → Conversaciones: no specs, a folder picker adds a project, a project can leave the list', async () => {
    const fake = scriptStudio(new FakeTransport())
      .respond('conversations.list', (args: Record<string, unknown>) => ({
        projects: (args.roots as string[]).map(root => ({
          root,
          conversations:
            root === 'C:/dev/omnipage'
              ? [
                  {
                    agent: 'claude',
                    sessionId: 'p1',
                    title: 'Landing nueva',
                    titleSource: 'prompt',
                    createdAt: '2026-11-01T00:00:00Z',
                    updatedAt: '2026-11-01T00:00:00Z',
                    archived: false,
                  },
                ]
              : [
                  {
                    agent: 'claude',
                    sessionId: 'o1',
                    title: 'Arreglar el login',
                    titleSource: 'prompt',
                    createdAt: '2026-11-06T00:00:00Z',
                    updatedAt: '2026-11-06T00:00:00Z',
                    archived: false,
                  },
                ],
        })),
      }))
      .respond('project.pick', 'C:/dev/nuevo');
    const user = userEvent.setup();
    renderWithStudio(<AppShell />, { transport: fake });
    const rail = await screen.findByRole('navigation', { name: 'Conversaciones y proyectos' });

    const open = await waitFor(() => {
      const element = rail.querySelector<HTMLElement>('[data-project="C:/dev/omni-spec"]');
      if (!element) throw new Error('the open project is not listed in the rail');
      return element;
    });
    // The open project is unfolded with its conversations; the other one is folded.
    expect(await within(open).findByRole('button', { name: /^Arreglar el login/ })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Mostrar las conversaciones de omnipage' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(within(rail).queryByText('Landing nueva')).toBeNull();
    for (const slug of ['001-memory', '002-guardian', '003-carto'])
      expect(within(rail).queryByRole('button', { name: new RegExp(slug) })).toBeNull();
    expect(within(rail).getByRole('button', { name: 'Nueva conversación' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: /Ajustes/ })).toBeInTheDocument();

    // The chevron unfolds without opening the project.
    await user.click(within(rail).getByRole('button', { name: 'Mostrar las conversaciones de omnipage' }));
    expect(await within(rail).findByRole('button', { name: /^Landing nueva/ })).toBeInTheDocument();
    expect(fake.calls('project.open')).toHaveLength(0);

    await user.click(within(rail).getByRole('button', { name: 'Agregar proyecto' }));
    await waitFor(() => expect(fake.lastCall('project.open')).toEqual({ path: 'C:/dev/nuevo' }));

    await user.click(within(rail).getByRole('button', { name: 'Opciones de omnipage' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Quitar de la lista' }));
    await waitFor(() => expect(fake.lastCall('recent.remove')).toEqual({ path: 'C:/dev/omnipage' }));
    expect(fake.calls('recent.list').length).toBeGreaterThan(1);
  });
});
