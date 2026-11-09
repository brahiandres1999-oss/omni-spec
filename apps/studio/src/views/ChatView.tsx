/**
 * Agent chat (docs/STUDIO-AGENT-COCKPIT.md): the user talks to their own Claude Code. Answers render as
 * Markdown, every tool call is a card, edits show a line diff, and edits or commands wait for Aprobar /
 * Rechazar. The Composer carries model, reasoning and permissions for the next turns, the queue, `@` and `/`;
 * ChatHeader (on the stage top row) shows the agent, its model, context and cost.
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useStudio } from '@/app/studio-context';
import { Button } from '@/components/ui/button';
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Gauge,
  Icon,
  MessageSquare,
  RotateCcw,
  ShieldAlert,
  SquareTerminal,
  X,
} from '@/components/ui/icon';
import { cn, focusRing, mono } from '@/components/ui/interaction';
import { LineDiff } from '@/components/ui/line-diff';
import { Markdown } from '@/components/ui/markdown';
import { formatInt, messages } from '@/i18n/messages.es';
import type { AgentOptions, AgentUsage, ChatItem, ChatStore, ToolInput } from '@/stores/chat';
import { sameRoot } from '@/stores/conversations';
import { Composer } from './Composer';
import { AnsweredQuestion, QuestionPanel } from './QuestionPanel';

const t = messages.chat;

function stringField(input: ToolInput, key: string): string | null {
  const value = input?.[key];
  return typeof value === 'string' ? value : null;
}

const preBlock = cn(
  mono,
  'max-h-72 overflow-auto overscroll-contain whitespace-pre-wrap break-words rounded-md border border-divider bg-canvas p-2.5 text-xs leading-5',
);

/** What the tool will do, in the form a person reviews it: the command, a line diff, the new file. */
function ToolPreview({ input }: { input: ToolInput }) {
  if (!input) return null;
  const command = stringField(input, 'command');
  const oldText = stringField(input, 'old_string');
  const newText = stringField(input, 'new_string');
  const content = stringField(input, 'content');
  if (command) return <pre className={preBlock}>{command}</pre>;
  if (oldText !== null || newText !== null) return <LineDiff before={oldText ?? ''} after={newText ?? ''} />;
  if (content !== null) return <LineDiff before="" after={content} />;
  return <pre className={cn(preBlock, 'text-fg-muted')}>{JSON.stringify(input, null, 2)}</pre>;
}

/** Shorten bloated paths in command titles (e.g. `node "...bin/omni-spec.mjs" status` → `omni-spec status`). */
export function formatToolTitle(title: string): string {
  const omniMatch =
    /node\s+(?:"[^"]*[/\\]omni-spec\.mjs"|'[^']*[/\\]omni-spec\.mjs'|[^\s]*[/\\]omni-spec\.mjs)\s*(.*)/i.exec(title);
  if (omniMatch) {
    return `omni-spec ${omniMatch[1]}`.trim();
  }
  return title;
}

function ToolCard({ item }: { item: Extract<ChatItem, { type: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const tone = item.status === 'error' ? 'text-breach' : item.status === 'running' ? 'text-accent' : 'text-fg-muted';
  const label = item.status === 'error' ? t.toolError : item.status === 'running' ? t.toolRunning : t.toolDone;
  const displayTitle = item.title ? formatToolTitle(item.title) : '';
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-divider bg-surface">
      <button
        type="button"
        className={cn(
          'flex min-h-9 w-full min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-start text-[13px]',
          'transition-[background-color] duration-150 ease-out hover:bg-floating',
          focusRing,
        )}
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <Icon icon={open ? ChevronDown : ChevronRight} className="shrink-0 text-fg-muted" />
        <span className="shrink-0 font-medium text-fg">{item.name}</span>
        {item.title && item.title !== item.name ? (
          <span className={cn(mono, 'min-w-0 flex-1 truncate text-xs text-fg-muted')} title={item.title}>
            {displayTitle}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        <span className={cn('flex shrink-0 items-center gap-1.5 text-xs', tone)}>
          <span
            aria-hidden="true"
            className={cn('size-1.5 rounded-full bg-current', item.status === 'running' && 'motion-safe:animate-pulse')}
          />
          {label}
        </span>
      </button>
      {open ? (
        <div className="grid min-w-0 gap-2 border-t border-divider px-3 py-2.5">
          <ToolPreview input={item.input} />
          {item.output ? (
            <>
              <span className="text-xs text-fg-muted">{t.output}</span>
              <pre className={cn(preBlock, item.status === 'error' && 'text-breach')}>{item.output}</pre>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PermissionCard({
  item,
  chat,
  agentName = 'El agente',
}: {
  item: Extract<ChatItem, { type: 'permission' }>;
  chat: ChatStore;
  agentName?: string;
}) {
  const pending = item.status === 'pending';
  return (
    <section
      aria-label={t.permissionTitle(item.toolName, agentName)}
      className={cn(
        'grid gap-2.5 rounded-xl border p-3',
        pending ? 'border-accent/50 bg-accent/5' : 'border-divider bg-surface',
      )}
    >
      <div className="flex min-w-0 items-center gap-2 text-[13px]">
        <Icon icon={ShieldAlert} className={pending ? 'text-accent' : 'text-fg-muted'} />
        <span className="font-medium text-fg">{t.permissionTitle(item.toolName, agentName)}</span>
        {item.title && item.title !== item.toolName ? (
          <span className={cn(mono, 'min-w-0 flex-1 truncate text-xs text-fg-muted')}>{item.title}</span>
        ) : null}
      </div>
      {item.conflictWith ? (
        <p role="status" className="flex items-center gap-1.5 text-xs text-pretty text-breach">
          <Icon icon={CircleAlert} className="shrink-0" />
          {t.conflictWarning(item.conflictWith, item.conflictFile ?? item.title)}
        </p>
      ) : null}
      {item.reason ? <p className="text-xs text-pretty text-fg-muted">{item.reason}</p> : null}
      <ToolPreview input={item.input} />
      {pending ? (
        <div className="flex gap-2">
          <Button
            variant="primary"
            size="sm"
            icon={Check}
            onClick={() => void chat.getState().decide(item.id, 'allow')}
          >
            {t.allow}
          </Button>
          <Button variant="danger" size="sm" icon={X} onClick={() => void chat.getState().decide(item.id, 'deny')}>
            {t.deny}
          </Button>
        </div>
      ) : (
        <span
          className={cn('flex items-center gap-1.5 text-xs', item.status === 'allow' ? 'text-attested' : 'text-breach')}
        >
          <Icon icon={item.status === 'allow' ? Check : X} />
          {item.status === 'allow' ? t.allowed : t.denied}
        </span>
      )}
    </section>
  );
}

function Entry({
  item,
  chat,
  agentName,
  onOpenTerminal,
}: {
  item: ChatItem;
  chat: ChatStore;
  agentName?: string;
  onOpenTerminal(): void;
}) {
  switch (item.type) {
    case 'user':
      return (
        <div className="flex justify-end">
          <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-floating px-3.5 py-2 text-[14px] leading-relaxed text-pretty text-fg">
            {item.text}
          </p>
        </div>
      );
    case 'text':
      return <Markdown text={item.text} />;
    case 'tool':
      return <ToolCard item={item} />;
    case 'permission':
      return <PermissionCard item={item} chat={chat} agentName={agentName} />;
    case 'question':
      // A pending question is answered in the panel above the composer.
      return item.status === 'pending' ? null : <AnsweredQuestion item={item} />;
    case 'result':
      return (
        <p className={cn('text-xs tabular-nums', item.isError ? 'text-breach' : 'text-fg-muted')}>
          {item.isError
            ? t.turnFailed
            : t.turnDone(
                ((item.durationMs ?? 0) / 1000).toFixed(1),
                item.costUsd !== null ? `≈ US$ ${item.costUsd.toFixed(4)}` : null,
              )}
        </p>
      );
    case 'error':
      return (
        <div role="alert" className="grid gap-2 rounded-xl border border-breach/50 bg-breach/5 p-3 text-[13px] text-fg">
          <span className="flex items-start gap-2 text-pretty">
            <Icon icon={CircleAlert} className="mt-0.5 shrink-0 text-breach" />
            {item.message}
          </span>
          {item.code === 'AUTH_REQUIRED' ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              <span>{t.loginHint}</span>
              <Button size="sm" icon={SquareTerminal} onClick={onOpenTerminal}>
                {t.openTerminal}
              </Button>
            </div>
          ) : null}
        </div>
      );
    case 'notice':
      return <p className="text-xs text-fg-muted">{item.text}</p>;
  }
}

type ToolItem = Extract<ChatItem, { type: 'tool' }>;
/** Runs of this many tools or more read as one block («12 pasos») that opens on demand. */
const GROUP_FROM = 3;

/** The transcript with long runs of consecutive tool calls folded into groups. */
export function groupTools(
  items: readonly ChatItem[],
): Array<ChatItem | { type: 'tools'; id: string; tools: ToolItem[] }> {
  const out: Array<ChatItem | { type: 'tools'; id: string; tools: ToolItem[] }> = [];
  let run: ToolItem[] = [];
  const flush = () => {
    if (run.length >= GROUP_FROM) out.push({ type: 'tools', id: `tools:${run[0]?.id}`, tools: run });
    else out.push(...run);
    run = [];
  };
  for (const item of items) {
    if (item.type === 'tool') run.push(item);
    else {
      flush();
      out.push(item);
    }
  }
  flush();
  return out;
}

function ToolGroup({ tools }: { tools: ToolItem[] }) {
  const [open, setOpen] = useState(false);
  const running = tools.findLast(tool => tool.status === 'running');
  const failed = tools.filter(tool => tool.status === 'error').length;
  const latest = running ?? (tools.at(-1) as ToolItem);
  const displayTitle = latest.title ? formatToolTitle(latest.title) : '';
  return (
    <div className="grid min-w-0 gap-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className={cn(
          'flex min-h-9 w-full min-w-0 items-center gap-2 rounded-xl border border-divider bg-surface px-3 py-2 text-start text-[13px]',
          'transition-[background-color] duration-150 ease-out hover:bg-floating',
          focusRing,
        )}
      >
        <Icon icon={open ? ChevronDown : ChevronRight} className="shrink-0 text-fg-muted" />
        <span className="shrink-0 font-medium text-fg">{t.toolSteps(tools.length)}</span>
        <span className={cn(mono, 'min-w-0 flex-1 truncate text-xs text-fg-muted')} title={latest.title}>
          {latest.name}
          {latest.title && latest.title !== latest.name ? ` ${displayTitle}` : ''}
        </span>
        {failed > 0 ? <span className="shrink-0 text-xs text-breach">{t.toolStepsFailed(failed)}</span> : null}
        <span className={cn('flex shrink-0 items-center gap-1.5 text-xs', running ? 'text-accent' : 'text-fg-muted')}>
          <span
            aria-hidden="true"
            className={cn('size-1.5 rounded-full bg-current', running && 'motion-safe:animate-pulse')}
          />
          {running ? t.toolRunning : t.toolDone}
        </span>
      </button>
      {open ? (
        <div className="grid min-w-0 gap-1.5 border-s border-divider ps-3">
          {tools.map(tool => (
            <ToolCard key={tool.id} item={tool} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

const compact = (value: number) =>
  value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`
    : value >= 1000
      ? `${Math.round(value / 1000)}k`
      : formatInt(value);

/** `claude-opus-5-5` → `Opus 5.5`; an id of another shape uses its known label or what the CLI wrote. */
export function modelName(id: string): string {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?!\d)/.exec(id);
  if (!match) return t.models[id] ?? id;
  const [, family = '', major, minor] = match;
  const name = t.models[family] ?? family;
  return minor ? `${name} ${major}.${minor}` : `${name} ${major}`;
}

const effortName = (effort: string | null) => (effort ? (t.efforts[effort] ?? effort) : t.defaultOption).toLowerCase();

/**
 * What changes with the next message when the composer differs from what the conversation runs with, as in
 * «Opus 5.5 ahora → Haiku desde tu próximo mensaje». `null` when nothing is pending.
 */
export function pendingChange(
  running: string | null,
  applied: AgentOptions | null,
  options: AgentOptions,
): { text: string; modelChanges: boolean } | null {
  if (!running || !applied) return null;
  const now: string[] = [];
  const next: string[] = [];
  const modelChanges = options.model !== applied.model;
  if (modelChanges) {
    now.push(modelName(running));
    next.push(options.model ? (t.models[options.model] ?? options.model) : t.defaultModel);
  }
  if (options.effort !== applied.effort) {
    now.push(t.effortPhrase(effortName(applied.effort)));
    next.push(t.effortPhrase(effortName(options.effort)));
  }
  if (now.length === 0) return null;
  const text = t.nextTurn(now.join(', '), next.join(', '));
  return { text: text.charAt(0).toUpperCase() + text.slice(1), modelChanges };
}

/** Context occupancy and cost of the conversation, from what the CLI reported after the last turn. */
function ContextMeter({ usage }: { usage: AgentUsage }) {
  if (usage.contextTokens === null) return null;
  const share = usage.contextWindow ? Math.min(1, usage.contextTokens / usage.contextWindow) : null;
  const tone = share === null || share < 0.6 ? 'bg-accent' : share < 0.85 ? 'bg-heat-high' : 'bg-breach';
  const cost = usage.costUsd > 0 ? usage.costUsd.toFixed(4) : null;
  const costText = cost ? (usage.costBasis === 'list' ? t.listCost(cost) : t.apiCost(cost)) : null;
  const detail = usage.contextWindow
    ? t.contextOf(formatInt(usage.contextTokens), formatInt(usage.contextWindow))
    : formatInt(usage.contextTokens);
  return (
    <div
      className="flex items-center gap-2 text-xs text-fg-muted tabular-nums"
      title={[t.contextLabel, detail, costText].filter(Boolean).join(' · ')}
    >
      <Icon icon={Gauge} />
      {share !== null ? (
        // A styled bar: WebView2 renders the native <meter> with its own colours, outside the theme tokens.
        // biome-ignore lint/a11y/useSemanticElements: themed meter bar with full ARIA meter semantics
        <span
          role="meter"
          aria-label={t.contextLabel}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(share * 100)}
          className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-divider @2xl:block"
        >
          <span
            className={cn('block h-full rounded-full transition-[width] duration-300 ease-out', tone)}
            style={{ width: `${Math.max(2, share * 100)}%` }}
          />
        </span>
      ) : null}
      <span>
        {compact(usage.contextTokens)}
        {usage.contextWindow ? ` / ${compact(usage.contextWindow)}` : ''}
      </span>
      {cost ? <span>· ≈ US$ {cost}</span> : null}
    </div>
  );
}

/**
 * Agent, model, context and cost of the conversation. It lives on the stage tab bar (one row instead of
 * two), so it reads the chat store of the open project rather than ChatView's props.
 */
export function ChatHeader() {
  const { project } = useStudio();
  const chat = project.chat;
  const hasItems = useStore(chat, state => state.items.length > 0);
  const agentState = useStore(chat, state => state.agentState);
  const model = useStore(chat, state => state.model);
  const status = useStore(chat, state => state.status);
  const options = useStore(chat, state => state.options);
  const applied = useStore(chat, state => state.applied);
  const sessionId = useStore(chat, state => state.sessionId);
  const usage = useStore(chat, state => state.usage);
  const busy = agentState === 'busy' || agentState === 'starting';
  const activeAgentId = (sessionId || hasItems ? applied?.agent : null) ?? options.agent ?? status?.active ?? 'claude';
  const agent = status?.agents.find(entry => entry.id === activeAgentId) ?? status?.agents[0];
  const available = agent?.available ?? true;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled group of status items, not a form fieldset
    <div role="group" aria-label={t.statusRegion} className="flex min-w-0 items-center gap-2.5 text-[13px]">
      <span
        aria-hidden="true"
        className={cn(
          'size-2 shrink-0 rounded-full',
          !available ? 'bg-breach' : busy ? 'bg-accent motion-safe:animate-pulse' : 'bg-attested',
        )}
      />
      <span className="hidden shrink-0 font-medium text-fg @xl:inline">{agent?.label ?? t.agent}</span>
      {model ? (
        <span className="hidden truncate text-fg-muted @3xl:inline" title={model}>
          {modelName(model)}
        </span>
      ) : null}
      {/* "Listo" is what the green dot already says; only work in progress and problems take room. */}
      <span className={cn('truncate text-fg-muted', available && !busy && 'sr-only')}>
        {available ? (t.states[agentState] ?? '') : t.unavailable}
      </span>
      <ContextMeter usage={usage} />
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={t.reset}
        title={t.reset}
        disabled={!hasItems && !busy}
        onClick={() => void chat.getState().reset()}
      >
        <Icon icon={RotateCcw} />
      </Button>
    </div>
  );
}

export function ChatView() {
  const { project, dispatch, ui, projectId, conversations } = useStudio();
  const chat = project.chat;
  const items = useStore(chat, state => state.items);
  const agentState = useStore(chat, state => state.agentState);
  const model = useStore(chat, state => state.model);
  const status = useStore(chat, state => state.status);
  const error = useStore(chat, state => state.error);
  const options = useStore(chat, state => state.options);
  const applied = useStore(chat, state => state.applied);
  const sessionId = useStore(chat, state => state.sessionId);
  const loading = useStore(chat, state => state.loading);
  const question = items.find(
    (item): item is Extract<ChatItem, { type: 'question' }> => item.type === 'question' && item.status === 'pending',
  );
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const busy = agentState === 'busy' || agentState === 'starting';
  const activeAgentId =
    (sessionId || items.length > 0 ? applied?.agent : null) ?? options.agent ?? status?.active ?? 'claude';
  const agent = status?.agents.find(entry => entry.id === activeAgentId) ?? status?.agents[0];
  const available = agent?.available ?? true;
  const pending = pendingChange(model, applied, options);

  useEffect(() => {
    void chat.getState().loadStatus();
  }, [chat]);

  useEffect(() => {
    conversations.getState().setActiveView(projectId ?? '', sessionId);
    return () => conversations.getState().setActiveView('', null);
  }, [conversations, projectId, sessionId]);

  // A conversation clicked in the rail under another project opens once this project's engine is up.
  useEffect(() => {
    const pending = ui.getState().pendingConversation;
    if (!pending || projectId === null || !sameRoot(pending.root, projectId)) return;
    ui.getState().setPendingConversation(null);
    void chat.getState().resume(pending.sessionId, pending.agent);
  }, [chat, ui, projectId]);

  // Follow the conversation while the user is at the bottom; leave them alone when they scrolled up.
  useEffect(() => {
    const element = scroller.current;
    if (element && pinned.current && items.length > 0) element.scrollTop = element.scrollHeight;
  }, [items]);

  const openTerminal = () => dispatch({ type: 'inspector.open', tab: 'terminal' });

  return (
    <section aria-label={t.region} className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto_auto]">
      <div
        ref={scroller}
        onScroll={event => {
          const element = event.currentTarget;
          pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        }}
        className="min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain"
      >
        <div className="mx-auto grid w-full max-w-3xl min-w-0 gap-3.5 px-4 py-6">
          {items.length === 0 && loading ? (
            <p role="status" className="py-20 text-center text-[13px] text-fg-muted motion-safe:animate-pulse">
              {t.loadingConversation}
            </p>
          ) : items.length === 0 ? (
            <div className="grid justify-items-center gap-3 py-20 text-center">
              <span className="grid size-10 place-items-center rounded-xl border border-divider bg-surface text-fg-muted">
                <Icon icon={MessageSquare} size={18} />
              </span>
              <p className="max-w-md text-[13px] text-balance text-fg-muted">
                {agent?.label && agent.id !== 'claude' ? t.emptyFor(agent.label) : t.empty}
              </p>
              {status ? (
                <p className="text-xs text-fg-muted/80">
                  {status.workspace.mode === 'studio' ? t.studioMode : t.projectMode}
                </p>
              ) : null}
            </div>
          ) : (
            groupTools(items).map(item =>
              item.type === 'tools' ? (
                <ToolGroup key={item.id} tools={item.tools} />
              ) : (
                <Entry
                  key={item.id}
                  item={item}
                  chat={chat}
                  agentName={agent?.label ?? 'El agente'}
                  onOpenTerminal={openTerminal}
                />
              ),
            )
          )}
          {error ? (
            <div role="alert" className="rounded-xl border border-breach/50 bg-breach/5 p-3 text-[13px] text-fg">
              {error.message}
            </div>
          ) : null}
        </div>
      </div>

      {question ? (
        <QuestionPanel key={question.id} item={question} chat={chat} agentName={agent?.label ?? 'El agente'} />
      ) : null}
      <Composer
        agent={agent}
        available={available}
        busy={busy}
        pending={
          pending
            ? {
                text: pending.text,
                title: [t.appliesNext, pending.modelChanges ? t.modelSwitchCost : null].filter(Boolean).join(' '),
              }
            : null
        }
      />
    </section>
  );
}
