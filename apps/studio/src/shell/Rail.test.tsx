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
  test('SH-04 recent projects with nested specs, + Nueva Spec and Ajustes; a spec focuses its board card', async () => {
    const fake = scriptStudio(new FakeTransport());
    const user = userEvent.setup();
    renderWithStudio(<AppShell />, { transport: fake });
    const rail = await screen.findByRole('navigation', { name: 'Proyectos' });

    const project = await waitFor(() => {
      const element = rail.querySelector<HTMLElement>('[data-project="C:/dev/omni-spec"]');
      if (!element) throw new Error('active project is not listed in the rail');
      return element;
    });
    expect(within(project).getByText('omni-spec')).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: /omnipage/ })).toBeInTheDocument();
    for (const slug of ['001-memory', '002-guardian', '003-carto'])
      expect(within(project).getByRole('button', { name: new RegExp(slug) })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: /Nueva Spec/ })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: /Ajustes/ })).toBeInTheDocument();
    expect(fake.calls('recent.list').length).toBeGreaterThan(0);

    // From another stage tab, selecting a spec returns to Kanban and focuses its card.
    await user.keyboard('{Control>}5{/Control}');
    await user.click(within(project).getByRole('button', { name: /001-memory/ }));
    const kanban = within(screen.getByRole('tablist', { name: 'Vistas' })).getByRole('tab', { name: 'Kanban' });
    await waitFor(() => expect(kanban).toHaveAttribute('aria-selected', 'true'));
    await waitFor(() => expect((document.activeElement as HTMLElement | null)?.dataset.cardId).toBe('001'));
  });
});
