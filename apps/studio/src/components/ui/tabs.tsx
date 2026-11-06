/** shadcn/ui tabs over Radix Tabs (arrow-key navigation, automatic activation), Obsidian styling. */
import { Tabs as RadixTabs } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn, focusRing, press } from './interaction';

export const Tabs = RadixTabs.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof RadixTabs.List>) {
  return <RadixTabs.List className={cn('flex items-center gap-0.5', className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      className={cn(
        'inline-flex h-7 select-none items-center gap-1.5 rounded-md border border-transparent px-2.5 text-xs text-fg-muted',
        'hover:text-fg data-[state=active]:border-floating-border data-[state=active]:bg-floating data-[state=active]:text-fg',
        press,
        focusRing,
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof RadixTabs.Content>) {
  return <RadixTabs.Content className={cn('min-h-0 outline-none', className)} {...props} />;
}
