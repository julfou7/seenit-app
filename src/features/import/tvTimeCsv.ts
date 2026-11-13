import { VIEWING_SOURCE_TVTIME } from '../history/viewingSource.ts';

/**
 * Colonnes de date connues des exports TV Time, visionnage d'abord (`watch_date`, horodatage Unix de l'export réel :
 * Bodyguard S1E6 `1543778079` alors que `created_at` vaut le marquage), puis marquage (revue Codex #978).
 */
const TV_TIME_DATE_COLUMNS = ['watch_date', 'Watch Date', 'watched_at', 'Watched At', 'seen_at', 'Seen At', 'created_at', 'Created At', 'date', 'Date'];

/** Horodatage numérique en secondes, millisecondes ou microsecondes (export v2 : `1.689410863725422e+15`). */
function tvTimeEpochToMs(value: number): number {
  if (value >= 100_000_000_000_000) return Math.round(value / 1000);
  return value < 10_000_000_000 ? value * 1000 : value;
}

/**
 * Retour v1.4.306 : date du visionnage d'une ligne d'export TV Time, ou null. L'import utilisait l'instant de l'import
 * pour tout : l'historique montrait la date de l'import au lieu de celle du visionnage.
 */
export function readTvTimeRowDate(row: Record<string, unknown> | null | undefined): number | null {
  if (!row) return null;
  for (const column of TV_TIME_DATE_COLUMNS) {
    const value = row[column];
    if (value === undefined || value === null || String(value).trim() === '') continue;
    const text = String(value).trim();
    const numeric = Number(text);
    const ms = Number.isFinite(numeric) && numeric > 0 ? tvTimeEpochToMs(numeric) : Date.parse(text);
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  return null;
}

/** Garde la lecture la plus récente d'une même clé (film ou épisode). */
export function keepLatestTvTimeDate(dates: Record<string, number>, key: string, viewedAt: number | null): void {
  if (viewedAt === null) return;
  if (!dates[key] || viewedAt > dates[key]) dates[key] = viewedAt;
}

type TvTimeRecord = { watchedAt: number; source: typeof VIEWING_SOURCE_TVTIME };

/**
 * Retour v1.4.306 : un film TV Time devient un Vu complet — clé `movie` (pas `1x1`) et enregistrement daté. Un film déjà
 * présent recevait seulement `status: 'completed'` : la synchro Plex en faisait ensuite un Vu sans enregistrement ni date
 * (Le Robot sauvage, Ted, Fury…). Un enregistrement existant n'est jamais écrasé.
 */
export function buildTvTimeMovieProgress(
  existing: { seenEpisodes?: string[]; episodeRecords?: Record<string, unknown> } | null | undefined,
  viewedAt: number | null,
  now = Date.now()
): { status: 'completed'; seenEpisodes: string[]; episodeRecords: Record<string, unknown> } {
  const records: Record<string, unknown> = { ...(existing?.episodeRecords || {}) };
  if (!records.movie) records.movie = { watchedAt: viewedAt ?? now, source: VIEWING_SOURCE_TVTIME } satisfies TvTimeRecord;
  return { status: 'completed', seenEpisodes: [...new Set([...(existing?.seenEpisodes || []), 'movie'])], episodeRecords: records };
}

/** Enregistrement TV Time d'un épisode, daté par l'export quand il le permet. */
export function buildTvTimeEpisodeRecord(dates: Record<string, number> | undefined, key: string, now = Date.now()): TvTimeRecord {
  return { watchedAt: dates?.[key] ?? now, source: VIEWING_SOURCE_TVTIME };
}
