/**
 * La synchro Plex tourne dans la WebView, sur le même fil que l'interface. Sans pause, ses boucles
 * (historique, watchlist, états de bibliothèque) bloquaient l'affichage pendant des centaines de ms au
 * démarrage. Chaque boucle cède le fil dès que sa tranche dépasse le budget d'une frame à 120 Hz
 * (8,3 ms), en laissant le temps au navigateur de peindre.
 */
export const PLEX_FRAME_BUDGET_MS = 6;

type YieldingScheduler = { yield?: () => Promise<void> };

let sliceStartedAt: number | null = null;

export async function yieldToFrame(now: () => number = () => performance.now()): Promise<boolean> {
  const startedAt = now();
  if (sliceStartedAt === null) sliceStartedAt = startedAt;
  if (startedAt - sliceStartedAt < PLEX_FRAME_BUDGET_MS) return false;
  const scheduler = (globalThis as { scheduler?: YieldingScheduler }).scheduler;
  if (typeof scheduler?.yield === 'function') await scheduler.yield();
  else await new Promise<void>(resolve => setTimeout(resolve, 0));
  sliceStartedAt = now();
  return true;
}

/** Réservé aux tests : repart d'une tranche neuve. */
export function resetFrameBudget(): void {
  sliceStartedAt = null;
}
