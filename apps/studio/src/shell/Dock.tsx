/** Wires the cockpit-input to the stores: skills catalog for modes, active ConPTY session, dock draft. */
import { useStore } from 'zustand';
import { useEnsureLoaded, useStudio } from '@/app/studio-context';
import { CockpitInput, FALLBACK_MODES } from '@/components/ui/cockpit-input';
import { messages } from '@/i18n/messages.es';
import { activeRunningSession } from '@/stores/terminal';

export function Dock() {
  const { client, project, terminal, ui, dispatch } = useStudio();
  const skills = useStore(project.skills, state => state.resource);
  useEnsureLoaded(skills);
  const catalog = useStore(skills, state => state.data);
  const target = useStore(terminal, activeRunningSession);
  const dock = useStore(ui, state => state.dock);

  const fromCatalog = (catalog?.items ?? []).map(item => item.name).filter(name => name.startsWith('omni-'));
  const modes = fromCatalog.length > 0 ? fromCatalog : [...FALLBACK_MODES];
  const mode =
    dock.mode && modes.includes(dock.mode)
      ? dock.mode
      : ((modes.includes('omni-specify') ? 'omni-specify' : modes[0]) ?? 'omni-specify');

  return (
    <CockpitInput
      target={target}
      modes={modes}
      mode={mode}
      draft={dock.draft}
      focusNonce={dock.focusNonce}
      labels={messages.dock}
      onModeChange={value => ui.getState().setDockMode(value)}
      onDraftChange={value => ui.getState().setDockDraft(value)}
      onSend={data => {
        if (!target) return;
        ui.getState().setDockDraft('');
        void client.call('pty.write', { id: target, data }).catch(() => undefined);
      }}
      onOpenTerminal={() => dispatch({ type: 'inspector.open', tab: 'terminal' })}
    />
  );
}
