import type { Show } from '../../types';
import type { SeriesCardEpisode, SeriesSeasonProgress } from './seriesCardPresentation';
import { resolveHistoryTimestamp } from '../history/historyPresentation.ts';
export type SeriesBadgeTone = 'today' | 'yesterday' | 'new' | 'remaining' | 'season' | 'final' | 'pause' | 'never';
export interface SeriesBadge { label: string; tone: SeriesBadgeTone; icon?: 'pause' | 'bookmark' }
export function pauseDuration(days: number): string {
  if (days < 60) return `${Math.max(1, Math.round(days / 7))} SEM.`;
  if (days < 365) return `${Math.max(2, Math.round(days / 30.44))} MOIS`;
  const years = Math.floor(days / 365), half = days % 365 >= 182.5;
  return `${years} AN${years > 1 ? 'S' : ''}${half ? ' ½' : ''}`;
}
export function seriesPause(show: Pick<Show, 'seenEpisodes' | 'episodeRecords' | 'lastWatchedAt' | 'createdAt'>, now = Date.now()) {
  const started = (show.seenEpisodes || []).length > 0;
  const times = Object.entries(show.episodeRecords || {}).filter(([key]) => show.seenEpisodes?.includes(key)).map(([, record]) => resolveHistoryTimestamp(record?.watchedAt)?.watchedAt || 0);
  const at = started ? Math.max(0, ...times) || resolveHistoryTimestamp(show.lastWatchedAt)?.watchedAt : resolveHistoryTimestamp(show.createdAt)?.watchedAt;
  const days = at ? Math.floor((now - at) / 86_400_000) : 0;
  return { started, days, duration: pauseDuration(days), description: started ? `En pause depuis ${pauseDuration(days).toLowerCase()}` : `Ajoutée il y a ${pauseDuration(days).toLowerCase()} · jamais commencée` };
}
export function seriesBadge(show: Show, episode: SeriesCardEpisode | null, progress: SeriesSeasonProgress, stale: boolean, today: string, now = Date.now()): SeriesBadge | null {
  if (stale) { const pause = seriesPause(show, now); return pause.days >= 60 ? { label: pause.duration, tone: pause.started ? 'pause' : 'never', icon: pause.started ? 'pause' : 'bookmark' } : null; }
  if (!episode || show.seenEpisodes?.includes(`${episode.season_number}x${episode.episode_number}`)) return null;
  const age = episode.air_date ? Math.round((Date.parse(today + 'T12:00:00') - Date.parse(episode.air_date + 'T12:00:00')) / 86_400_000) : NaN;
  if (age === 0) return { label: 'Ce soir', tone: 'today' };
  if (age === 1) return { label: 'Sorti hier', tone: 'yesterday' };
  const finale = episode.episode_type === 'finale' || !progress.totalUnknown && episode.episode_number === progress.knownEpisodes;
  const lastSeason = Math.max(episode.last_season_number || 0, ...Object.values(show.seasonProgress || {}).map(season => season.last_season_number || season.season_number), ...(show.seasonsCache || []).map((season: { season_number: number }) => season.season_number));
  const seriesFinale = (show.seriesEnded || show.tmdbStatus === 'Ended') && lastSeason === episode.season_number;
  if (finale) return { label: seriesFinale ? 'Final' : 'Fin saison', tone: seriesFinale ? 'final' : 'season' };
  if (age >= 0 && !progress.totalUnknown && [2, 3].includes(progress.availableUnseen)) return { label: `Plus que ${progress.availableUnseen}`, tone: 'remaining' };
  return age >= 2 && age <= 5 ? { label: 'Nouveau', tone: 'new' } : null;
}
