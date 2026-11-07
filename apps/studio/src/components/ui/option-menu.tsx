/**
 * Compact pill that opens a single-choice menu (model, effort, secondary views). Radix handles focus, arrow
 * keys and Escape; the pill shows the current choice so the setting is visible without opening it.
 */
import { DropdownMenu } from 'radix-ui';
import type { ReactNode } from 'react';
import { Check, ChevronDown, Icon, type LucideIcon } from './icon';
import { cn, focusRing, press } from './interaction';

export interface MenuOption {
  value: string;
  label: string;
  hint?: string;
}

const item = cn(
  'relative flex min-h-8 cursor-default select-none items-center gap-2 rounded-md ps-7 pe-3 py-1.5 text-[13px] text-fg outline-none',
  'data-[highlighted]:bg-divider data-[disabled]:opacity-45',
);

export function OptionMenu({
  label,
  value,
  options,
  onChange,
  icon,
  display,
  disabled,
  side = 'top',
  tone,
}: {
  /** Accessible name of the setting ("Modelo"). */
  label: string;
  value: string;
  options: MenuOption[];
  onChange(value: string): void;
  icon?: LucideIcon;
  /** What the pill shows; defaults to the selected option's label. */
  display?: ReactNode;
  disabled?: boolean;
  /** Where the menu opens: the composer opens upwards, the tab bar downwards. */
  side?: 'top' | 'bottom';
  /** `danger` paints the pill red (permisos «Sin restricciones»). */
  tone?: 'danger';
}) {
  const current = options.find(option => option.value === value);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        disabled={disabled}
        aria-label={`${label}: ${current?.label ?? value}`}
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-lg border border-transparent ps-2 pe-1.5 text-xs text-fg-muted',
          'transition-[scale,background-color,color] duration-150 ease-out enabled:hover:bg-divider enabled:hover:text-fg',
          'disabled:opacity-45 data-[state=open]:bg-divider data-[state=open]:text-fg',
          press,
          focusRing,
          tone === 'danger' &&
            'border-breach/50 bg-breach/10 text-breach enabled:hover:bg-breach/15 enabled:hover:text-breach',
        )}
        data-tone={tone}
      >
        {icon ? <Icon icon={icon} /> : null}
        <span className="tabular-nums">{display ?? current?.label ?? value}</span>
        <Icon icon={ChevronDown} className="opacity-70" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side={side}
          align="start"
          sideOffset={6}
          className="z-50 min-w-48 rounded-xl border border-floating-border bg-floating p-1"
        >
          <DropdownMenu.Label className="px-3 pt-1.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-fg-muted">
            {label}
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={value} onValueChange={onChange}>
            {options.map(option => (
              <DropdownMenu.RadioItem key={option.value} value={option.value} className={item}>
                <DropdownMenu.ItemIndicator className="absolute start-2 inline-flex">
                  <Icon icon={Check} className="text-accent" />
                </DropdownMenu.ItemIndicator>
                <span className="flex-1">{option.label}</span>
                {option.hint ? <span className="text-xs text-fg-muted">{option.hint}</span> : null}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
