/**
 * inspector-drawer (STUDIO-DESIGN-SYSTEM.md §4, SH-02, SH-03): the collapsible right column with the
 * Terminal, Overview, FinOps and Files tabs. Collapsing animates only under `motion-safe:` and makes the
 * drawer inert, so hidden controls never take focus.
 */
import type { ReactNode } from 'react';
import { messages } from '@/i18n/messages.es';
import type { InspectorTab } from '@/stores/layout';
import { cn } from './interaction';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

export interface InspectorPanel {
  value: InspectorTab;
  label: string;
  content: ReactNode;
  /** Keep mounted while hidden (terminal sessions must survive tab switches). */
  keepMounted?: boolean;
}

export function InspectorDrawer({
  collapsed,
  tab,
  onTabChange,
  panels,
}: {
  collapsed: boolean;
  tab: InspectorTab;
  onTabChange(tab: InspectorTab): void;
  panels: InspectorPanel[];
}) {
  return (
    <aside
      aria-label={messages.shell.inspector}
      data-surface="panel"
      inert={collapsed}
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden border-s border-divider bg-surface',
        'motion-safe:transition-[opacity] motion-safe:duration-200 motion-safe:ease-out',
        collapsed ? 'opacity-0' : 'opacity-100',
      )}
    >
      <Tabs
        value={tab}
        onValueChange={value => onTabChange(value as InspectorTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList aria-label={messages.shell.inspector} className="h-10 shrink-0 border-b border-divider px-2">
          {panels.map(panel => (
            <TabsTrigger key={panel.value} value={panel.value}>
              {panel.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {panels.map(panel => (
          <TabsContent
            key={panel.value}
            value={panel.value}
            forceMount={panel.keepMounted ? true : undefined}
            className="min-h-0 flex-1 data-[state=inactive]:hidden"
          >
            {panel.content}
          </TabsContent>
        ))}
      </Tabs>
    </aside>
  );
}
