import { useEffect, useState } from 'react';
import { tmdb } from '../../features/shows/tmdb';

/**
 * #851 — Une fiche restée ouverte au-delà du TTL des détails (#755) se relit d'elle-même. Le minuteur vise
 * l'échéance du détail en mémoire ; le retour au premier plan compare l'heure murale, car un appareil en veille
 * gèle les minuteurs. Le compteur renvoyé, placé dans les dépendances de l'effet de chargement de la fiche,
 * relance ce chargement réel et propage le détail révalidé à la vue.
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
    const revalidateIfStale = () => {
      if (document.visibilityState === 'visible' && tmdb.isMediaDetailsStale(id, mediaType)) setRevalidation(count => count + 1);
    };
    const revalidateAt = tmdb.getMediaDetailsRevalidateAt(id, mediaType);
    const timer = revalidateAt === null ? undefined : window.setTimeout(revalidateIfStale, Math.max(1000, revalidateAt - Date.now() + 50));
    document.addEventListener('visibilitychange', revalidateIfStale);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', revalidateIfStale);
    };
  }, [tmdbId, mediaKey, mediaType, details]);
  return revalidation;
}
