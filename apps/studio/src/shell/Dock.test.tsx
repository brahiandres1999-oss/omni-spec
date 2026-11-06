import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AppShell } from '@/shell/AppShell';
import { renderWithStudio } from '@/test/render';
import { FakeTransport } from '@/test/fake-transport';
import { DOCK_PROTECTED_TEXT, installLayoutStub, scriptStudio, stubCanvas, stubWorker } from '@/test/fixtures';

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

const dock = () => screen.getByRole('region', { name: 'Dock' });
const inspectorTab = (name: string) =>
  within(within(screen.getByRole('complementary', { name: 'Inspector' })).getByRole('tablist')).getByRole('tab', {
    name,
  });

describe('SH dock (cockpit-input)', () => {
  test('SH-08 Enter writes /omni-<mode> <text>\\r to the active terminal; Shift+Enter is a newline; empty sends nothing', async () => {
    const fake = scriptStudio(new FakeTransport());
    const user = userEvent.setup();
    renderWithStudio(<AppShell />, { transport: fake });
    await screen.findByRole('region', { name: 'Dock' });

    expect(dock()).toHaveClass('rounded-2xl', 'bg-floating', 'border', 'border-floating-border');
    expect([...dock().classList].filter(name => /(^|:)shadow-(?!none$)/.test(name))).toEqual([]);

    // Open a terminal session so the dock has a target (D-19).
    await user.click(inspectorTab('Terminal'));
    await user.click(await screen.findByRole('button', { name: 'Nueva terminal' }));
    await waitFor(() => expect(fake.calls('pty.open')).toHaveLength(1));

    const mode = await within(dock()).findByRole('combobox', { name: 'Modo' });
    const modes = within(mode)
      .getAllByRole('option')
      .map(option => (option as HTMLOptionElement).value);
    expect(modes).toEqual(expect.arrayContaining(['omni-specify', 'omni-audit']));
    expect(modes.every(name => name.startsWith('omni-'))).toBe(true);
    await user.selectOptions(mode, 'omni-specify');

    const input = within(dock()).getByRole('textbox', { name: 'Instrucción' });
    const writesBefore = fake.calls('pty.write').length;
    await user.click(input);
    await user.keyboard('{Enter}');
    expect(fake.calls('pty.write')).toHaveLength(writesBefore);

    await user.type(input, 'a');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    await user.type(input, 'b');
    expect(input).toHaveValue('a\nb');
    expect(fake.calls('pty.write')).toHaveLength(writesBefore);

    await user.clear(input);
    await user.type(input, 'crear flujo de login');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(fake.calls('pty.write')).toHaveLength(writesBefore + 1));
    expect(fake.lastCall('pty.write')).toEqual({ id: 'pty-1', data: '/omni-specify crear flujo de login\r' });
    expect(input).toHaveValue('');
  });

  test('SH-09 without an active terminal the dock is Protected and offers to open the Terminal tab', async () => {
    const fake = scriptStudio(new FakeTransport());
    const user = userEvent.setup();
    renderWithStudio(<AppShell />, { transport: fake });
    await screen.findByRole('region', { name: 'Dock' });
    await user.click(inspectorTab('Overview'));

    expect(dock()).toHaveAttribute('data-state', 'protected');
    expect(within(dock()).getByText(DOCK_PROTECTED_TEXT)).toBeInTheDocument();
    expect(within(dock()).queryByRole('textbox', { name: 'Instrucción' })).toBeNull();

    await user.click(within(dock()).getByRole('button', { name: 'Abrir terminal' }));
    await waitFor(() => expect(inspectorTab('Terminal')).toHaveAttribute('aria-selected', 'true'));
    expect(fake.calls('pty.write')).toHaveLength(0);
  });
});
