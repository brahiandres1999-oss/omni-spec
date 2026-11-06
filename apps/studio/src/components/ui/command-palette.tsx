/**
 * command-palette (SH-10): modal Ctrl+K search over views, specs, files and actions with fuzzy subsequence
 * matching (accent- and case-insensitive). Radix Dialog traps focus and returns it to its origin on Esc.
 */
import { Dialog } from 'radix-ui';
import { type KeyboardEvent, useId, useMemo, useState } from 'react';
import { Icon, type LucideIcon, Search } from './icon';
import { cn, mono } from './interaction';

export interface PaletteItem {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon?: LucideIcon;
  run(): void;
}

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Subsequence score: lower is better; `null` when `query` is not a subsequence of `text`. */
export function fuzzyScore(query: string, text: string): number | null {
  const needle = fold(query).replace(/\s+/g, '');
  if (!needle) return 0;
  const haystack = fold(text);
  let score = 0;
  let last = -1;
  for (const char of needle) {
    const found = haystack.indexOf(char, last + 1);
    if (found < 0) return null;
    score += found - last - 1;
    last = found;
  }
  return score + haystack.length / 100;
}

const MAX_RESULTS = 50;

export function CommandPalette({
  open,
  onOpenChange,
  items,
  labels,
  returnFocusTo,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Without a Dialog.Trigger, Radix has nowhere to return focus: the caller says where. */
  returnFocusTo?: HTMLElement | null;
  items: PaletteItem[];
  labels: { title: string; empty: string; groups: Record<string, string> };
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();

  const results = useMemo(() => {
    const scored: Array<{ item: PaletteItem; score: number }> = [];
    for (const item of items) {
      const score = fuzzyScore(query, `${item.label} ${item.hint ?? ''}`);
      if (score !== null) scored.push({ item, score });
    }
    return scored
      .sort((a, b) => a.score - b.score)
      .slice(0, MAX_RESULTS)
      .map(entry => entry.item);
  }, [items, query]);
  const activeIndex = Math.min(active, Math.max(0, results.length - 1));
  const optionId = (index: number) => `${listId}-${index}`;

  const choose = (item: PaletteItem | undefined) => {
    if (!item) return;
    onOpenChange(false);
    item.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') setActive(Math.min(results.length - 1, activeIndex + 1));
    else if (event.key === 'ArrowUp') setActive(Math.max(0, activeIndex - 1));
    else if (event.key === 'Enter') choose(results[activeIndex]);
    else return;
    event.preventDefault();
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={next => {
        if (!next) {
          setQuery('');
          setActive(0);
        }
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-canvas/60" />
        <Dialog.Content
          aria-modal="true"
          aria-describedby={undefined}
          onCloseAutoFocus={event => {
            event.preventDefault();
            if (returnFocusTo?.isConnected) returnFocusTo.focus();
          }}
          className="fixed start-1/2 top-[14vh] z-50 flex w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-floating-border bg-floating text-fg"
        >
          <Dialog.Title className="sr-only">{labels.title}</Dialog.Title>
          <div className="flex items-center gap-2 border-b border-divider px-3">
            <Icon icon={Search} size={18} className="text-fg-muted" />
            <input
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={results.length > 0 ? optionId(activeIndex) : undefined}
              aria-label={labels.title}
              placeholder={labels.title}
              value={query}
              onChange={event => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              className="h-12 min-w-0 flex-1 bg-transparent text-sm text-fg placeholder:text-fg-muted focus-visible:outline-none"
            />
          </div>
          <div
            id={listId}
            role="listbox"
            aria-label={labels.title}
            className="max-h-[50vh] overflow-y-auto overscroll-contain p-1.5"
          >
            {results.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-fg-muted">{labels.empty}</p>
            ) : (
              results.map((item, index) => (
                // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard handled by the combobox.
                // biome-ignore lint/a11y/useFocusableInteractive: options are reached through the combobox's aria-activedescendant
                <div
                  key={item.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseMove={() => setActive(index)}
                  onClick={() => choose(item)}
                  className={cn(
                    'flex h-9 cursor-default items-center gap-2.5 rounded-[10px] px-2.5 text-[13px]',
                    index === activeIndex ? 'bg-divider text-fg' : 'text-fg-muted',
                  )}
                >
                  {item.icon ? <Icon icon={item.icon} /> : null}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.hint ? (
                    <span className={cn('truncate text-[11px] text-fg-muted', mono)}>{item.hint}</span>
                  ) : null}
                  <span className="shrink-0 text-[11px] text-fg-muted">{labels.groups[item.group] ?? item.group}</span>
                </div>
              ))
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
