/**
 * shadcn/ui button, customised for Omni Studio (§1.17.3): the upstream catch-all transition is replaced by the
 * Better UI press `enabled:active:scale-[0.96] transition-[scale,background-color,border-color] duration-150
 * ease-out`; buttons with an icon and text use the asymmetric `ps-2.5 pe-3.5` padding (DS-12).
 */
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type LucideIcon } from './icon';
import { cn } from './interaction';

export const buttonVariants = cva(
  [
    'inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border text-[13px] font-medium',
    'enabled:active:scale-[0.96] transition-[scale,background-color,border-color] duration-150 ease-out',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    'disabled:cursor-not-allowed disabled:opacity-45',
  ],
  {
    variants: {
      variant: {
        primary:
          'border-accent bg-accent text-canvas enabled:hover:border-accent-bright enabled:hover:bg-accent-bright',
        secondary:
          'border-floating-border bg-floating text-fg enabled:hover:border-fg-muted/40 enabled:hover:bg-divider',
        ghost: 'border-transparent bg-transparent text-fg-muted enabled:hover:bg-divider enabled:hover:text-fg',
        danger: 'border-breach/50 bg-transparent text-breach enabled:hover:bg-breach/10',
      },
      size: {
        sm: 'h-7 px-2.5 text-xs',
        md: 'h-8 px-3',
        icon: 'size-8',
        'icon-sm': 'size-7',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Leading icon; with visible text the button switches to the asymmetric padding. */
  icon?: LucideIcon;
  children?: ReactNode;
}

export function Button({ className, variant, size, icon, children, type = 'button', ...props }: ButtonProps) {
  const iconAndText = icon !== undefined && children !== undefined && size !== 'icon' && size !== 'icon-sm';
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), iconAndText && 'ps-2.5 pe-3.5', className)}
      {...props}
    >
      {icon ? <Icon icon={icon} /> : null}
      {children}
    </button>
  );
}
