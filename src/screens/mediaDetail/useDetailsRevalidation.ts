import { useEffect, useState } from 'react';
import { MEDIA_DETAILS_REVALIDATION_RETRY_MS, tmdb } from '../../features/shows/tmdb';

export interface DetailsRevalidationPorts {
  revalidateAt: () => number | null;
  isStale: () => boolean;
  isVisible: () => boolean;
  now: () => number;
  setTimer: (callback: () => void, delayMs: number) => unknown;
  clearTimer: (timer: unknown) => void;
  onRevalidate: () => void;
}

/**
 * #851 — Planification de la relecture d'une fiche ouverte. Le minuteur vise l'échéance du détail en mémoire ;
 * après une relecture lancée, il se réarme au délai de nouvelle tentative : une relecture en échec repousse
 * l'échéance de ce délai sans changer le détail affiché, et doit donc être retentée tant que la fiche reste
 * ouverte. Une relecture réussie change le détail, ce qui recrée la planification sur la nouvelle échéance.
 */
export function scheduleDetailsRevalidation(ports: DetailsRevalidationPorts): { check: () => void; dispose: () => void } {
  let timer: unknown;
  let disposed = false;
  const arm = (delayMs: number) => {
    if (!disposed) timer = ports.setTimer(run, Math.max(1000, delayMs));
  };
  const armOnDeadline = () => {
    const revalidateAt = ports.revalidateAt();
    if (revalidateAt !== null) arm(revalidateAt - ports.now() + 50);
  };
  // Arrière-plan : aucun minuteur, le retour au premier plan relance cette vérification.
  function run() {
    if (timer !== undefined) ports.clearTimer(timer);
    timer = undefined;
    if (disposed || !ports.isVisible()) return;
    if (!ports.isStale()) { armOnDeadline(); return; }
    ports.onRevalidate();
    arm(MEDIA_DETAILS_REVALIDATION_RETRY_MS + 50);
  }
  armOnDeadline();
  return {
    check: run,
    dispose: () => { disposed = true; if (timer !== undefined) ports.clearTimer(timer); },
  };
}

/**
 * Une fiche restée ouverte au-delà du TTL des détails (#755) se relit d'elle-même : à l'échéance, puis au délai
 * de nouvelle tentative tant que la relecture échoue, et au retour au premier plan (heure murale, car un appareil
 * en veille gèle les minuteurs). Le compteur renvoyé, placé dans les dépendances de l'effet de chargement de la
 * fiche, relance ce chargement réel et propage le détail révalidé à la vue.
 */
export function useDetailsRevalidation(
  tmdbId: number | string | null | undefined,
  mediaKey: string | null,
  mediaType: 'tv' | 'movie',
  details: unknown,
): number {
  const [revalidation, setRevalidation] = useState(0);
  useEffect(() => {
    if (!tmdbId || !mediaKey) return;
    const id = Number(tmdbId);
    const schedule = scheduleDetailsRevalidation({
      revalidateAt: () => tmdb.getMediaDetailsRevalidateAt(id, mediaType),
      isStale: () => tmdb.isMediaDetailsStale(id, mediaType),
      isVisible: () => document.visibilityState === 'visible',
      now: () => Date.now(),
      setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimer: timer => window.clearTimeout(timer as number),
      onRevalidate: () => setRevalidation(count => count + 1),
    });
    document.addEventListener('visibilitychange', schedule.check);
    return () => {
      schedule.dispose();
      document.removeEventListener('visibilitychange', schedule.check);
    };
  }, [tmdbId, mediaKey, mediaType, details]);
  return revalidation;
}
