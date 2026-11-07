import { act, screen, waitFor, within } from '@testing-library/react';
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

  test('CH-03 first run opens on the conversation with the Resumen panel closed, and there is no dock', async () => {
    const restoreLayout = installLayoutStub();
    stubCanvas();
    stubWorker();
    renderWithStudio(<AppShell />, { transport: scriptStudio(chatTransport()) });
    await screen.findByRole('region', { name: 'Chat con el agente' });
    const crumb = screen.getByRole('navigation', { name: 'Ruta de la página' });
    expect(crumb.querySelector('[aria-current="page"]')).toHaveTextContent('Nueva conversación');
    expect(document.querySelector('[data-inspector]')).toHaveAttribute('data-inspector', 'collapsed');
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

describe('CH conversations in the rail', () => {
  const OPEN = 'C:/dev/omni-spec';
  const OTHER = 'C:/dev/omnipage';
  const conversation = (sessionId: string, title: string, extra: Record<string, unknown> = {}) => ({
    agent: 'claude',
    sessionId,
    title,
    titleSource: 'prompt',
    createdAt: '2026-11-06T10:00:00Z',
    updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    archived: false,
    ...extra,
  });
  const history = (sessionId: string) => ({
    sessionId,
    title: 'Plan del login',
    titleSource: 'prompt',
    events: [
      { kind: 'user', text: '/omni-plan login' },
      { kind: 'text', key: 'a1:full:0', delta: 'Reviso el plan.' },
      { kind: 'tool', id: 't1', name: 'Bash', title: 'ls', input: { command: 'ls' } },
    ],
    truncated: false,
    contextTokens: 1000,
    costUsd: 0.42,
  });

  function railTransport() {
    const lists: Record<string, unknown[]> = {
      [OPEN]: [conversation('S1', 'Plan del login'), conversation('S2', 'Viejo', { archived: true })],
      [OTHER]: [conversation('P1', 'Landing nueva')],
    };
    return scriptStudio(chatTransport())
      .respond('conversations.list', (args: Record<string, unknown>) => ({
        projects: (args.roots as string[]).map(root => ({ root, conversations: lists[root] ?? [] })),
      }))
      .respond('conversations.rename', { renamed: true })
      .respond('conversations.archive', (args: Record<string, unknown>) => ({ archived: args.archived }))
      .respond('agent.resume', (args: Record<string, unknown>) => history(String(args.sessionId)))
      .respond('agent.sessions', {
        sessions: [
          { id: 'S1', title: 'Plan del login', updatedAt: '2026-11-06T10:00:00Z' },
          { id: 'T9', title: 'Sesión de la terminal', updatedAt: '2026-11-05T10:00:00Z' },
        ],
      });
  }

  async function mountRail() {
    const restoreLayout = installLayoutStub();
    stubCanvas();
    stubWorker();
    const user = userEvent.setup();
    const fake = railTransport();
    renderWithStudio(<AppShell />, { transport: fake });
    const rail = await screen.findByRole('navigation', { name: 'Conversaciones y proyectos' });
    const entry = await within(rail).findByRole('button', { name: /^Plan del login/ });
    return { fake, user, rail, entry, restoreLayout };
  }

  test('CH-11 one click opens a conversation with its history; «Nueva conversación» starts over', async () => {
    const { fake, user, rail, entry, restoreLayout } = await mountRail();
    expect(entry).toHaveTextContent('hace 5 min');
    expect(within(rail).queryByText('Viejo')).toBeNull();

    await user.click(entry);
    await waitFor(() => expect(fake.lastCall('agent.resume')).toEqual({ sessionId: 'S1' }));
    expect(await screen.findByText('/omni-plan login')).toBeInTheDocument();
    expect(screen.getByText('Reviso el plan.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bash/ })).toHaveTextContent('Listo');
    expect(entry).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('group', { name: 'Estado del agente' })).toHaveTextContent('US$ 0.4200');

    await user.click(within(rail).getByRole('button', { name: 'Nueva conversación' }));
    await waitFor(() => expect(fake.calls('agent.reset')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText('Reviso el plan.')).toBeNull());
    expect(entry).not.toHaveAttribute('aria-current');
    restoreLayout();
  });

  test('CH-12 a double click renames; the menu archives; archived ones show on demand', async () => {
    const { fake, user, rail, entry, restoreLayout } = await mountRail();
    await user.dblClick(entry);
    const field = within(rail).getByRole('textbox', { name: 'Título de la conversación' });
    await user.clear(field);
    await user.type(field, 'Login con Google{Enter}');
    await waitFor(() =>
      expect(fake.lastCall('conversations.rename')).toEqual({
        root: OPEN,
        agent: 'claude',
        sessionId: 'S1',
        title: 'Login con Google',
      }),
    );

    await user.click(within(rail).getByRole('button', { name: 'Opciones de «Plan del login»' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archivar' }));
    await waitFor(() =>
      expect(fake.lastCall('conversations.archive')).toEqual({
        root: OPEN,
        agent: 'claude',
        sessionId: 'S1',
        archived: true,
      }),
    );

    await user.click(within(rail).getByRole('button', { name: 'Opciones de omni-spec' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Mostrar archivadas' }));
    expect(await within(rail).findByRole('button', { name: /^Viejo/ })).toHaveTextContent('archivada');
    restoreLayout();
  });

  test('CH-13 the search spans every project; a conversation of another project opens that project first', async () => {
    const { fake, user, rail, restoreLayout } = await mountRail();
    await user.type(within(rail).getByRole('searchbox', { name: 'Buscar conversaciones' }), 'landing');
    const hit = await within(rail).findByRole('button', { name: /^Landing nueva/ });
    expect(hit).toHaveTextContent('omnipage');
    expect(within(rail).queryByRole('button', { name: /^Plan del login/ })).toBeNull();

    await user.click(hit);
    await waitFor(() => expect(fake.lastCall('project.open')).toEqual({ path: OTHER }));
    // Once the other project's engine is up, its chat opens the conversation.
    await waitFor(() => expect(fake.lastCall('agent.resume')).toEqual({ sessionId: 'P1' }));
    restoreLayout();
  });

  test('CH-14 «Retomar sesión de la terminal…» lists the sessions not in Studio and brings one in', async () => {
    const { fake, user, rail, restoreLayout } = await mountRail();
    await user.click(within(rail).getByRole('button', { name: 'Opciones de omni-spec' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Retomar sesión de la terminal…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Retomar sesión de la terminal' });
    const pick = await within(dialog).findByRole('button', { name: /Sesión de la terminal/ });
    expect(within(dialog).queryByRole('button', { name: /^Plan del login/ })).toBeNull();

    await user.click(pick);
    await waitFor(() => expect(fake.lastCall('agent.resume')).toEqual({ sessionId: 'T9' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    restoreLayout();
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
