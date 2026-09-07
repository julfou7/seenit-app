export type MediaTitleType = 'movie' | 'tv';

export interface TrackedMediaTitleLike {
  id?: string | number | null;
  tmdbId?: string | number | null;
  mediaType?: 'movie' | 'tv' | null;
  title?: string | null;
}

const cleanTitle = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Le client TMDB appelle les fiches en fr-FR. Le champ title/name de cette réponse
 * est donc la valeur éditoriale à privilégier. Les champs original_* ne sont qu'un
 * dernier repli si TMDB ne fournit aucun titre localisé exploitable.
 */
export function getTmdbLocalizedTitle(details: any, mediaType: MediaTitleType): string | null {
  const candidates = mediaType === 'movie'
    ? [details?.title, details?.name, details?.original_title, details?.original_name]
    : [details?.name, details?.title, details?.original_name, details?.original_title];

  for (const candidate of candidates) {
    const cleaned = cleanTitle(candidate);
    if (cleaned) return cleaned;
  }
  return null;
}

export function resolveMediaDisplayTitle(
  persistedTitle: unknown,
  details: any,
  mediaType: MediaTitleType,
  fallback = 'Chargement...',
): string {
  return getTmdbLocalizedTitle(details, mediaType) || cleanTitle(persistedTitle) || fallback;
}

/**
 * Détermine une convergence de métadonnée uniquement depuis l'identité canonique.
 * Le titre n'intervient jamais pour trouver ou désambiguïser le média.
 */
export function getTrackedMediaTitleConvergence(
  shows: TrackedMediaTitleLike[],
  mediaType: MediaTitleType,
  tmdbId: string | number,
  details: any,
): { showId: string; title: string } | null {
  const normalizedTmdbId = Number(tmdbId);
  if (!Number.isFinite(normalizedTmdbId) || normalizedTmdbId <= 0) return null;

  const localizedTitle = getTmdbLocalizedTitle(details, mediaType);
  if (!localizedTitle) return null;

  const tracked = shows.find((show) => {
    const trackedType: MediaTitleType = show.mediaType === 'movie' ? 'movie' : 'tv';
    return trackedType === mediaType && Number(show.tmdbId) === normalizedTmdbId;
  });

  if (!tracked?.id || cleanTitle(tracked.title) === localizedTitle) return null;
  return { showId: String(tracked.id), title: localizedTitle };
}
