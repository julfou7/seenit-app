import React, { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';
import './seenItCheckButton.css';

export interface SeenItCheckButtonProps {
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>;
  isWatched?: boolean;
  pending?: boolean;
  disabled?: boolean;
  error?: boolean;
  size?: number;
  glyph?: 'signature' | 'screen';
  className?: string;
  title?: string;
}

/**
 * SeenIt Signature Cinema TV Action Button
 * Replaces generic circle checkboxes with the iconic SeenIt TV & validation check glyph.
 */
export function SeenItCheckButton({
  onClick,
  isWatched = false,
  pending = false,
  disabled = false,
  error = false,
  size: _size = 28,
  glyph: _glyph = 'signature',
  className = '',
  title
}: SeenItCheckButtonProps) {
  const [isTapped, setIsTapped] = useState(false);
  const [internalPending, setInternalPending] = useState(false);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const effectivePending = pending || internalPending;
  const accessibleTitle = title ?? (isWatched ? 'Marquer comme non vu' : 'Marquer comme vu');

  useEffect(() => () => {
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
  }, []);

  const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (disabled || effectivePending) return;

    setIsTapped(true);
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    tapTimerRef.current = setTimeout(() => {
      setIsTapped(false);
      tapTimerRef.current = null;
    }, 180);

    setInternalPending(true);
    try {
      await onClick(e);
    } finally {
      setInternalPending(false);
    }
  };

  const active = isWatched;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || effectivePending}
      title={accessibleTitle}
      aria-label={accessibleTitle}
      aria-pressed={isWatched}
      aria-busy={effectivePending || undefined}
      data-error={error ? 'true' : undefined}
      className={cn(
        "seenit-check group relative min-h-11 min-w-11 flex items-center justify-center rounded-xl p-1.5 transition-all duration-200 cursor-pointer select-none",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black",
        "disabled:cursor-not-allowed disabled:opacity-55",
        error && "ring-1 ring-red-400/70",
        "hover:scale-105 active:scale-90",
        isTapped && "scale-90",
        className
      )}
      style={{ touchAction: 'manipulation' }}
    >
      <div className="seenit-check__circle" aria-hidden="true" />
      <svg className="seenit-screen-glyph" width="26" height="19" viewBox="0 0 100 74" fill="none" stroke="#F2C36B" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="6" y="4" width="88" height="56" rx="16" fill={active ? '#E5A93D' : 'none'} /><path d="M36 70H64" /><g><path d="M33 32 45 44 67 21" stroke={active ? '#0B0B0F' : '#FFFFFF'} strokeWidth="8.5" /></g></svg>
    </button>
  );
}
