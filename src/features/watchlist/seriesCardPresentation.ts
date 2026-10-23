import type { Show } from '../../types';

export interface SeriesCardEpisode {
  season_number: number;
  episode_number: number;
  episode_count?: number | null;
  aired_episodes_in_season?: number | null;
  known_episodes_in_season?: number | null;
  season_total_unknown?: boolean | null;
  last_season_number?: number | null;
  last_known_episode_type?: string | null;
  last_known_episode_air_date?: string | null;
  episode_type?: string | null;
  name?: string | null;
  air_date?: string | null;
  still_path?: string | null;
}

interface SeasonData {
  season_number: number;
  episode_count?: number;
  episodes?: Array<{ episode_number: number; air_date?: string | null; episode_type?: string | null }>;
}

export type SeasonSegmentState = 'seen' | 'current' | 'unseen' | 'future' | 'history' | 'unknown';
export interface SeasonSegment { state: SeasonSegmentState; count: number; episode?: number }
export interface SeriesSeasonProgress {
  label: string;
  description: string;
  continuous: boolean;
  segments: SeasonSegment[];
  totalUnknown: boolean;
  unknownTail: boolean;
  knownEpisodes: number;
  availableUnseen: number;
  detail?: string;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10_000 ? value : null;
}

function normalizeEpisodeKey(key: string): { season: number; episode: number } | null {
  const match = /^(?:s\s*)?(\d+)\s*(?:x|e)\s*(\d+)$/i.exec(key.trim());
  if (!match) return null;
  const season = Number(match[1]);
  const episode = Number(match[2]);
  return Number.isInteger(season) && Number.isInteger(episode) && episode > 0 ? { season, episode } : null;
}

function timestamp(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0;
    return value > 0 && value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === 'object') {
    const candidate = value as { toMillis?: () => number; seconds?: number; _seconds?: number };
    if (typeof candidate.toMillis === 'function') {
      const millis = candidate.toMillis();
      return Number.isFinite(millis) ? millis : 0;
    }
    const seconds = candidate.seconds ?? candidate._seconds;
    return typeof seconds === 'number' && Number.isFinite(seconds) ? seconds * 1000 : 0;
  }
  return 0;
}

function calendarDayIndex(value: number): number {
  const date = new Date(value);
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

export function seriesCardStaleDetail(
  show: Pick<Show, 'seenEpisodes' | 'episodeRecords' | 'lastWatchedAt'>,
  now = Date.now(),
): string | undefined {
  const seen = new Set((show.seenEpisodes || []).flatMap(key => {
    const normalized = normalizeEpisodeKey(key);
    return normalized ? [`${normalized.season}x${normalized.episode}`] : [];
  }));
  if (seen.size === 0) return undefined;

  let latest = 0;
  for (const [key, record] of Object.entries(show.episodeRecords || {})) {
    const normalized = normalizeEpisodeKey(key);
    if (!normalized || !seen.has(`${normalized.season}x${normalized.episode}`)) continue;
    const watchedAt = timestamp(record?.watchedAt);
    if (watchedAt <= now) latest = Math.max(latest, watchedAt);
  }
  if (!latest) latest = timestamp(show.lastWatchedAt);
  if (!latest || latest > now) return undefined;

  const days = Math.max(0, calendarDayIndex(now) - calendarDayIndex(latest));
  if (days <= 60) return undefined;
  return `⏳ Il y a ${days} jour${days > 1 ? 's' : ''}`;
}

export function seriesEpisodeCode(episode: SeriesCardEpisode): string {
  return `S${String(episode.season_number).padStart(2, '0')} · E${String(episode.episode_number).padStart(2, '0')}`;
}

export function seriesCompletionLabel(show: Pick<Show, 'seriesEnded' | 'tmdbStatus'>): string {
  if (show.tmdbStatus === 'Canceled') return 'Série annulée';
  if (show.seriesEnded || show.tmdbStatus === 'Ended') return 'Série terminée';
  return 'Prochain épisode bientôt';
}

export function buildSeriesSeasonProgress(
  show: Pick<Show, 'seenEpisodes' | 'seasonsCache' | 'seasonProgress' | 'nextEpisodeToWatch' | 'nextEpisodeToAir' | 'seriesEnded' | 'tmdbStatus'>,
  episode: SeriesCardEpisode,
  context: 'watch' | 'upcoming' | 'history',
  today: string,
): SeriesSeasonProgress {
  const season = episode.season_number;
  const allPointers = [episode, show.seasonProgress?.[String(season)], show.nextEpisodeToWatch, show.nextEpisodeToAir]
    .filter((pointer): pointer is SeriesCardEpisode => Boolean(pointer && typeof pointer.season_number === 'number'));
  const pointers = allPointers.filter(pointer => pointer.season_number === season);
  const cachedSeasons = (show.seasonsCache as SeasonData[] | undefined) || [];
  const cached = cachedSeasons.find(item => item.season_number === season);

  const seenEntries = (show.seenEpisodes || []).flatMap(key => {
    const normalized = normalizeEpisodeKey(key);
    return normalized ? [normalized] : [];
  });
  const seen = new Set(seenEntries.filter(item => item.season === season).map(item => item.episode));

  const advertisedTotal = pointers.map(pointer => count(pointer.episode_count ?? (pointer.season_total_unknown === false ? pointer.known_episodes_in_season : null))).find(value => value !== null && value > 0)
    ?? (count(cached?.episode_count) || null)
    ?? null;
  const cachedKnown = (cached?.episodes || []).reduce((highest, item) => Math.max(highest, count(item.episode_number) || 0), 0);
  const pointerKnown = Math.max(0, ...pointers.map(pointer => count(pointer.known_episodes_in_season) || 0));
  const seenKnown = [...seen].reduce((highest, number) => Math.max(highest, count(number) || 0), 0);
  const sameSeasonNextToAir = show.nextEpisodeToAir as SeriesCardEpisode | undefined;
  const knownEpisodes = Math.max(
    1,
    count(episode.episode_number) || 0,
    cachedKnown,
    pointerKnown,
    seenKnown,
    sameSeasonNextToAir?.season_number === season ? count(sameSeasonNextToAir.episode_number) || 0 : 0,
    advertisedTotal || 0,
  );

  const statusEnded = show.seriesEnded === true || show.tmdbStatus === 'Ended' || show.tmdbStatus === 'Canceled';
  const lastSeasonNumber = Math.max(
    season,
    ...allPointers.map(pointer => count(pointer.last_season_number) || pointer.season_number || 0),
    ...cachedSeasons.map(item => item.season_number || 0),
    ...seenEntries.map(item => item.season),
  );
  const isLatestSeason = season === lastSeasonNumber;
  // L'épisode présenté est le premier candidat : une nouvelle preuve ne doit pas être
  // invalidée par l'ancien pointeur encore stocké sur le Show.
  const explicitTotalState = pointers.find(pointer => typeof pointer.season_total_unknown === 'boolean')?.season_total_unknown;
  const cachedLast = [...(cached?.episodes || [])]
    .filter(item => typeof item.episode_number === 'number')
    .sort((a, b) => b.episode_number - a.episode_number)[0];
  const lastPointer = pointers.find(pointer => pointer.episode_number === knownEpisodes);
  const lastKnownType = pointers.map(pointer => pointer.last_known_episode_type).find(Boolean)
    || cachedLast?.episode_type
    || lastPointer?.episode_type
    || null;
  const lastKnownAirDate = pointers.map(pointer => pointer.last_known_episode_air_date).find(Boolean)
    || cachedLast?.air_date
    || lastPointer?.air_date
    || null;
  const datedFinale = lastKnownType === 'finale' && Boolean(lastKnownAirDate);
  const unknownTail = advertisedTotal === null && !datedFinale && !statusEnded && isLatestSeason && (
    explicitTotalState === true || (explicitTotalState !== false && !datedFinale)
  );
  const totalUnknown = unknownTail || (advertisedTotal === null && !datedFinale);
  const renderTotal = Math.max(1, totalUnknown ? knownEpisodes : (advertisedTotal || knownEpisodes));
  const watched = [...seen].filter(number => number <= renderTotal).length;
  const label = `S${season} · ${watched}/${totalUnknown ? '?' : renderTotal}`;

  const aired = pointers.map(pointer => count(pointer.aired_episodes_in_season)).find(value => value !== null);
  const nextToAir = show.nextEpisodeToAir as SeriesCardEpisode | undefined;
  const episodeDates = new Map(cached?.episodes?.map(item => [item.episode_number, item.air_date]));
  const counts: Record<SeasonSegmentState, number> = { seen: 0, current: 0, unseen: 0, future: 0, history: 0, unknown: 0 };
  const segments: SeasonSegment[] = [];
  for (let number = 1; number <= renderTotal; number += 1) {
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
    if (renderTotal <= 30) segments.push({ state, count: 1, episode: number });
  }

  const watchedAired = aired === undefined || aired === null ? 0 : [...seen].filter(number => number <= aired).length;
  const availableUnseen = aired === undefined || aired === null
    ? counts.unseen + (context === 'watch' && counts.current > 0 ? counts.current : 0)
    : Math.max(0, aired - watchedAired);
  const detail = unknownTail && context === 'watch'
    ? (availableUnseen > 0 ? `${availableUnseen} dispo · total inconnu` : 'suite annoncée · total inconnu')
    : undefined;
  const description = unknownTail
    ? `Saison ${season} : ${watched} épisode${watched > 1 ? 's' : ''} vu${watched > 1 ? 's' : ''} sur ${renderTotal} connu${renderTotal > 1 ? 's' : ''}, nombre total encore inconnu`
    : `Saison ${season}, ${watched} épisodes vus sur ${renderTotal}, ${counts.future} à venir, ${counts.unknown} diffusions à confirmer`;

  return {
    label,
    description,
    continuous: renderTotal > 30,
    segments: renderTotal > 30
      ? (Object.entries(counts) as Array<[SeasonSegmentState, number]>).filter(([, amount]) => amount > 0).map(([state, amount]) => ({ state, count: amount }))
      : segments,
    totalUnknown,
    unknownTail,
    knownEpisodes: renderTotal,
    availableUnseen,
    detail,
  };
}

export function upcomingCardTone(days: number): 'today' | 'soon' | 'later' {
  return days <= 0 ? 'today' : days <= 7 ? 'soon' : 'later';
}

export function imageUrl(path?: string | null, size = 'w342'): string | null {
  return path ? path.startsWith('http') ? path : `https://image.tmdb.org/t/p/${size}${path}` : null;
}

export function seriesCardPosterCrossOrigin(path: string | null, native: boolean): 'anonymous' | undefined {
  return path?.startsWith('https://image.tmdb.org/') && !native ? 'anonymous' : undefined;
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
