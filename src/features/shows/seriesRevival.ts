import type { Show } from '../../types';

/**
 * SEENIT-DATA-008 (#333) — Une série terminée, archivée ou `completed` qui reprend l'antenne redevient active.
 * Fonctions pures : la synchronisation les appelle, aucune ne lit ni n'écrit Firestore.
 */

/** Une série terminée/archivée est revérifiée auprès de TMDB au plus tous les 14 jours. */
export const REVIVAL_RECHECK_DAYS = 14;
/** Borne le coût TMDB d'un passage : les séries revérifiées le plus anciennement d'abord. */
export const REVIVAL_RECHECK_MAX_PER_RUN = 12;

type RevivalShow = Pick<Show, 'id' | 'mediaType' | 'status' | 'isArchived' | 'seriesEnded' | 'tmdbStatus' | 'lastSyncedAt'>;

/** Série que la synchronisation automatique écarte parce qu'elle paraît finie. */
export const looksFinished = (show: Pick<Show, 'status' | 'isArchived' | 'seriesEnded' | 'tmdbStatus'>): boolean =>
  Boolean(show.isArchived || show.seriesEnded || show.tmdbStatus === 'Ended' || show.tmdbStatus === 'Canceled' || show.status === 'completed');

/** Séries finies à revérifier ce passage : jamais synchronisées ou synchronisées il y a ≥ 14 jours. */
export function selectFinishedShowsToRecheck<T extends RevivalShow>(shows: readonly T[], now = Date.now()): T[] {
  const limit = REVIVAL_RECHECK_DAYS * 86_400_000;
  return shows
    .filter(show => show.mediaType === 'tv' && show.status !== 'dropped' && looksFinished(show) && now - (show.lastSyncedAt || 0) >= limit)
    .sort((a, b) => (a.lastSyncedAt || 0) - (b.lastSyncedAt || 0))
    .slice(0, REVIVAL_RECHECK_MAX_PER_RUN);
}

/**
 * Premier épisode non vu **déjà diffusé** : seule une date passée ou du jour le prouve. Un épisode annoncé
 * (date future) ou sans date ne réactive rien (#304 : jamais de disponibilité inventée).
 */
export const hasAiredUnseenEpisode = (next: { air_date?: string | null } | null | undefined, today: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(next?.air_date || '') && (next!.air_date as string) <= today;

/** `completed` n'a plus de sens dès qu'un épisode diffusé reste à voir : la série redevient `watching`. */
export function reconcileSeriesStatus(status: Show['status'], next: { air_date?: string | null } | null | undefined, today: string): Show['status'] {
  return status === 'completed' && hasAiredUnseenEpisode(next, today) ? 'watching' : status;
}

/**
 * Archive après synchronisation : l'archive manuelle est une intention de l'utilisateur et n'est jamais levée ;
 * sinon l'archive suit le calcul automatique frais (`computeAutoArchiveStatus` avec les données TMDB du jour).
 */
export const reconcileArchive = (show: Pick<Show, 'isArchived' | 'archiveSource'>, computedAutoArchive: boolean): boolean =>
  show.isArchived === true && show.archiveSource === 'manual' ? true : computedAutoArchive;
