/**
 * Central stage (SH-01, SH-07): the five view tabs (Ctrl+1…Ctrl+5, persisted) and the floating dock.
 * Only the active view is mounted; its data stays in the stores, so switching back is instant.
 */
import { useStore } from 'zustand';
import { useStudio } from '@/app/studio-context';
import { Button } from '@/components/ui/button';
import {
  FileDiff,
  Gauge,
  Icon,
  KanbanSquare,
  MessageSquare,
  Network,
  PanelRight,
  Sparkles,
} from '@/components/ui/icon';
import { ProtectedState } from '@/components/ui/ProtectedState';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ErrorState, SkeletonBar } from '@/components/ui/view-state';
import { messages } from '@/i18n/messages.es';
import { STAGE_TABS, type StageTab } from '@/stores/layout';
import { BoardView } from '@/views/BoardView';
import { CartographyView } from '@/views/CartographyView';
import { ChatView } from '@/views/ChatView';
import { DiffView } from '@/views/DiffView';
import { FinopsView } from '@/views/FinopsView';
import { SkillsView } from '@/views/SkillsView';
import { Dock } from './Dock';

function InspectorToggle() {
  const { layout, dispatch } = useStudio();
  const collapsed = useStore(layout, state => state.inspectorCollapsed);
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={messages.shell.toggleInspector}
      aria-expanded={!collapsed}
      title={`${messages.shell.toggleInspector} (Ctrl+J)`}
      onClick={() => dispatch({ type: 'inspector.toggle' })}
    >
      <Icon icon={PanelRight} />
    </Button>
  );
}

const ICONS = {
  chat: MessageSquare,
  kanban: KanbanSquare,
  cartography: Network,
  diffs: FileDiff,
  finops: Gauge,
  skills: Sparkles,
} as const;

function ActiveView({ tab }: { tab: StageTab }) {
  const { snapshot } = useStudio();
  const spec = useStore(snapshot, state => state.data?.activeSpec?.id ?? '');
  switch (tab) {
    case 'chat':
      return <ChatView />;
    case 'kanban':
      return <BoardView />;
    case 'cartography':
      return <CartographyView />;
    case 'diffs':
      return <DiffView spec={spec} />;
    case 'finops':
      return <FinopsView />;
    case 'skills':
      return <SkillsView />;
  }
}

export function Stage() {
  const { layout, snapshot, projectId } = useStudio();
  const tab = useStore(layout, state => state.stageTab);
  const snapshotStatus = useStore(snapshot, state => state.status);
  const snapshotError = useStore(snapshot, state => state.error);

  return (
    <main className="relative grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] bg-canvas">
      <Tabs value={tab} onValueChange={value => layout.getState().setStageTab(value as StageTab)} className="contents">
        <div className="flex h-11 items-center gap-2 border-b border-divider px-3">
          <TabsList aria-label={messages.shell.stageTabs}>
            {STAGE_TABS.map(value => (
              <TabsTrigger key={value} value={value} className="ps-2.5 pe-3.5">
                <Icon icon={ICONS[value]} />
                {messages.shell.tabs[value]}
              </TabsTrigger>
            ))}
          </TabsList>
          <span className="flex-1" />
          <InspectorToggle />
        </div>
        {projectId === null ? (
          <div className="min-h-0">
            {snapshotStatus === 'error' ? (
              <ErrorState error={snapshotError} onRetry={() => void snapshot.getState().retry()} />
            ) : snapshotStatus === 'protected' ? (
              <ProtectedState reason={snapshotError?.detail ?? ''} />
            ) : (
              <div aria-busy="true" className="flex h-12 items-center gap-3 border-b border-divider px-4">
                <SkeletonBar className="w-48" />
              </div>
            )}
          </div>
        ) : (
          <TabsContent value={tab} className="min-h-0">
            <ActiveView key={projectId} tab={tab} />
          </TabsContent>
        )}
      </Tabs>
      {/* The chat has its own composer; the terminal dock stays for the other views. */}
      {tab === 'chat' ? null : <Dock />}
    </main>
  );
}
