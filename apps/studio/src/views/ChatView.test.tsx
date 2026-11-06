import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test } from 'vitest';
import { AppShell } from '@/shell/AppShell';
import { applyAgentEvent, type ChatItem } from '@/stores/chat';
import { FakeTransport } from '@/test/fake-transport';
import { installLayoutStub, scriptStudio, stubCanvas, stubWorker } from '@/test/fixtures';
import { renderWithStudio } from '@/test/render';
import { ChatView } from './ChatView';

const STATUS = {
  workspace: { mode: 'studio', dir: 'C:\\Users\\me\\AppData\\Local\\OmniStudio\\workspaces\\abc' },
  active: 'claude',
  agents: [{ id: 'claude', label: 'Claude Code', available: true, path: 'claude.exe' }],
  state: 'idle',
  model: null,
  sessionId: null,
};

function chatTransport() {
  return new FakeTransport()
    .respond('agent.status', STATUS)
    .respond('agent.prompt', { accepted: true })
    .respond('agent.permission', (args: Record<string, unknown>) => ({
      requestId: args.requestId,
      decision: args.decision,
    }))
    .respond('agent.cancel', { cancelled: true })
    .respond('agent.reset', { reset: true });
}

describe('CH chat transcript reducer', () => {
  test('CH-01 streamed deltas grow one bubble; tool results and decisions update their cards', () => {
    let items: ChatItem[] = [];
    items = applyAgentEvent(items, { kind: 'text', key: 'm:0', delta: 'Hola, ' });
    items = applyAgentEvent(items, { kind: 'text', key: 'm:0', delta: 'mundo' });
    items = applyAgentEvent(items, { kind: 'tool', id: 't1', name: 'Bash', title: 'ls', input: { command: 'ls' } });
    items = applyAgentEvent(items, { kind: 'permission', requestId: 'r1', toolName: 'Bash', title: 'ls', input: {} });
    items = applyAgentEvent(items, { kind: 'permission_resolved', requestId: 'r1', decision: 'allow' });
    items = applyAgentEvent(items, { kind: 'tool_result', toolUseId: 't1', isError: false, output: 'a.txt' });
    expect(items.map(item => item.type)).toEqual(['text', 'tool', 'permission']);
    expect(items[0]).toMatchObject({ text: 'Hola, mundo' });
    expect(items[1]).toMatchObject({ status: 'done', output: 'a.txt' });
    expect(items[2]).toMatchObject({ status: 'allow' });
  });

  test('CH-02 a result closes tools still running', () => {
    let items = applyAgentEvent([], { kind: 'tool', id: 't', name: 'Read', title: 'x', input: null });
    items = applyAgentEvent(items, { kind: 'result', isError: false, durationMs: 1200, costUsd: 0.01 });
    expect(items[0]).toMatchObject({ status: 'done' });
    expect(items[1]).toMatchObject({ type: 'result', durationMs: 1200 });
  });
});

describe('CH chat view', () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
  });

  test('CH-03 first run opens on the chat and the terminal dock is not shown there', async () => {
    const restoreLayout = installLayoutStub();
    stubCanvas();
    stubWorker();
    renderWithStudio(<AppShell />, { transport: scriptStudio(chatTransport()) });
    await screen.findByRole('region', { name: 'Chat con el agente' });
    expect(screen.getByRole('tab', { name: /Chat/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('region', { name: 'Dock' })).toBeNull();
    restoreLayout();
  });

  test('CH-04 Enter sends the message; text streams in; a permission waits for Aprobar', async () => {
    const user = userEvent.setup();
    const fake = chatTransport();
    renderWithStudio(<ChatView />, { transport: fake });
    await waitFor(() => expect(fake.calls('agent.status')).toHaveLength(1));
    expect(screen.getByText(/Modo Studio/)).toBeInTheDocument();

    const input = screen.getByRole('textbox');
    await user.type(input, 'agrega un README{Enter}');
    await waitFor(() => expect(fake.lastCall('agent.prompt')).toEqual({ text: 'agrega un README' }));
    expect(screen.getByText('agrega un README')).toBeInTheDocument();
    expect(input).toHaveValue('');

    act(() => {
      fake.emit('agent.event', { kind: 'status', state: 'busy' });
      fake.emit('agent.event', { kind: 'text', key: 'm:0', delta: 'Voy a crear ' });
      fake.emit('agent.event', { kind: 'text', key: 'm:0', delta: 'el archivo.' });
      fake.emit('agent.event', {
        kind: 'permission',
        requestId: 'r1',
        toolName: 'Write',
        title: 'README.md',
        input: { file_path: 'README.md', content: '# Hola' },
      });
    });
    expect(screen.getByText('Voy a crear el archivo.')).toBeInTheDocument();
    expect(screen.getByText('# Hola')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Detener' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Aprobar' }));
    expect(fake.lastCall('agent.permission')).toEqual({ requestId: 'r1', decision: 'allow' });
  });

  test('CH-05 a missing login explains how to sign in with the CLI', async () => {
    const fake = chatTransport();
    renderWithStudio(<ChatView />, { transport: fake });
    await waitFor(() => expect(fake.calls('agent.status')).toHaveLength(1));
    act(() => {
      fake.emit('agent.event', {
        kind: 'error',
        code: 'AUTH_REQUIRED',
        message: 'Claude Code no tiene una sesión iniciada.',
      });
    });
    expect(screen.getByRole('alert')).toHaveTextContent('/login');
    expect(screen.getByRole('button', { name: 'Abrir terminal' })).toBeInTheDocument();
  });
});
