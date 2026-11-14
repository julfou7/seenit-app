import { useEffect } from 'react';
import { PartyPopper, Trophy, X } from 'lucide-react';
import { celebrationCopy, useCelebrationStore } from '../features/shows/completionCelebration';

const AUTO_DISMISS_MS = 4_500;

/**
 * #436 — Popup courte et non bloquante de fin de saison / final de série. Elle se ferme seule,
 * au toucher ou avec Échap ; l'animation est désactivée par `prefers-reduced-motion` (motion-safe).
 */
export function CompletionCelebration() {
  const current = useCelebrationStore(state => state.current);
  const dismiss = useCelebrationStore(state => state.dismiss);

  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(dismiss, AUTO_DISMISS_MS);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(timer); window.removeEventListener('keydown', onKey); };
  }, [current, dismiss]);

  if (!current) return null;
  const { heading, body } = celebrationCopy(current);
  const series = current.celebration.kind === 'series';
  const Icon = series ? Trophy : PartyPopper;
  return (
    // Revue Codex #1014 : au-dessus de la fiche Série (portail z-[150]) qui déclenche la célébration, comme les toasts.
    <div data-celebration-layer="" className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+16px)] z-[99998] flex justify-center px-4">
      <div key={current.id} role="status" aria-live="polite" data-completion-celebration={current.celebration.kind}
        className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl border border-amber-400/30 bg-zinc-950/95 px-4 py-3 shadow-2xl motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-300">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${series ? 'bg-amber-400 text-zinc-950' : 'bg-amber-400/15 text-amber-300'}`}>
          <Icon size={22} className="motion-safe:animate-bounce" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-black text-white">{heading}</p>
          <p className="text-[12px] leading-snug text-zinc-300">{body}</p>
        </div>
        <button type="button" onClick={dismiss} aria-label="Fermer la célébration" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-400 active:scale-95">
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
