/**
 * Agent chat (docs/STUDIO-AGENT-COCKPIT.md): the user talks to their own Claude Code. Answers render as
 * Markdown, every tool call is a card, edits show a line diff, and edits or commands wait for Aprobar /
 * Rechazar. The composer carries the model and effort for the next turns; the header shows context and cost.
 */
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
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
  SendHorizontal,
  ShieldAlert,
  Sparkles,
  Square,
  SquareTerminal,
  X,
} from '@/components/ui/icon';
import { cn, focusRing, mono } from '@/components/ui/interaction';
import { LineDiff } from '@/components/ui/line-diff';
import { Markdown } from '@/components/ui/markdown';
import { type MenuOption, OptionMenu } from '@/components/ui/option-menu';
import { formatInt, messages } from '@/i18n/messages.es';
import type { AgentUsage, ChatItem, ChatStore, ToolInput } from '@/stores/chat';

const t = messages.chat;
const DEFAULT = '';

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

function ToolCard({ item }: { item: Extract<ChatItem, { type: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const tone = item.status === 'error' ? 'text-breach' : item.status === 'running' ? 'text-accent' : 'text-fg-muted';
  const label = item.status === 'error' ? t.toolError : item.status === 'running' ? t.toolRunning : t.toolDone;
  return (
    <div className="rounded-xl border border-divider bg-surface">
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
        <Icon icon={open ? ChevronDown : ChevronRight} className="text-fg-muted" />
        <span className="font-medium text-fg">{item.name}</span>
        <span className={cn(mono, 'min-w-0 flex-1 truncate text-xs text-fg-muted')}>{item.title}</span>
        <span className={cn('flex items-center gap-1.5 text-xs', tone)}>
          <span
            aria-hidden="true"
            className={cn('size-1.5 rounded-full bg-current', item.status === 'running' && 'motion-safe:animate-pulse')}
          />
          {label}
        </span>
      </button>
      {open ? (
        <div className="grid gap-2 border-t border-divider px-3 py-2.5">
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

function PermissionCard({ item, chat }: { item: Extract<ChatItem, { type: 'permission' }>; chat: ChatStore }) {
  const pending = item.status === 'pending';
  return (
    <section
      aria-label={t.permissionTitle(item.toolName)}
      className={cn(
        'grid gap-2.5 rounded-xl border p-3',
        pending ? 'border-accent/50 bg-accent/5' : 'border-divider bg-surface',
      )}
    >
      <div className="flex min-w-0 items-center gap-2 text-[13px]">
        <Icon icon={ShieldAlert} className={pending ? 'text-accent' : 'text-fg-muted'} />
        <span className="font-medium text-fg">{t.permissionTitle(item.toolName)}</span>
        <span className={cn(mono, 'min-w-0 flex-1 truncate text-xs text-fg-muted')}>{item.title}</span>
      </div>
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

function Entry({ item, chat, onOpenTerminal }: { item: ChatItem; chat: ChatStore; onOpenTerminal(): void }) {
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
      return <PermissionCard item={item} chat={chat} />;
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

const compact = (value: number) =>
  value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`
    : value >= 1000
      ? `${Math.round(value / 1000)}k`
      : formatInt(value);

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
          className="h-1.5 w-20 overflow-hidden rounded-full bg-divider"
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
      {cost ? <span className="hidden xl:inline">· ≈ US$ {cost}</span> : null}
    </div>
  );
}

export function ChatView() {
  const { project, dispatch } = useStudio();
  const chat = project.chat;
  const items = useStore(chat, state => state.items);
  const agentState = useStore(chat, state => state.agentState);
  const model = useStore(chat, state => state.model);
  const status = useStore(chat, state => state.status);
  const draft = useStore(chat, state => state.draft);
  const error = useStore(chat, state => state.error);
  const options = useStore(chat, state => state.options);
  const usage = useStore(chat, state => state.usage);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const pinned = useRef(true);
  const busy = agentState === 'busy' || agentState === 'starting';
  const agent = status?.agents.find(entry => entry.id === status.active);
  const available = agent?.available ?? true;

  const modelOptions: MenuOption[] = [
    { value: DEFAULT, label: t.defaultOption },
    ...(agent?.models ?? Object.keys(t.models)).map(value => ({ value, label: t.models[value] ?? value })),
  ];
  const effortOptions: MenuOption[] = [
    { value: DEFAULT, label: t.defaultOption },
    ...(agent?.efforts ?? Object.keys(t.efforts)).map(value => ({ value, label: t.efforts[value] ?? value })),
  ];

  useEffect(() => {
    void chat.getState().loadStatus();
  }, [chat]);

  // Follow the conversation while the user is at the bottom; leave them alone when they scrolled up.
  useEffect(() => {
    const element = scroller.current;
    if (element && pinned.current && items.length > 0) element.scrollTop = element.scrollHeight;
  }, [items]);

  const openTerminal = () => dispatch({ type: 'inspector.open', tab: 'terminal' });

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void chat.getState().send();
    } else if (event.key === 'Escape' && busy) {
      event.preventDefault();
      void chat.getState().cancel();
    }
  };

  return (
    <section aria-label={t.region} className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
      <header className="flex h-11 min-w-0 items-center gap-2.5 border-b border-divider px-4 text-[13px]">
        <span
          aria-hidden="true"
          className={cn(
            'size-2 shrink-0 rounded-full',
            !available ? 'bg-breach' : busy ? 'bg-accent motion-safe:animate-pulse' : 'bg-attested',
          )}
        />
        <span className="font-medium text-fg">{agent?.label ?? t.agent}</span>
        <span className="truncate text-fg-muted">{available ? (t.states[agentState] ?? '') : t.unavailable}</span>
        {model ? <span className={cn(mono, 'hidden truncate text-xs text-fg-muted md:inline')}>{model}</span> : null}
        <span className="flex-1" />
        <ContextMeter usage={usage} />
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t.reset}
          title={t.reset}
          disabled={items.length === 0 || busy}
          onClick={() => void chat.getState().reset()}
        >
          <Icon icon={RotateCcw} />
        </Button>
      </header>

      <div
        ref={scroller}
        onScroll={event => {
          const element = event.currentTarget;
          pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        }}
        className="min-h-0 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto grid w-full max-w-3xl gap-3.5 px-4 py-6">
          {items.length === 0 ? (
            <div className="grid justify-items-center gap-3 py-20 text-center">
              <span className="grid size-10 place-items-center rounded-xl border border-divider bg-surface text-fg-muted">
                <Icon icon={MessageSquare} size={18} />
              </span>
              <p className="max-w-md text-[13px] text-balance text-fg-muted">{t.empty}</p>
              {status ? (
                <p className="text-xs text-fg-muted/80">
                  {status.workspace.mode === 'studio' ? t.studioMode : t.projectMode}
                </p>
              ) : null}
            </div>
          ) : (
            items.map(item => <Entry key={item.id} item={item} chat={chat} onOpenTerminal={openTerminal} />)
          )}
          {error ? (
            <div role="alert" className="rounded-xl border border-breach/50 bg-breach/5 p-3 text-[13px] text-fg">
              {error.message}
            </div>
          ) : null}
        </div>
      </div>

      <form
        className="mx-auto w-full max-w-3xl px-4 pb-4"
        onSubmit={event => {
          event.preventDefault();
          void chat.getState().send();
        }}
      >
        {/* Concentric corners: rounded-2xl (16px) frame = rounded-lg (8px) controls + p-2 (8px). */}
        <div
          className="grid gap-1 rounded-2xl border border-floating-border bg-floating p-2 transition-[border-color] duration-150 ease-out focus-within:border-fg-muted/40"
          onPointerDown={event => {
            if (event.target === event.currentTarget) input.current?.focus();
          }}
        >
          <textarea
            ref={input}
            aria-label={t.placeholder}
            value={draft}
            rows={Math.min(8, Math.max(2, draft.split('\n').length))}
            placeholder={t.placeholder}
            onChange={event => chat.getState().setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            className="max-h-56 min-h-12 resize-none bg-transparent px-2 py-1.5 text-[14px] leading-relaxed text-fg outline-none placeholder:text-fg-muted"
          />
          <div className="flex items-center gap-1">
            <OptionMenu
              label={t.modelLabel}
              value={options.model ?? DEFAULT}
              options={modelOptions}
              icon={Sparkles}
              onChange={value => chat.getState().setOptions({ model: value || null })}
            />
            <OptionMenu
              label={t.effortLabel}
              value={options.effort ?? DEFAULT}
              options={effortOptions}
              icon={Gauge}
              display={t.effortPill(
                options.effort ? (t.efforts[options.effort] ?? options.effort) : t.defaultOption.toLowerCase(),
              )}
              onChange={value => chat.getState().setOptions({ effort: value || null })}
            />
            <span className="flex-1" />
            {busy ? (
              <Button
                variant="secondary"
                size="icon"
                aria-label={t.stop}
                title={`${t.stop} (Esc)`}
                onClick={() => void chat.getState().cancel()}
              >
                <Icon icon={Square} />
              </Button>
            ) : (
              <Button
                variant="primary"
                size="icon"
                type="submit"
                aria-label={t.send}
                disabled={!draft.trim() || !available}
              >
                <Icon icon={SendHorizontal} />
              </Button>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}
