import type { Show } from '../../types';
import type { SeriesCardEpisode } from './seriesCardPresentation.ts';
import { historyEpisodeKey, historyLastWatchedAt, historyRecordsWithoutTarget, materializeHistoryRecords } from '../history/historyRecords.ts';

export function movieRuntime(show: Show, details?: unknown): number | null {
  const local = show as Show & { runtime?: unknown };
  const cached = details && typeof details === 'object' ? details as { runtime?: unknown } : null;
  for (const candidate of [local.runtime, cached?.runtime]) {
    const runtime = Number(candidate);
    if (Number.isFinite(runtime) && runtime > 0 && runtime < 10_080) return Math.round(runtime);
  }
  return null;
}

export function selectedMovieStart(now: number, time: string | null): number {
  if (!time || !/^\d{2}:\d{2}$/.test(time)) return now;
  const [hours, minutes] = time.split(':').map(Number);
  if (hours > 23 || minutes > 59) return now;
  const date = new Date(now);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes);
  if (hours * 60 + minutes < date.getHours() * 60 + date.getMinutes()) start.setDate(start.getDate() + 1);
  return start.getTime();
}

export function movieEndTime(start: number, runtime: number | null) {
  if (!runtime || !Number.isFinite(runtime) || runtime <= 0) return null;
  const end = new Date(start + runtime * 60_000);
  const begin = new Date(start);
  const midnight = new Date(begin.getFullYear(), begin.getMonth(), begin.getDate() + 1).getTime();
  return { timestamp: end.getTime(), label: `fin ${end.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`, afterMidnight: end.getTime() >= midnight };
}

export function mergeWatchGroups(...groups: readonly Show[][]): Show[] {
  const seen = new Set<string>();
  return groups.flat().filter(show => {
    const identity = `${show.userId}:${show.mediaType}:${Number(show.tmdbId) > 0 ? show.tmdbId : show.id}`;
    if (seen.has(identity)) return false;
    seen.add(identity); return true;
  });
}

export function seriesMoreLabel(remaining: number): string {
  return remaining === 1 ? 'Afficher la dernière' : remaining === 2 ? 'Afficher les 2' : 'Afficher 3 de plus';
}

/** La cible vient de la carte effectivement marquée, jamais d'un numéro décrémenté. */
export function removeWatchRecord(show: Show, episode: SeriesCardEpisode | null, now = Date.now()): { updates: Partial<Show>; rollback: Partial<Show> } | null {
  const key = show.mediaType === 'movie' ? 'movie' : episode ? `${episode.season_number}x${episode.episode_number}` : null;
  if (!key || !(show.seenEpisodes || []).some(value => (historyEpisodeKey(value) || value) === key)) return null;
  const seenEpisodes = (show.seenEpisodes || []).filter(value => (historyEpisodeKey(value) || value) !== key);
  const episodeRecords = historyRecordsWithoutTarget(materializeHistoryRecords(show), key);
  const rollback: Partial<Show> = { seenEpisodes: show.seenEpisodes, episodeRecords: show.episodeRecords || {},
    status: show.status, isArchived: show.isArchived, lastWatchedAt: show.lastWatchedAt || null,
    nextEpisodeToWatch: show.nextEpisodeToWatch || null, updatedAt: now, isSynced: false };
  return { rollback, updates: { seenEpisodes, episodeRecords,
    status: show.mediaType === 'movie' ? 'plan_to_watch' : show.status === 'completed' ? 'watching' : show.status,
    isArchived: false, lastWatchedAt: historyLastWatchedAt(episodeRecords, seenEpisodes),
    ...(episode ? { nextEpisodeToWatch: { ...episode, ...show.seasonProgress?.[String(episode.season_number)] } } : {}),
    updatedAt: now, isSynced: false,
  } };
}
