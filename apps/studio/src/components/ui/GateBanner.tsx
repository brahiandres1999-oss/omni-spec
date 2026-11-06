/**
 * Inline governance banner of the diff reviewer (VD-07): Gate 2 refused by the engine. Same exact text as the
 * Protected state, shown above the diff without hiding it; the approval control disappears with it.
 */
import { messages } from '@/i18n/messages.es';
import { Icon, ShieldAlert } from './icon';

export function GateBanner({ reason }: { reason: string }) {
  return (
    <div
      data-state="protected"
      className="flex items-start gap-3 border-b border-governance/40 bg-governance/10 px-4 py-2.5 text-[13px]"
    >
      <Icon icon={ShieldAlert} size={18} className="mt-0.5 text-governance" />
      <div className="min-w-0 space-y-0.5">
        <p className="text-pretty font-medium text-fg">{messages.states.gate2}</p>
        <p className="text-pretty text-governance">
          {messages.states.protectedReason}: {reason}
        </p>
      </div>
    </div>
  );
}
