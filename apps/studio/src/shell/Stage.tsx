/**
 * Central stage (docs/STUDIO-AGENT-COCKPIT.md, Fase 3 vueltas 2a y 2b): one page at a time, chosen from the
 * rail — the conversation, or Specs, Memoria, Uso. The top row says where you are («Proyecto / Título») and, on
 * the conversation, carries the agent status; the last button folds the «Resumen» panel (Ctrl+J) and shows
 * the +N −M this conversation changed.
 * Only the active page is mounted; its data stays in the stores, so switching back is instant.
 */
import { useStore } from 'zustand';
import { useStudio } from '@/app/studio-context';
import { Button } from '@/components/ui/button';
import { ChevronRight, Icon, PanelRight } from '@/components/ui/icon';
import { ProtectedState } from '@/components/ui/ProtectedState';
import { ErrorState, SkeletonBar } from '@/components/ui/view-state';
import { messages } from '@/i18n/messages.es';
import { rootKey } from '@/stores/conversations';
import type { StageTab } from '@/stores/layout';
import { BoardView } from '@/views/BoardView';
import { ChatHeader, ChatView } from '@/views/ChatView';
import { Counts, useConversationReview } from '@/views/ConversationReview';
import { FinopsView } from '@/views/FinopsView';
import { MemoryView } from '@/views/MemoryView';
import { projectName } from './TitleBar';

const t = messages.shell;

function InspectorToggle() {
  const { layout, dispatch } = useStudio();
  const collapsed = useStore(layout, state => state.inspectorCollapsed);
  const { added, removed } = useConversationReview();
  const changed = added + removed > 0;
  const label = changed ? messages.review.toggleWithCounts(added, removed) : t.toggleInspector;
  return (
    <Button
      size={changed ? 'sm' : 'icon-sm'}
      variant="ghost"
      aria-label={label}
      aria-expanded={!collapsed}
      title={`${label} (Ctrl+J)`}
      onClick={() => dispatch({ type: 'inspector.toggle' })}
    >
      {changed ? <Counts added={added} removed={removed} /> : null}
      <Icon icon={PanelRight} />
    </Button>
  );
}

function ActivePage({ tab }: { tab: StageTab }) {
  switch (tab) {
    case 'chat':
      return <ChatView />;
    case 'kanban':
      return <BoardView />;
    case 'memory':
      return <MemoryView />;
    case 'finops':
      return <FinopsView />;
  }
}

/** «Proyecto / Título»: the conversation's title on the chat, the page's name elsewhere. */
function Breadcrumb({ tab }: { tab: StageTab }) {
  const { projectId, project, conversations } = useStudio();
  const sessionId = useStore(project.chat, state => state.sessionId);
  const title = useStore(conversations, state =>
    projectId && sessionId
      ? state.byRoot[rootKey(projectId)]?.find(entry => entry.sessionId === sessionId)?.title
      : undefined,
  );
  const here = tab === 'chat' ? (title ?? t.untitledConversation) : t.tabs[tab];
  return (
    <nav aria-label={t.breadcrumb} className="flex min-w-0 items-center gap-1.5 text-[13px]">
      {projectId ? (
        <>
          <span className="shrink-0 text-fg-muted">{projectName(projectId)}</span>
          <Icon icon={ChevronRight} className="text-fg-muted/70" />
        </>
      ) : null}
      <span aria-current="page" className="truncate font-medium text-fg" title={here}>
        {here}
      </span>
    </nav>
  );
}

export function Stage() {
  const { layout, snapshot, projectId } = useStudio();
  const tab = useStore(layout, state => state.stageTab);
  const snapshotStatus = useStore(snapshot, state => state.status);
  const snapshotError = useStore(snapshot, state => state.error);

  return (
    <main className="relative grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] bg-canvas">
      {/* A size container: the chat status drops detail as this row narrows, not the window. */}
      <div className="@container flex h-11 min-w-0 items-center gap-2 border-b border-divider px-4">
        <Breadcrumb tab={tab} />
        <span className="flex-1" />
        {tab === 'chat' && projectId !== null ? (
          <>
            <ChatHeader />
            <span aria-hidden="true" className="h-5 w-px shrink-0 bg-divider" />
          </>
        ) : null}
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
        <div className="min-h-0">
          <ActivePage key={projectId} tab={tab} />
        </div>
      )}
    </main>
  );
}
