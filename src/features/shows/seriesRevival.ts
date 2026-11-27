import type { Show } from '../../types';
import { seriesPause } from '../watchlist/seriesBadges.ts';

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

/** Retour du 25/11 : trois ans sans activité (spectateur ou série) suffisent pour ranger une série automatiquement. */
export const INACTIVITY_ARCHIVE_DAYS = 3 * 365;
const DAY_MS = 86_400_000;

/** Retour du 25/11 : provenance de l'archive (`inactivity`) et date de l'archivage pour inactivité, stockées dans la fiche. */
export interface InactivityArchiveFields { archiveSource?: 'manual' | 'inactivity'; inactivityArchivedAt?: number }
type ArchiveShow = InactivityArchiveFields & Partial<Pick<Show, 'mediaType' | 'status' | 'isArchived' | 'seriesEnded' | 'tmdbStatus'
  | 'seenEpisodes' | 'episodeRecords' | 'lastWatchedAt' | 'createdAt' | 'nextEpisodeToWatch' | 'nextEpisodeToAir' | 'seasonProgress'>>;

const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);

/**
 * Cas « inactivité » : série commencée, un épisode déjà diffusé reste à voir, et aucun épisode vu depuis 3 ans.
 * Renvoie la date du dernier visionnage pour savoir si une archive déjà posée couvre cette même inactivité.
 */
export function seriesInactivity(show: ArchiveShow, now = Date.now()): { inactive: boolean; lastActivity: number | null } {
  if (show.mediaType !== 'tv' || show.status === 'dropped' || show.status === 'completed') return { inactive: false, lastActivity: null };
  // Les champs absents (ancienne fiche) sont tolérés par seriesPause.
  const pause = seriesPause(show as Pick<Show, 'seenEpisodes' | 'episodeRecords' | 'lastWatchedAt' | 'createdAt'>, now);
  if (!pause.started) return { inactive: false, lastActivity: null };
  const lastActivity = now - pause.days * DAY_MS;
  const next = show.nextEpisodeToWatch as { air_date?: string | null } | null | undefined;
  return { inactive: hasAiredUnseenEpisode(next, dayOf(now)) && pause.days >= INACTIVITY_ARCHIVE_DAYS, lastActivity };
}

/**
 * Cas « série dormante » : à jour, rien d'annoncé, pas déclarée finie par TMDB, et dernier épisode diffusé il y a
 * plus de 3 ans (série renouvelée jamais produite). Archivée en silence ; un nouvel épisode la réactive (#333).
 */
export function isDormantSeries(show: ArchiveShow, now = Date.now()): boolean {
  if (show.mediaType !== 'tv' || show.status === 'dropped') return false;
  if (show.seriesEnded || show.tmdbStatus === 'Ended' || show.tmdbStatus === 'Canceled') return false;
  if (show.nextEpisodeToWatch || show.nextEpisodeToAir) return false;
  const dates = Object.values(show.seasonProgress || {}).map(season => season?.last_known_episode_air_date || '').filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  const last = dates.at(-1);
  return Boolean(last) && Date.parse(last + 'T12:00:00Z') <= now - INACTIVITY_ARCHIVE_DAYS * DAY_MS;
}

/** L'archive pour inactivité déjà posée couvre-t-elle l'inactivité en cours ? (sinon l'utilisateur l'a levée puis rien vu) */
const inactivityAlreadyHandled = (show: ArchiveShow, lastActivity: number | null) =>
  typeof show.inactivityArchivedAt === 'number' && lastActivity !== null && show.inactivityArchivedAt >= lastActivity;

/**
 * Archive après synchronisation : l'archive manuelle est une intention de l'utilisateur et n'est jamais levée.
 * Une série inactive depuis 3 ans reste archivée tant qu'aucun épisode n'est vu ; elle n'est archivée une première
 * fois que par la passe de masse (`archiveInactive`), seule à prévenir l'utilisateur, et jamais à nouveau s'il l'a
 * désarchivée sans rien regarder depuis. Sinon l'archive suit le calcul automatique ou la dormance de la série.
 */
export function reconcileArchive(show: ArchiveShow, computedAutoArchive: boolean, { now = Date.now(), archiveInactive = false } = {}): boolean {
  if (show.isArchived === true && show.archiveSource === 'manual') return true;
  const { inactive, lastActivity } = seriesInactivity(show, now);
  if (inactive && show.isArchived === true) return true;
  if (inactive && archiveInactive && !inactivityAlreadyHandled(show, lastActivity)) return true;
  return computedAutoArchive || isDormantSeries(show, now);
}

/** Nouvelle archive pour inactivité : à annoncer à l'utilisateur. */
export function isNewInactivityArchive(show: ArchiveShow, archived: boolean, now = Date.now()): boolean {
  if (!archived || show.isArchived) return false;
  const { inactive, lastActivity } = seriesInactivity(show, now);
  return inactive && !inactivityAlreadyHandled(show, lastActivity);
}

/** Série rangée par la passe d'inactivité et toujours archivée : elle peut être désarchivée sans perdre sa progression. */
export const isInactivityArchive = (show: InactivityArchiveFields & Partial<Pick<Show, 'mediaType' | 'isArchived'>> | null | undefined): boolean =>
  Boolean(show && show.mediaType === 'tv' && show.isArchived === true && show.archiveSource === 'inactivity');

/**
 * Retour du 27/11 : « Désarchiver » lève l'archive pour inactivité sans toucher à la progression, et garde (ou pose)
 * `inactivityArchivedAt` : la passe de masse voit alors cette inactivité comme déjà traitée et ne la réarchive pas.
 */
export function inactivityRestorePatch(show: InactivityArchiveFields, now = Date.now()) {
  return { isArchived: false, archiveSource: undefined, inactivityArchivedAt: typeof show.inactivityArchivedAt === 'number' ? show.inactivityArchivedAt : now, updatedAt: now };
}

/** Annuler « Désarchiver » remet exactement l'archive pour inactivité d'avant, sans nouvelle annonce. */
export function inactivityReArchivePatch(show: InactivityArchiveFields, now = Date.now()) {
  return { isArchived: true, archiveSource: 'inactivity' as const, inactivityArchivedAt: typeof show.inactivityArchivedAt === 'number' ? show.inactivityArchivedAt : now, updatedAt: now };
}
