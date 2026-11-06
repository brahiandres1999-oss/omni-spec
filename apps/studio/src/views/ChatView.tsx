/**
 * Agent chat (docs/STUDIO-AGENT-COCKPIT.md): the user talks to their own Claude Code; every tool call shows
 * up as a card, and edits or commands wait for Aprobar / Rechazar.
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
  Icon,
  MessageSquare,
  RotateCcw,
  SendHorizontal,
  ShieldAlert,
  Square,
  SquareTerminal,
  X,
} from '@/components/ui/icon';
import { cn, focusRing, mono } from '@/components/ui/interaction';
import { messages } from '@/i18n/messages.es';
import type { ChatItem, ChatStore, ToolInput } from '@/stores/chat';

const t = messages.chat;

function stringField(input: ToolInput, key: string): string | null {
  const value = input?.[key];
  return typeof value === 'string' ? value : null;
}

/** What the tool will do, in the form a person reviews it: the command, the replaced text, the new file. */
function ToolPreview({ input }: { input: ToolInput }) {
  if (!input) return null;
  const command = stringField(input, 'command');
  const oldText = stringField(input, 'old_string');
  const newText = stringField(input, 'new_string');
  const content = stringField(input, 'content');
  const block = 'max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-divider p-2 text-xs';
  if (command) return <pre className={cn(block, mono, 'bg-canvas')}>{command}</pre>;
  if (oldText !== null || newText !== null)
    return (
      <div className="grid gap-1.5">
        {oldText ? <pre className={cn(block, mono, 'bg-breach/10 text-fg')}>{oldText}</pre> : null}
        {newText ? <pre className={cn(block, mono, 'bg-attested/10 text-fg')}>{newText}</pre> : null}
      </div>
    );
  if (content !== null) return <pre className={cn(block, mono, 'bg-attested/10')}>{content}</pre>;
  return <pre className={cn(block, mono, 'bg-canvas text-fg-muted')}>{JSON.stringify(input, null, 2)}</pre>;
}

function ToolCard({ item }: { item: Extract<ChatItem, { type: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const tone = item.status === 'error' ? 'text-breach' : item.status === 'running' ? 'text-accent' : 'text-fg-muted';
  const label = item.status === 'error' ? t.toolError : item.status === 'running' ? t.toolRunning : t.toolDone;
  return (
    <div className="rounded-lg border border-divider bg-surface">
      <button
        type="button"
        className={cn('flex w-full min-w-0 items-center gap-2 px-3 py-2 text-start text-[13px]', focusRing)}
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <Icon icon={open ? ChevronDown : ChevronRight} className="text-fg-muted" />
        <span className="font-medium text-fg">{item.name}</span>
        <span className={cn(mono, 'min-w-0 flex-1 truncate text-xs text-fg-muted')}>{item.title}</span>
        <span className={cn('text-xs', tone)}>{label}</span>
      </button>
      {open ? (
        <div className="grid gap-2 border-t border-divider px-3 py-2">
          <ToolPreview input={item.input} />
          {item.output ? (
            <>
              <span className="text-xs text-fg-muted">{t.output}</span>
              <pre
                className={cn(
                  mono,
                  'max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-divider bg-canvas p-2 text-xs',
                  item.status === 'error' && 'text-breach',
                )}
              >
                {item.output}
              </pre>
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
        'grid gap-2 rounded-lg border p-3',
        pending ? 'border-accent/60 bg-accent/5' : 'border-divider bg-surface',
      )}
    >
      <div className="flex items-center gap-2 text-[13px]">
        <Icon icon={ShieldAlert} className={pending ? 'text-accent' : 'text-fg-muted'} />
        <span className="font-medium text-fg">{t.permissionTitle(item.toolName)}</span>
        <span className={cn(mono, 'min-w-0 flex-1 truncate text-xs text-fg-muted')}>{item.title}</span>
      </div>
      {item.reason ? <p className="text-xs text-fg-muted">{item.reason}</p> : null}
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
        <span className={cn('text-xs', item.status === 'allow' ? 'text-attested' : 'text-breach')}>
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
          <p className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-floating px-3.5 py-2 text-[14px] text-fg">
            {item.text}
          </p>
        </div>
      );
    case 'text':
      return <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-fg">{item.text}</p>;
    case 'tool':
      return <ToolCard item={item} />;
    case 'permission':
      return <PermissionCard item={item} chat={chat} />;
    case 'result':
      return (
        <p className={cn('text-xs', item.isError ? 'text-breach' : 'text-fg-muted')}>
          {item.isError
            ? t.turnFailed
            : t.turnDone(
                ((item.durationMs ?? 0) / 1000).toFixed(1),
                item.costUsd !== null ? `US$ ${item.costUsd.toFixed(4)}` : null,
              )}
        </p>
      );
    case 'error':
      return (
        <div role="alert" className="grid gap-2 rounded-lg border border-breach/50 bg-breach/5 p-3 text-[13px] text-fg">
          <span className="flex items-center gap-2">
            <Icon icon={CircleAlert} className="text-breach" />
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

export function ChatView() {
  const { project, dispatch } = useStudio();
  const chat = project.chat;
  const items = useStore(chat, state => state.items);
  const agentState = useStore(chat, state => state.agentState);
  const model = useStore(chat, state => state.model);
  const status = useStore(chat, state => state.status);
  const draft = useStore(chat, state => state.draft);
  const error = useStore(chat, state => state.error);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const busy = agentState === 'busy' || agentState === 'starting';
  const available = status?.agents.find(agent => agent.id === status.active)?.available ?? true;

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
      <header className="flex h-10 items-center gap-2 border-b border-divider px-4 text-[13px]">
        <span
          aria-hidden="true"
          className={cn(
            'size-2 rounded-full',
            !available ? 'bg-breach' : busy ? 'motion-safe:animate-pulse bg-accent' : 'bg-attested',
          )}
        />
        <span className="font-medium text-fg">{t.agent}</span>
        <span className="text-fg-muted">{available ? (t.states[agentState] ?? '') : t.unavailable}</span>
        {model ? <span className={cn(mono, 'truncate text-xs text-fg-muted')}>{t.model(model)}</span> : null}
        <span className="flex-1" />
        {status ? (
          <span className="hidden truncate text-xs text-fg-muted lg:inline">
            {status.workspace.mode === 'studio' ? t.studioMode : t.projectMode}
          </span>
        ) : null}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t.reset}
          title={t.reset}
          disabled={items.length === 0}
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
        className="min-h-0 overflow-y-auto"
      >
        <div className="mx-auto grid w-full max-w-3xl gap-3 px-4 py-5">
          {items.length === 0 ? (
            <div className="grid justify-items-center gap-3 py-16 text-center">
              <Icon icon={MessageSquare} size={18} className="text-fg-muted" />
              <p className="max-w-md text-[13px] text-fg-muted">{t.empty}</p>
            </div>
          ) : (
            items.map(item => <Entry key={item.id} item={item} chat={chat} onOpenTerminal={openTerminal} />)
          )}
          {error ? (
            <div role="alert" className="rounded-lg border border-breach/50 bg-breach/5 p-3 text-[13px] text-fg">
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
        <div className="flex items-end gap-2 rounded-2xl border border-floating-border bg-floating p-2">
          <textarea
            aria-label={t.placeholder}
            value={draft}
            rows={Math.min(8, Math.max(1, draft.split('\n').length))}
            placeholder={t.placeholder}
            onChange={event => chat.getState().setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            className="max-h-48 min-h-8 flex-1 resize-none bg-transparent px-2 py-1.5 text-[14px] text-fg outline-none placeholder:text-fg-muted"
          />
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
      </form>
    </section>
  );
}
