import type { Show } from '../../types.ts';
import { historyEpisodeEntries } from '../history/historyRecords.ts';
import { seriesPause } from '../watchlist/seriesBadges.ts';
import { resolveWatchCardResume } from '../watchlist/watchCardResume.ts';
import type { ProfileViewing } from './profileYearStats.ts';

/**
 * Devenir d'une série commencée (SEENIT-PROFILE-002). « En pause » reprend exactement la règle de la section
 * « Pas vu depuis un moment » de l'accueil : `seriesPause` (dernier épisode vu) d'au moins 60 jours, avec un
 * épisode encore regardable. Une seule fonction alimente Moi, Mes chiffres, Mon année et l'écran dédié.
 */
export type SeriesFate = 'finished' | 'active' | 'paused' | 'dropped';
export type SeriesDropBucket = 'beforeE3' | 'S1' | 'S2' | 'S3plus';

export const SERIES_PAUSE_DAYS = 60;
const EPISODE_MINUTES = 45;
const NEARLY_DONE_EPISODES = 3;
const SURVIVAL_MIN_SERIES = 10;

export interface SeriesFateEntry {
  show: Show;
  fate: SeriesFate;
  seenCount: number;
  lastSeen: { season: number; episode: number } | null;
  lastSeenAt: number | null;
  pausedDays: number;
  minutesSpent: number;
  nextCode: string | null;
  remainingEpisodes: number | null;
  remainingMinutes: number | null;
  progress: number;
  dropBucket: SeriesDropBucket | null;
}

const two = (value: number) => String(value).padStart(2, '0');
export const formatEpisodeCode = (season: number, episode: number) => `S${two(season)} | E${two(episode)}`;

const positive = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

function dropBucketOf(last: { season: number; episode: number } | null): SeriesDropBucket | null {
  if (!last) return null;
  if (last.season <= 1) return last.episode < 3 ? 'beforeE3' : 'S1';
  return last.season === 2 ? 'S2' : 'S3plus';
}

export function buildSeriesFate(shows: readonly Show[], now: number, today: string): SeriesFateEntry[] {
  const entries: SeriesFateEntry[] = [];
  for (const show of shows) {
    if (!show?.id || show.mediaType !== 'tv') continue;
    const watched = historyEpisodeEntries(show);
    const dropped = show.status === 'dropped';
    if (watched.length === 0 || (show.isArchived && !dropped)) continue;
    let last: { season: number; episode: number } | null = null;
    let minutesSpent = 0;
    for (const { key, record } of watched) {
      const [season, episode] = key.split('x').map(Number);
      if (!last || season > last.season || (season === last.season && episode > last.episode)) last = { season, episode };
      minutesSpent += positive(record?.runtime) ?? EPISODE_MINUTES;
    }
    const pause = seriesPause(show, now);
    const resume = resolveWatchCardResume(show, today);
    const total = positive(show.totalAiredEpisodes);
    const remaining = total ? Math.max(0, total - watched.length) : null;
    const finished = !dropped && (show.status === 'completed' || (resume.upToDate && show.seriesEnded === true));
    const fate: SeriesFate = dropped ? 'dropped' : finished ? 'finished'
      : resume.episode && !resume.upToDate && pause.days >= SERIES_PAUSE_DAYS ? 'paused' : 'active';
    entries.push({
      show,
      fate,
      seenCount: watched.length,
      lastSeen: last,
      lastSeenAt: pause.started ? now - pause.days * 86_400_000 : null,
      pausedDays: pause.days,
      minutesSpent,
      nextCode: resume.episode ? formatEpisodeCode(resume.episode.season_number, resume.episode.episode_number) : null,
      remainingEpisodes: remaining,
      remainingMinutes: remaining === null ? null : remaining * EPISODE_MINUTES,
      progress: total ? Math.min(1, watched.length / total) : 0,
      dropBucket: fate === 'paused' || fate === 'dropped' ? dropBucketOf(last) : null,
    });
  }
  return entries;
}

export const SERIES_DROP_BUCKET_LABELS: Record<SeriesDropBucket, string> = {
  beforeE3: 'Avant l’épisode 3',
  S1: 'En saison 1',
  S2: 'En saison 2',
  S3plus: 'Saison 3 et après',
};

export interface SeriesFateSummary {
  left: SeriesFateEntry[];
  paused: SeriesFateEntry[];
  dropped: SeriesFateEntry[];
  nearlyDone: SeriesFateEntry[];
  buckets: { key: SeriesDropBucket; label: string; count: number }[];
  minutesSpent: number;
  dropPoint: number | null;
  survival: number | null;
  inProgress: number;
}

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

export function summarizeSeriesFate(entries: readonly SeriesFateEntry[]): SeriesFateSummary {
  const byPause = (a: SeriesFateEntry, b: SeriesFateEntry) => b.pausedDays - a.pausedDays || a.show.title.localeCompare(b.show.title);
  const paused = entries.filter(entry => entry.fate === 'paused').sort(byPause);
  const dropped = entries.filter(entry => entry.fate === 'dropped').sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0) || a.show.title.localeCompare(b.show.title));
  const left = [...paused, ...dropped];
  const nearlyDone = entries
    .filter(entry => (entry.fate === 'paused' || entry.fate === 'active') && entry.nextCode && entry.remainingEpisodes !== null && entry.remainingEpisodes > 0 && entry.remainingEpisodes <= NEARLY_DONE_EPISODES)
    .sort((a, b) => a.remainingMinutes! - b.remainingMinutes! || a.show.title.localeCompare(b.show.title));
  const buckets = (Object.keys(SERIES_DROP_BUCKET_LABELS) as SeriesDropBucket[])
    .map(key => ({ key, label: SERIES_DROP_BUCKET_LABELS[key], count: left.filter(entry => entry.dropBucket === key).length }));
  const pastFirstSeason = entries.filter(entry => (entry.lastSeen?.season || 0) >= 2);
  const survival = pastFirstSeason.length >= SURVIVAL_MIN_SERIES
    ? Math.round(pastFirstSeason.filter(entry => entry.fate === 'active' || entry.fate === 'finished').length / pastFirstSeason.length * 4)
    : null;
  return {
    left,
    paused,
    dropped,
    nearlyDone,
    buckets,
    minutesSpent: left.reduce((sum, entry) => sum + entry.minutesSpent, 0),
    dropPoint: median(left.map(entry => entry.seenCount)),
    survival,
    inProgress: entries.filter(entry => entry.fate === 'active' || entry.fate === 'paused').length,
  };
}

/** « Tes séries en AAAA » : chaque série regardée dans l'année, comptée une fois selon son devenir. */
export function countSeriesFatesInYear(entries: readonly SeriesFateEntry[], viewings: readonly ProfileViewing[], year: number) {
  const watched = new Set(viewings.filter(viewing => viewing.mediaType === 'tv' && new Date(viewing.watchedAt).getFullYear() === year).map(viewing => viewing.showId));
  const counts = { finished: 0, active: 0, paused: 0, dropped: 0, total: 0 };
  for (const entry of entries) {
    if (!watched.has(entry.show.id)) continue;
    counts[entry.fate]++;
    counts.total++;
  }
  return counts;
}
