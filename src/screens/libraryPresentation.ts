import type { TMDBMedia } from '../features/shows/tmdb';
import type { Show } from '../types';

export function normalizeKnownLibraryDate(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return undefined;

  const [year, month, day] = trimmed.split('-').map(Number);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 1900 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return undefined;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return undefined;
  }

  return trimmed;
}

export function buildLibraryMedia(show: Show): TMDBMedia {
  const knownDate = normalizeKnownLibraryDate(show.firstAirDate);

  return {
    id: Number(show.tmdbId),
    name: show.title,
    title: show.title,
    poster_path: show.posterPath,
    backdrop_path: show.backdropPath,
    first_air_date: show.mediaType === 'tv' ? knownDate : undefined,
    release_date: show.mediaType === 'movie' ? knownDate : undefined,
    media_type: show.mediaType,
    vote_average: show.userRating || 0,
  };
}
