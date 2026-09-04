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

  return resolveAutomaticRating(mediaType, details);
}

/**
 * Ajoute le résultat SeenIt sans réécrire les certifications TMDB brutes. Les autres
 * consommateurs (cinéma, diagnostics, futurs mappings) continuent ainsi à voir le
 * payload officiel inchangé.
 */
export function decorateParentalRatingDetails(
  mediaType: ParentalMediaType,
  details: any,
  override?: ParentalRatingOverride | null,
): any {
  if (!details) return details;
  return {
    ...details,
    seenitParentalRating: resolveParentalRating(mediaType, details, override),
  };
}

export function getParentalRatingColorClass(result: ParentalRatingResult): string {
  if (!result.isKnown || result.age === null) {
    return 'bg-zinc-800/80 border-white/10 text-zinc-400';
  }
  if (result.age === 0) {
    return 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400';
  }
  if (result.age >= 17) {
    return 'bg-red-500/15 border-red-500/30 text-red-400';
  }
  return 'bg-amber-500/15 border-amber-500/30 text-amber-400';
}

export function matchesMaxRecommendedAge(result: ParentalRatingResult, maxAge: number | null): boolean {
  if (maxAge === null) return true;
  return result.isKnown && result.age !== null && result.age <= maxAge;
}

export function parseMaxAgeFilter(value: string): number | null {
  const normalized = String(value || '').trim();
  if (!normalized || normalized === 'Tous') return null;
  if (normalized === 'TP' || normalized === 'Tout Public' || normalized === 'Tous publics') return 0;
  const stripped = normalized.replace(/^age:/i, '').replace(/^[-+]/, '').replace(/\+$/, '');
  const parsed = Number(stripped);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 18 ? parsed : null;
}
