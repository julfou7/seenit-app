import React, { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';
import { SeenItRing } from './SeenItLogo';
import './seenItCheckButton.css';

export interface SeenItCheckButtonProps {
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void | boolean | Promise<void | boolean>;
  celebrating?: boolean;
  isWatched?: boolean;
  pending?: boolean;
  disabled?: boolean;
  error?: boolean;
  size?: number;
  glyph?: 'signature' | 'screen';
  className?: string;
  title?: string;
  /**
   * #859 — Calque de célébration dessiné par le compositeur (fourni par l'écran, hors point d'entrée). S'il est
   * présent, l'animation part au toucher (annulée si l'action échoue ou renvoie `false`) et remplace celle du SVG.
   * L'écran ajoute la classe `seenit-check--compositor` (pas d'atténuation pendant l'attente).
   */
  celebrationLayer?: React.ReactNode;
}

/**
 * SeenIt Signature Cinema TV Action Button
 * Replaces generic circle checkboxes with the iconic SeenIt TV & validation check glyph.
 */
export function SeenItCheckButton({
  onClick,
  celebrating,
  isWatched = false,
  pending = false,
  disabled = false,
  error = false,
  size: _size = 28,
  glyph: _glyph = 'signature',
  className = '',
  title,
  celebrationLayer,
}: SeenItCheckButtonProps) {
  const [isTapped, setIsTapped] = useState(false);
  const [internalPending, setInternalPending] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const effectivePending = pending || internalPending;
  const accessibleTitle = title ?? (isWatched ? 'Marquer comme non vu' : 'Marquer comme vu');

  useEffect(() => () => {
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    if (successTimer.current) clearTimeout(successTimer.current);
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

    // Mode compositeur : retour immédiat au toucher (#859), retiré si l'action échoue ou renvoie false.
    const canCelebrate = !isWatched && celebrating === undefined;
    const celebrateFor = (on: boolean) => {
      if (successTimer.current) clearTimeout(successTimer.current);
      setCelebrate(on);
      if (on) successTimer.current = setTimeout(() => setCelebrate(false), 1100);
    };
    const optimistic = Boolean(celebrationLayer) && canCelebrate;
    if (optimistic) celebrateFor(true);

    setInternalPending(true);
    let result: void | boolean = false;
    try {
      result = await onClick(e);
    } finally {
      setInternalPending(false);
      if (result === false ? optimistic : !optimistic && canCelebrate) celebrateFor(!optimistic);
    }
  };

  const showCelebration = celebrating ?? celebrate;
  const active = !error && (isWatched || showCelebration);

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
      data-celebrate={showCelebration && !error || undefined}
      className={cn(
        "seenit-check group relative min-h-11 min-w-11 flex items-center justify-center rounded-xl p-1.5 transition-transform duration-200 cursor-pointer select-none",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black",
        "disabled:cursor-not-allowed disabled:opacity-55",
        error && "ring-1 ring-red-400/70",
        "hover:scale-105 active:scale-90",
        isTapped && "scale-90",
        className
      )}
      style={{ touchAction: 'manipulation' }}
    >
      <SeenItRing size={42} active={active} className="seenit-ring-glyph" />
      {showCelebration && !error && celebrationLayer}
    </button>
  );
}
