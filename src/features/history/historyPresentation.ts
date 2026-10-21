import type { SeriesSeasonProgress, SeasonSegmentState } from '../watchlist/seriesCardPresentation';

export interface HistoryResolvedTimestamp {
  watchedAt: number;
  timeKnown: boolean;
}

export interface HistoryCollectionPart {
  id: number;
  releaseDate?: string | null;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return parseHistoryLocalDateTime(value.trim(), '')?.watchedAt ?? null;
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

export function resolveHistoryTimestamp(explicit: unknown, ...fallbacks: unknown[]): HistoryResolvedTimestamp | null {
  const direct = parseTimestamp(explicit);
  if (direct !== null) return { watchedAt: direct, timeKnown: !(typeof explicit === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(explicit.trim())) };
  for (const fallback of fallbacks) {
    const value = parseTimestamp(fallback);
    if (value !== null) return { watchedAt: value, timeKnown: false };
  }
  return null;
}

export function historyLocalDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function capitalize(value: string): string {
  return value ? `${value[0].toLocaleUpperCase('fr-FR')}${value.slice(1)}` : value;
}

export function formatHistoryDayLabel(timestamp: number, now: number = Date.now()): string {
  const day = startOfLocalDay(timestamp);
  const today = startOfLocalDay(now);
  const current = new Date(now);
  const yesterday = new Date(current.getFullYear(), current.getMonth(), current.getDate() - 1).getTime();
  if (day === today) return "Aujourd'hui";
  if (day === yesterday) return 'Hier';

  const date = new Date(timestamp);
  const formatted = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() === current.getFullYear() ? {} : { year: 'numeric' as const }),
  }).format(date);
  return capitalize(formatted);
}

export function formatHistoryClock(timestamp: number, timeKnown: boolean): string | null {
  if (!timeKnown) return null;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function formatHistoryRuntime(minutes: unknown): string | null {
  const numeric = typeof minutes === 'number' ? minutes : Number(minutes);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const rounded = Math.round(numeric);
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const remaining = rounded % 60;
  return remaining > 0 ? `${hours} h ${String(remaining).padStart(2, '0')}` : `${hours} h`;
}

export function formatHistoryAriaWhen(timestamp: number, timeKnown: boolean, now: number = Date.now()): string {
  const label = formatHistoryDayLabel(timestamp, now).toLocaleLowerCase('fr-FR');
  const clock = formatHistoryClock(timestamp, timeKnown);
  if (!clock) return label;
  const [hours, minutes] = clock.split(':');
  return `${label} à ${Number(hours)} h ${minutes}`;
}

export function buildHistoryAriaLabel(input: {
  title: string;
  mediaType: 'tv' | 'movie';
  season?: number;
  episode?: number;
  episodeTitle?: string | null;
  watchedAt: number;
  timeKnown: boolean;
  now?: number;
}): string {
  const when = formatHistoryAriaWhen(input.watchedAt, input.timeKnown, input.now);
  if (input.mediaType === 'movie') return `${input.title}, film, vu ${when}`;
  const episode = `saison ${input.season ?? 0} épisode ${input.episode ?? 0}`;
  const title = input.episodeTitle?.trim() ? `, ${input.episodeTitle.trim()}` : '';
  return `${input.title}, ${episode}${title}, vu ${when}`;
}

export function historyDateInputValue(timestamp: number): string {
  return historyLocalDayKey(timestamp);
}

export function historyTimeInputValue(timestamp: number, timeKnown: boolean): string {
  if (!timeKnown) return '';
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function parseHistoryLocalDateTime(dateValue: string, timeValue: string): HistoryResolvedTimestamp | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue.trim());
  if (!match) return null;
  const timeMatch = timeValue.trim() ? /^(\d{2}):(\d{2})$/.exec(timeValue.trim()) : null;
  if (timeValue.trim() && !timeMatch) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = timeMatch ? Number(timeMatch[1]) : 12;
  const minute = timeMatch ? Number(timeMatch[2]) : 0;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day ||
    date.getHours() !== hour || date.getMinutes() !== minute
  ) return null;
  return { watchedAt: date.getTime(), timeKnown: Boolean(timeMatch) };
}

export function buildMovieCollectionProgress(
  parts: readonly HistoryCollectionPart[] | null | undefined,
  currentTmdbId: number,
  watchedMovieIds: ReadonlySet<number>,
  today: string,
): SeriesSeasonProgress {
  const unique = new Map((parts || []).map(part => [part.id, part]));
  const normalized = [...unique.values()]
    .filter(part => Number.isInteger(part.id) && part.id > 0)
    .map(part => ({ id: Number(part.id), releaseDate: part.releaseDate || null }))
    .sort((left, right) => {
      const leftDate = left.releaseDate || '9999-12-31';
      const rightDate = right.releaseDate || '9999-12-31';
      return leftDate.localeCompare(rightDate) || left.id - right.id;
    });

  if (normalized.length === 0 || !normalized.some(part => part.id === currentTmdbId)) {
    return {
      label: 'Film',
      description: 'Film vu, sans collection TMDB exploitable',
      continuous: false,
      totalUnknown: false, unknownTail: false, knownEpisodes: 1, availableUnseen: 0,
      segments: [{ state: 'history', count: 1 }],
    };
  }

  const states = normalized.map<SeasonSegmentState>(part => {
    if (part.id === currentTmdbId) return 'history';
    if (watchedMovieIds.has(part.id)) return 'seen';
    if (!part.releaseDate) return 'unknown';
    return part.releaseDate > today ? 'future' : 'unseen';
  });
  const counts = states.reduce<Record<SeasonSegmentState, number>>((result, state) => {
    result[state] += 1;
    return result;
  }, { seen: 0, current: 0, unseen: 0, future: 0, history: 0, unknown: 0 });

  return {
    label: `Collection · ${normalized.length}`,
    description: `Collection de ${normalized.length} films, ${counts.seen + counts.history} vus, ${counts.future} à venir, ${counts.unknown} dates à confirmer`,
    continuous: normalized.length > 30,
    totalUnknown: false, unknownTail: false, knownEpisodes: normalized.length, availableUnseen: counts.unseen,
    segments: normalized.length > 30
      ? (Object.entries(counts) as Array<[SeasonSegmentState, number]>)
        .filter(([, amount]) => amount > 0)
        .map(([state, amount]) => ({ state, count: amount }))
      : states.map(state => ({ state, count: 1 })),
  };
}
