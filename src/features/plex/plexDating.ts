import { VIEWING_SOURCE_PLEX, viewingSourceOf } from '../history/viewingSource.ts';

/**
 * SEENIT-PLEX-005 (#954) : un film ou épisode déjà vu dans SeenIt mais sans date de visionnage prouvée
 * (import TV Time, film importé sans enregistrement `movie`, heure inconnue) reçoit la date réelle de sa lecture
 * Plex. Un Vu marqué dans SeenIt ou déjà daté par Plex n'est jamais réécrit, et cette date ne donne pas à Plex la
 * propriété de la progression (`plexImported` n'est pas posé).
 */
export function datePlexWatchedRecord(record: unknown, viewedAt: number | null): Record<string, unknown> | null {
  if (viewedAt === null || !Number.isFinite(viewedAt) || viewedAt <= 0) return null;
  const current = record && typeof record === 'object' ? record as Record<string, unknown> : null;
  const source = viewingSourceOf(current);
  if (source === 'seenit' || source === 'plex') return null;
  const watchedAt = Number(current?.watchedAt);
  const dated = Number.isFinite(watchedAt) && watchedAt > 0 && current?.watchedTimeKnown !== false;
  if (dated && source !== 'tvtime') return null;
  return { ...(current || {}), watchedAt: viewedAt, watchedTimeKnown: true, source: VIEWING_SOURCE_PLEX };
}

/** Le même titre avec l'enregistrement `key` daté par Plex, ou null s'il n'y a rien à dater. */
export function withPlexDate<T extends { episodeRecords?: Record<string, unknown>; lastWatchedAt?: number; updatedAt?: number }>(show: T, key: string, viewedAt: number | null): T | null {
  const dated = datePlexWatchedRecord(show.episodeRecords?.[key], viewedAt);
  if (!dated || viewedAt === null) return null;
  return { ...show, episodeRecords: { ...(show.episodeRecords || {}), [key]: dated }, lastWatchedAt: Math.max(Number(show.lastWatchedAt) || 0, viewedAt), updatedAt: Date.now() };
}

/** #954 : visionnages lus dans l'historique du compte Plex et non vus explicites, pour le panneau de synchro. */
export function readPlexAccountProgress(stats: unknown): { history: number; unwatched: number } | undefined {
  const value = stats && typeof stats === 'object' ? stats as { plexAccountHistoryItems?: unknown; plexAccountCurrentUnwatched?: unknown } : null;
  const history = Number(value?.plexAccountHistoryItems) || 0;
  return history > 0 ? { history, unwatched: Number(value?.plexAccountCurrentUnwatched) || 0 } : undefined;
}
