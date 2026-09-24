import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

export type ActionButtonVariant = 'primary' | 'secondary' | 'danger' | 'provider';

export interface ActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ActionButtonVariant;
  pending?: boolean;
  error?: boolean;
  pendingLabel?: string;
  icon?: React.ReactNode;
}

const VARIANT_CLASSES: Record<ActionButtonVariant, string> = {
  primary: 'bg-[#E5A93D] text-black hover:bg-[#f0b84c] border border-[#E5A93D]',
  secondary: 'bg-zinc-900 text-zinc-200 hover:bg-zinc-800 border border-zinc-700',
  danger: 'bg-red-500/15 text-red-200 hover:bg-red-500/25 border border-red-500/35',
  provider: 'bg-zinc-950 text-[#E5A93D] hover:bg-zinc-900 border border-current/30',
};

export function ActionButton({
  variant = 'secondary',
  pending = false,
  error = false,
  pendingLabel,
  icon,
  disabled,
  type,
  className,
  children,
  ...props
}: ActionButtonProps) {
  const isDisabled = disabled || pending;

  return (
    <button
      {...props}
      type={type ?? 'button'}
      disabled={isDisabled}
      aria-busy={pending || undefined}
      data-error={error ? 'true' : undefined}
      className={cn(
        'min-h-11 min-w-11 rounded-xl px-3 inline-flex items-center justify-center gap-2 text-sm font-bold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A93D]/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black',
        'disabled:cursor-not-allowed disabled:opacity-55',
        VARIANT_CLASSES[variant],
        error && 'ring-1 ring-red-400/70',
        className,
      )}
    >
      {pending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : icon}
      <span>{pending && pendingLabel ? pendingLabel : children}</span>
    </button>
  );
}
