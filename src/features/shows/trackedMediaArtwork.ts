import { doc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';
import { useShowsStore } from '../../store/showsStore';
import { appLogger } from '../../store/logStore';
import {
  getTrackedMediaArtworkConvergence,
  type MediaArtworkType,
} from './mediaArtwork';

const inFlightArtworkWrites = new Set<string>();

/**
 * Corrige les seuls chemins de visuels éditoriaux d'un média suivi après une
 * hydratation TMDB exacte. Aucun état utilisateur ni timestamp métier n'est touché.
 */
export function convergeTrackedMediaArtworkFromTmdb(
  mediaType: MediaArtworkType,
  tmdbId: string | number,
  details: any,
): boolean {
  const userId = auth.currentUser?.uid;
  if (!userId) return false;

  const convergence = getTrackedMediaArtworkConvergence(
    useShowsStore.getState().shows,
    mediaType,
    tmdbId,
    details,
  );
  if (!convergence) return false;

  useShowsStore.getState().updateShowOptimistic(convergence.showId, convergence.updates);

  const writeKey = `${userId}:${mediaType}:${Number(tmdbId)}:${convergence.showId}:${JSON.stringify(convergence.updates)}`;
  if (inFlightArtworkWrites.has(writeKey)) return true;
  inFlightArtworkWrites.add(writeKey);

  void updateDoc(doc(db, 'users', userId, 'shows', convergence.showId), convergence.updates)
    .catch((error: unknown) => {
      appLogger.warn('tmdb', 'Le visuel TMDB frais est affiché mais sa convergence Cloud a échoué.', {
        mediaType,
        tmdbId: Number(tmdbId),
        message: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      inFlightArtworkWrites.delete(writeKey);
    });

  return true;
}
