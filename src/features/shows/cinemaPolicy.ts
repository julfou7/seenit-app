const CINEMA_PAST_DAYS = 75;
const CINEMA_FUTURE_DAYS = 10;
const CINEMA_EVIDENCE_TTL_MS = 6 * 60 * 60 * 1000;
const FRENCH_THEATRICAL_RELEASE_TYPES = new Set([2, 3]);
const frenchTheatricalMovieEvidence = new Map<number, number>();

export const getCinemaWindow = (now: Date = new Date()) => {
  const pastCutoff = new Date(now);
  pastCutoff.setHours(0, 0, 0, 0);
  pastCutoff.setDate(pastCutoff.getDate() - CINEMA_PAST_DAYS);

  const futureCutoff = new Date(now);
  futureCutoff.setHours(23, 59, 59, 999);
  futureCutoff.setDate(futureCutoff.getDate() + CINEMA_FUTURE_DAYS);

  return { pastCutoff, futureCutoff };
};

const getFrenchTheatricalReleaseDates = (media: any): Date[] => {
  const countries = media?.release_dates?.results;
  if (!Array.isArray(countries)) return [];

  const france = countries.find((country: any) => country?.iso_3166_1 === 'FR');
  if (!Array.isArray(france?.release_dates)) return [];

  return france.release_dates
    .filter((release: any) => FRENCH_THEATRICAL_RELEASE_TYPES.has(Number(release?.type)))
    .map((release: any) => new Date(release?.release_date))
    .filter((releaseDate: Date) => !Number.isNaN(releaseDate.getTime()));
};

export const hasCurrentFrenchTheatricalRelease = (media: any, now: Date = new Date()): boolean => {
  const theatricalDates = getFrenchTheatricalReleaseDates(media);
  if (theatricalDates.length === 0) return false;

  const { pastCutoff, futureCutoff } = getCinemaWindow(now);
  return theatricalDates.some(releaseDate => releaseDate >= pastCutoff && releaseDate <= futureCutoff);
};

export const rememberFrenchTheatricalEvidence = (mediaId: number, checkedAt: number = Date.now()) => {
  if (Number.isFinite(mediaId)) frenchTheatricalMovieEvidence.set(mediaId, checkedAt);
};

export const clearFrenchTheatricalEvidence = (mediaId: number) => {
  if (Number.isFinite(mediaId)) frenchTheatricalMovieEvidence.delete(mediaId);
};

const hasFreshFrenchTheatricalEvidence = (mediaId: number, nowMs: number): boolean => {
  if (!Number.isFinite(mediaId)) return false;
  const checkedAt = frenchTheatricalMovieEvidence.get(mediaId);
  if (!checkedAt) return false;
  if (nowMs - checkedAt > CINEMA_EVIDENCE_TTL_MS) {
    frenchTheatricalMovieEvidence.delete(mediaId);
    return false;
  }
  return true;
};

const isFreshInlineTheatricalEvidence = (media: any, nowMs: number): boolean => {
  if (media?.seenitFrenchTheatrical !== true) return false;
  const checkedAt = Number(media?.seenitFrenchTheatricalCheckedAt);
  return Number.isFinite(checkedAt) && nowMs - checkedAt <= CINEMA_EVIDENCE_TTL_MS;
};

/**
 * Politique pure de preuve cinéma. Le filtrage TV/adulte reste à la façade TMDB.
 */
export const hasFrenchTheatricalCinemaEvidence = (media: any, now: Date = new Date()): boolean => {
  if (!media) return false;

  const nowMs = now.getTime();
  const mediaId = Number(media.id ?? media.tmdbId);
  const hasReleaseDatesPayload = Array.isArray(media?.release_dates?.results);

  // Un payload release_dates complet est prioritaire sur tout cache : il confirme
  // ou invalide directement la preuve théâtrale française.
  if (hasReleaseDatesPayload) {
    const isTheatrical = hasCurrentFrenchTheatricalRelease(media, now);
    if (Number.isFinite(mediaId)) {
      if (isTheatrical) rememberFrenchTheatricalEvidence(mediaId, nowMs);
      else clearFrenchTheatricalEvidence(mediaId);
    }
    return isTheatrical;
  }

  // Un marqueur interne n'est valide que s'il vient d'une preuve récente.
  if (isFreshInlineTheatricalEvidence(media, nowMs)) return true;

  return hasFreshFrenchTheatricalEvidence(mediaId, nowMs);
};
