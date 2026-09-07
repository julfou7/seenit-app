import { doc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';
import { useShowsStore } from '../../store/showsStore';
import { appLogger } from '../../store/logStore';
import {
  getTrackedMediaTitleConvergence,
  type MediaTitleType,
} from './mediaTitle';

const inFlightTitleWrites = new Set<string>();

/**
 * Fait converger le seul champ éditorial title après hydratation d'une fiche TMDB
 * demandée en fr-FR. L'identité est exclusivement mediaType + TMDB ID et aucune
 * progression/intention utilisateur n'est réécrite.
 */
export function convergeTrackedMediaTitleFromTmdb(
  mediaType: MediaTitleType,
  tmdbId: string | number,
  details: any,
): boolean {
  const userId = auth.currentUser?.uid;
  if (!userId) return false;

  const convergence = getTrackedMediaTitleConvergence(
    useShowsStore.getState().shows,
    mediaType,
    tmdbId,
    details,
  );
  if (!convergence) return false;

  // Le rendu et le cache UID sont corrigés immédiatement ; Firestore converge ensuite.
  useShowsStore.getState().updateShowOptimistic(convergence.showId, {
    title: convergence.title,
  });

  const writeKey = `${userId}:${mediaType}:${Number(tmdbId)}:${convergence.showId}:${convergence.title}`;
  if (inFlightTitleWrites.has(writeKey)) return true;
  inFlightTitleWrites.add(writeKey);

  void updateDoc(doc(db, 'users', userId, 'shows', convergence.showId), {
    title: convergence.title,
  }).catch((error: unknown) => {
    appLogger.warn('tmdb', 'Le titre TMDB localisé est affiché mais sa convergence Cloud a échoué.', {
      mediaType,
      tmdbId: Number(tmdbId),
      message: error instanceof Error ? error.message : String(error),
    });
  }).finally(() => {
    inFlightTitleWrites.delete(writeKey);
  });

  return true;
}
