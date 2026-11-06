import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test } from 'vitest';
import { AppShell } from '@/shell/AppShell';
import { diffLines } from '@/components/ui/line-diff';
import { applyAgentEvent, type ChatItem } from '@/stores/chat';
import { FakeTransport } from '@/test/fake-transport';
import { installLayoutStub, scriptStudio, stubCanvas, stubWorker } from '@/test/fixtures';
import { renderWithStudio } from '@/test/render';
import { ChatHeader, ChatView, modelName, pendingChange } from './ChatView';

/** The chat as the stage shows it: the status row on the tab bar, the transcript under it. */
const ChatWithHeader = () => (
  <>
    <ChatHeader />
    <ChatView />
  </>
);

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

  test('CH-06 answers render as Markdown with highlighted, copyable code and tables', async () => {
    const fake = chatTransport();
    renderWithStudio(<ChatView />, { transport: fake });
    await waitFor(() => expect(fake.calls('agent.status')).toHaveLength(1));
    act(() => {
      fake.emit('agent.event', {
        kind: 'text',
        key: 'm:0',
        delta: [
          '## Plan',
          '',
          '- **uno**',
          '',
          '| a | b |',
          '|---|---|',
          '| 1 | 2 |',
          '',
          '```ts',
          'const a = 1;',
          '```',
          '',
        ].join('\n'),
      });
    });
    expect(screen.getByRole('heading', { name: 'Plan' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copiar' })).toBeInTheDocument();
    expect(document.querySelector('.hljs-keyword')?.textContent).toBe('const');
  });

  test('CH-07 the chosen model and effort travel with the prompt; the meter shows context use', async () => {
    globalThis.localStorage?.setItem('omni-studio:chat.options', JSON.stringify({ model: 'opus', effort: 'high' }));
    const user = userEvent.setup();
    const fake = chatTransport();
    renderWithStudio(<ChatWithHeader />, { transport: fake });
    await waitFor(() => expect(fake.calls('agent.status')).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Modelo: Opus' })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox'), 'hola{Enter}');
    await waitFor(() => expect(fake.lastCall('agent.prompt')).toEqual({ text: 'hola', model: 'opus', effort: 'high' }));
    act(() => {
      fake.emit('agent.event', {
        kind: 'result',
        isError: false,
        durationMs: 900,
        costUsd: 0.01,
        contextTokens: 250_000,
        contextWindow: 1_000_000,
        costBasis: 'list',
      });
    });
    expect(screen.getByRole('meter', { name: 'Contexto usado' })).toHaveAttribute('aria-valuenow', '25');
  });

  test('CH-09 the status row shows the conversation total; a new model waits for the next message', async () => {
    globalThis.localStorage?.setItem('omni-studio:chat.options', JSON.stringify({ model: 'opus', effort: null }));
    const user = userEvent.setup();
    const fake = chatTransport();
    renderWithStudio(<ChatWithHeader />, { transport: fake });
    await waitFor(() => expect(fake.calls('agent.status')).toHaveLength(1));
    await user.type(screen.getByRole('textbox'), 'hola{Enter}');
    await waitFor(() => expect(fake.calls('agent.prompt')).toHaveLength(1));
    // Two turns as the driver reports them: the turn cost and the conversation total (not their sum).
    act(() => {
      fake.emit('agent.event', { kind: 'init', model: 'claude-opus-5-5' });
      for (const [costUsd, sessionCostUsd] of [
        [0.0035, 0.0035],
        [0.0041, 0.0076],
      ])
        fake.emit('agent.event', {
          kind: 'result',
          isError: false,
          durationMs: 900,
          costUsd,
          sessionCostUsd,
          contextTokens: 40_000,
          contextWindow: 1_000_000,
        });
      fake.emit('agent.event', { kind: 'status', state: 'ready' });
    });
    const header = screen.getByRole('group', { name: 'Estado del agente' });
    expect(header).toHaveTextContent('Opus 5.5');
    expect(header).toHaveTextContent('US$ 0.0076');
    expect(screen.getByText('Turno terminado en 0.9 s · ≈ US$ 0.0041')).toBeInTheDocument();
    expect(screen.queryByText(/desde tu próximo mensaje/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Modelo: Opus' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Haiku' }));
    expect(screen.getByText('Opus 5.5 ahora → Haiku desde tu próximo mensaje')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox'), 'sigue{Enter}');
    await waitFor(() => expect(fake.lastCall('agent.prompt')).toEqual({ text: 'sigue', model: 'haiku' }));
    await waitFor(() => expect(screen.queryByText(/desde tu próximo mensaje/)).toBeNull());
  });

  test('CH-10 model ids read as names; a pending change says what changes', () => {
    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5');
    expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(modelName('claude-sonnet-4-20250514')).toBe('Sonnet 4');
    expect(modelName('gpt-5')).toBe('gpt-5');
    const applied = { model: 'opus', effort: 'low' };
    expect(pendingChange('claude-opus-5-5', applied, applied)).toBeNull();
    expect(pendingChange(null, applied, { model: 'haiku', effort: 'low' })).toBeNull();
    expect(pendingChange('claude-opus-5-5', applied, { model: 'haiku', effort: 'low' })).toEqual({
      text: 'Opus 5.5 ahora → Haiku desde tu próximo mensaje',
      modelChanges: true,
    });
    expect(pendingChange('claude-opus-5-5', applied, { model: 'opus', effort: 'high' })?.text).toBe(
      'Esfuerzo bajo ahora → esfuerzo alto desde tu próximo mensaje',
    );
    expect(pendingChange('claude-opus-5-5', applied, { model: null, effort: 'low' })?.text).toBe(
      'Opus 5.5 ahora → el modelo predeterminado desde tu próximo mensaje',
    );
  });
});

describe('CH line diff', () => {
  test('CH-08 edits diff by line, keeping unchanged lines between changes', () => {
    expect(diffLines(['a', 'b', 'c'].join('\n'), ['a', 'B', 'c', 'd'].join('\n'))).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'add', text: 'B' },
      { kind: 'same', text: 'c' },
      { kind: 'add', text: 'd' },
    ]);
    expect(diffLines('', 'x')).toEqual([{ kind: 'add', text: 'x' }]);
  });
});
