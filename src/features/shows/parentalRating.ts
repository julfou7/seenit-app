export type ParentalMediaType = 'movie' | 'tv';

export interface ParentalRatingOverride {
  age: number;
  updatedAt: number;
}

export interface ParentalRatingResult {
  source: 'tmdb-us' | 'personal' | 'unknown';
  original: string | null;
  country: 'US' | null;
  age: number | null;
  label: string;
  shortLabel: string;
  isKnown: boolean;
}

const MOVIE_US_AGES: Record<string, number> = {
  G: 0,
  PG: 10,
  'PG-13': 13,
  R: 17,
  'NC-17': 18,
  '18': 18,
};

const TV_US_AGES: Record<string, number> = {
  'TV-Y': 0,
  'TV-Y7': 7,
  'TV-Y7-FV': 7,
  'TV-G': 0,
  'TV-PG': 10,
  'TV-14': 14,
  'TV-MA': 18,
  '18': 18,
};

export const parentalRatingKey = (mediaType: ParentalMediaType, tmdbId: number): string => (
  `${mediaType}:${Number(tmdbId)}`
);

function normalizeCertification(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function ageToShortLabel(age: number): string {
  return age === 0 ? 'Tous publics' : `${age}+`;
}

function resolveCertificationAge(mediaType: ParentalMediaType, certification: string): number | null {
  const table = mediaType === 'movie' ? MOVIE_US_AGES : TV_US_AGES;
  return Object.prototype.hasOwnProperty.call(table, certification) ? table[certification] : null;
}

function extractUsCertifications(mediaType: ParentalMediaType, details: any): string[] {
  if (!details) return [];

  if (mediaType === 'movie') {
    const us = details.release_dates?.results?.find((entry: any) => entry?.iso_3166_1 === 'US');
    if (!us || !Array.isArray(us.release_dates)) return [];
    return us.release_dates
      .map((entry: any) => normalizeCertification(entry?.certification))
      .filter(Boolean);
  }

  const us = details.content_ratings?.results?.find((entry: any) => entry?.iso_3166_1 === 'US');
  const rating = normalizeCertification(us?.rating);
  return rating ? [rating] : [];
}

function resolveAutomaticRating(mediaType: ParentalMediaType, details: any): ParentalRatingResult {
  const candidates = extractUsCertifications(mediaType, details);
  const recognized = candidates
    .map(original => ({ original, age: resolveCertificationAge(mediaType, original) }))
    .filter((entry): entry is { original: string; age: number } => entry.age !== null)
    .sort((a, b) => b.age - a.age);

  if (recognized.length === 0) {
    return {
      source: 'unknown',
      original: candidates[0] || null,
      country: candidates.length > 0 ? 'US' : null,
      age: null,
      label: 'Âge à vérifier',
      shortLabel: 'Âge à vérifier',
      isKnown: false,
    };
  }

  const selected = recognized[0];
  const shortLabel = ageToShortLabel(selected.age);
  return {
    source: 'tmdb-us',
    original: selected.original,
    country: 'US',
    age: selected.age,
    label: `${selected.original} · US · ${shortLabel}`,
    shortLabel,
    isKnown: true,
  };
}

export function resolveParentalRating(
  mediaType: ParentalMediaType,
  details: any,
  override?: ParentalRatingOverride | null,
): ParentalRatingResult {
  if (override && Number.isInteger(override.age) && override.age >= 0 && override.age <= 18) {
    const shortLabel = ageToShortLabel(override.age);
    return {
      source: 'personal',
      original: null,
      country: null,
      age: override.age,
      label: `${shortLabel} · Choix personnel`,
      shortLabel,
      isKnown: true,
    };
  }

  if (details?.seenitParentalRating) {
    return details.seenitParentalRating as ParentalRatingResult;
  }

  return resolveAutomaticRating(mediaType, details);
}

export function decorateParentalRatingDetails(
  mediaType: ParentalMediaType,
  details: any,
  override?: ParentalRatingOverride | null,
): any {
  if (!details) return details;
  const rating = resolveParentalRating(mediaType, details, override);

  if (mediaType === 'movie') {
    const rawResults = Array.isArray(details.release_dates?.results) ? details.release_dates.results : [];
    let hasUs = false;
    const results = rawResults.map((entry: any) => {
      if (entry?.iso_3166_1 === 'FR') {
        return {
          ...entry,
          release_dates: Array.isArray(entry.release_dates)
            ? entry.release_dates.map((release: any) => ({ ...release, certification: '' }))
            : [],
        };
      }
      if (entry?.iso_3166_1 === 'US') {
        hasUs = true;
        const releases = Array.isArray(entry.release_dates) && entry.release_dates.length > 0
          ? entry.release_dates.map((release: any, index: number) => ({
              ...release,
              certification: index === 0 ? rating.label : '',
            }))
          : [{ certification: rating.label }];
        return { ...entry, release_dates: releases };
      }
      return entry;
    });
    if (!hasUs) results.push({ iso_3166_1: 'US', release_dates: [{ certification: rating.label }] });
    return {
      ...details,
      release_dates: { ...(details.release_dates || {}), results },
      seenitParentalRating: rating,
    };
  }

  const rawResults = Array.isArray(details.content_ratings?.results) ? details.content_ratings.results : [];
  let hasUs = false;
  const results = rawResults.map((entry: any) => {
    if (entry?.iso_3166_1 === 'FR') return { ...entry, rating: '' };
    if (entry?.iso_3166_1 === 'US') {
      hasUs = true;
      return { ...entry, rating: rating.label };
    }
    return entry;
  });
  if (!hasUs) results.push({ iso_3166_1: 'US', rating: rating.label });
  return {
    ...details,
    content_ratings: { ...(details.content_ratings || {}), results },
    seenitParentalRating: rating,
  };
}

export function matchesMaxRecommendedAge(result: ParentalRatingResult, maxAge: number | null): boolean {
  if (maxAge === null) return true;
  return result.isKnown && result.age !== null && result.age <= maxAge;
}

export function parseMaxAgeFilter(value: string): number | null {
  if (!value || value === 'Tous') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
