/**
 * Protected state (blueprint §4.7.3): a governance lock, never an error. Shows the exact Gate 2 text and the
 * engine's concrete reason, with no approval control. One of the few places allowed to use the governance
 * amber (DS-05).
 */
import { messages } from '@/i18n/messages.es';
import { Icon, ShieldAlert } from './icon';
import { cn } from './interaction';

export function ProtectedState({
  reason,
  variant = 'block',
  className,
}: {
  reason: string;
  variant?: 'block' | 'inline';
  className?: string;
}) {
  if (variant === 'inline')
    return (
      <div
        data-state="protected"
        className={cn(
          'flex items-start gap-1.5 rounded-md border border-governance/40 bg-governance/10 px-2 py-1 text-[11px] text-governance',
          className,
        )}
      >
        <Icon icon={ShieldAlert} className="mt-px" />
        <span className="line-clamp-2 text-pretty">{reason}</span>
      </div>
    );

  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12', className)}>
      <div className="flex max-w-[60ch] flex-col gap-3 rounded-xl border border-governance/40 bg-governance/10 p-4">
        <div className="flex items-start gap-3">
          <Icon icon={ShieldAlert} size={18} className="mt-0.5 text-governance" />
          <p className="text-pretty text-[13px] font-medium text-fg">{messages.states.gate2}</p>
        </div>
        <p className="ps-[30px] text-pretty text-[13px] text-governance">
          {messages.states.protectedReason}: {reason}
        </p>
      </div>
    </div>
  );
}
