import type { Show } from '../../types';

export interface SeriesCardEpisode {
  season_number: number;
  episode_number: number;
  episode_count?: number | null;
  aired_episodes_in_season?: number | null;
  name?: string | null;
  air_date?: string | null;
}

interface SeasonData {
  season_number: number;
  episode_count?: number;
  episodes?: Array<{ episode_number: number; air_date?: string | null }>;
}

export type SeasonSegmentState = 'seen' | 'current' | 'unseen' | 'future' | 'history' | 'unknown';
export interface SeasonSegment { state: SeasonSegmentState; count: number; episode?: number }
export interface SeriesSeasonProgress {
  label: string;
  description: string;
  continuous: boolean;
  segments: SeasonSegment[];
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10_000 ? value : null;
}

export function seriesEpisodeCode(episode: SeriesCardEpisode): string {
  return `S${String(episode.season_number).padStart(2, '0')} · E${String(episode.episode_number).padStart(2, '0')}`;
}

export function buildSeriesSeasonProgress(
  show: Pick<Show, 'seenEpisodes' | 'seasonsCache' | 'nextEpisodeToWatch' | 'nextEpisodeToAir'>,
  episode: SeriesCardEpisode,
  context: 'watch' | 'upcoming' | 'history',
  today: string,
): SeriesSeasonProgress {
  const season = episode.season_number;
  const pointers = [episode, show.nextEpisodeToWatch, show.nextEpisodeToAir]
    .filter((pointer): pointer is SeriesCardEpisode => pointer?.season_number === season);
  const cached = (show.seasonsCache as SeasonData[] | undefined)?.find(item => item.season_number === season);
  const total = pointers.map(pointer => count(pointer.episode_count)).find(value => value !== null && value > 0)
    ?? count(cached?.episode_count) ?? count(cached?.episodes?.length);
  const seen = new Set((show.seenEpisodes || []).flatMap(key => {
    const match = /^(?:s\s*)?(\d+)\s*(?:x|e)\s*(\d+)$/i.exec(key.trim());
    return match && Number(match[1]) === season && Number(match[2]) > 0 ? [Number(match[2])] : [];
  }));
  const watched = [...seen].filter(number => total === null || number <= total).length;
  const label = `S${season} · ${watched}/${total ?? '—'}`;
  if (!total) return { label, description: `Saison ${season}, ${watched} vus, total inconnu`, continuous: false, segments: [] };

  const aired = pointers.map(pointer => count(pointer.aired_episodes_in_season)).find(value => value !== null);
  const nextToAir = show.nextEpisodeToAir as SeriesCardEpisode | undefined;
  const episodeDates = new Map(cached?.episodes?.map(item => [item.episode_number, item.air_date]));
  const counts: Record<SeasonSegmentState, number> = { seen: 0, current: 0, unseen: 0, future: 0, history: 0, unknown: 0 };
  const segments: SeasonSegment[] = [];
  for (let number = 1; number <= total; number += 1) {
    const cachedAirDate = episodeDates.get(number);
    const isTarget = number === episode.episode_number;
    let state: SeasonSegmentState;
    if (context === 'history' && isTarget) state = 'history';
    else if (seen.has(number)) state = 'seen';
    else if (isTarget && context !== 'history') state = 'current';
    else if (cachedAirDate) state = cachedAirDate > today ? 'future' : 'unseen';
    else if (aired !== undefined && aired !== null) state = number <= aired ? 'unseen' : 'future';
    else if (nextToAir?.season_number === season && nextToAir.air_date && nextToAir.air_date > today) state = number >= nextToAir.episode_number ? 'future' : 'unseen';
    else if (episode.air_date && episode.air_date <= today && number < episode.episode_number) state = 'unseen';
    else state = 'unknown';
    counts[state] += 1;
    if (total <= 30) segments.push({ state, count: 1, episode: number });
  }
  return {
    label,
    description: `Saison ${season}, ${watched} épisodes vus sur ${total}, ${counts.future} à venir, ${counts.unknown} diffusions à confirmer`,
    continuous: total > 30,
    segments: total > 30
      ? (Object.entries(counts) as Array<[SeasonSegmentState, number]>).filter(([, amount]) => amount > 0).map(([state, amount]) => ({ state, count: amount }))
      : segments,
  };
}

export function upcomingCardTone(days: number): 'today' | 'soon' | 'later' {
  return days <= 0 ? 'today' : days <= 7 ? 'soon' : 'later';
}

export function imageUrl(path?: string | null, size = 'w342'): string | null {
  return path ? path.startsWith('http') ? path : `https://image.tmdb.org/t/p/${size}${path}` : null;
}

export function seriesCardPosterCandidates(show: Pick<Show, 'posterPath' | 'backdropPath'>): string[] {
  const candidates = [
    { path: show.posterPath, size: 'w185' },
    { path: show.backdropPath, size: 'w300' },
  ];
  const seen = new Set<string>();
  return candidates.flatMap(({ path, size }) => {
    if (!path || seen.has(path)) return [];
    seen.add(path);
    const url = imageUrl(path, size);
    return url ? [url] : [];
  });
}
