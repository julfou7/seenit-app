const CINEMA_PAST_DAYS = 75;
const CINEMA_FUTURE_DAYS = 10;
const CINEMA_EVIDENCE_TTL_MS = 6 * 60 * 60 * 1000;
const FRENCH_THEATRICAL_RELEASE_TYPES = new Set([2, 3]);

const EVENT_SPECIFIC_RELEASE_NOTE_PATTERNS = [
  /\bfestival\b/i,
  /\bavant[\s-]?premi[eè]re\b/i,
  /\bprojection\b/i,
  /\bs[ée]ance\b/i,
  /\bscreening\b/i,
  /\bspecial\s+screening\b/i,
  /\bcin[ée]math[eè]que\b/i,
  /\binstitut\s+lumi[eè]re\b/i,
];

interface TmdbReleaseDateEntry {
  type?: number | string | null;
  release_date?: string | null;
  note?: string | null;
}

interface TmdbReleaseCountry {
  iso_3166_1?: string | null;
  release_dates?: TmdbReleaseDateEntry[] | null;
}

interface CinemaEvidenceMedia {
  id?: number | string | null;
  tmdbId?: number | string | null;
  media_type?: string | null;
  mediaType?: string | null;
  first_air_date?: unknown;
  seenitFrenchTheatrical?: boolean;
  seenitFrenchTheatricalCheckedAt?: number | string | null;
  release_dates?: {
    results?: TmdbReleaseCountry[] | null;
  } | null;
}

const toCinemaEvidenceMedia = (media: unknown): CinemaEvidenceMedia => {
  if (typeof media !== 'object' || media === null) return {};
  return media as CinemaEvidenceMedia;
};

export const getCinemaWindow = (now: Date = new Date()) => {
  const pastCutoff = new Date(now);
  pastCutoff.setHours(0, 0, 0, 0);
  pastCutoff.setDate(pastCutoff.getDate() - CINEMA_PAST_DAYS);

  const futureCutoff = new Date(now);
  futureCutoff.setHours(23, 59, 59, 999);
  futureCutoff.setDate(futureCutoff.getDate() + CINEMA_FUTURE_DAYS);

  return { pastCutoff, futureCutoff };
};

const isEndedEventSpecificRelease = (
  release: TmdbReleaseDateEntry,
  releaseDate: Date,
  now: Date,
): boolean => {
  const note = typeof release.note === 'string' ? release.note.trim() : '';
  if (!note || !EVENT_SPECIFIC_RELEASE_NOTE_PATTERNS.some(pattern => pattern.test(note))) return false;

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  return releaseDate < todayStart;
};

const getFrenchTheatricalReleaseDates = (media: CinemaEvidenceMedia, now: Date): Date[] => {
  const countries = media.release_dates?.results;
  if (!Array.isArray(countries)) return [];

  const france = countries.find(country => country?.iso_3166_1 === 'FR');
  if (!Array.isArray(france?.release_dates)) return [];

  return france.release_dates
    .filter(release => FRENCH_THEATRICAL_RELEASE_TYPES.has(Number(release?.type)))
    .map(release => ({
      release,
      releaseDate: new Date(typeof release?.release_date === 'string' ? release.release_date : ''),
    }))
    .filter(entry => !Number.isNaN(entry.releaseDate.getTime()))
    .filter(entry => !isEndedEventSpecificRelease(entry.release, entry.releaseDate, now))
    .map(entry => entry.releaseDate);
};

export const hasCurrentFrenchTheatricalRelease = (media: unknown, now: Date = new Date()): boolean => {
  const theatricalDates = getFrenchTheatricalReleaseDates(toCinemaEvidenceMedia(media), now);
  if (theatricalDates.length === 0) return false;

  const { pastCutoff, futureCutoff } = getCinemaWindow(now);
  return theatricalDates.some(releaseDate => releaseDate >= pastCutoff && releaseDate <= futureCutoff);
};

/**
 * API conservée pour les appels historiques. La preuve cinéma n'est plus stockée
 * dans un état global mutable : un résultat Discover transporte son marqueur inline
 * et un payload release_dates détaillé reste autoritatif sans réchauffer les cartes.
 */
export const rememberFrenchTheatricalEvidence = (mediaId: number, checkedAt: number = Date.now()) => {
  void mediaId;
  void checkedAt;
};

export const clearFrenchTheatricalEvidence = (mediaId: number) => {
  void mediaId;
};

const isFreshInlineTheatricalEvidence = (media: CinemaEvidenceMedia, nowMs: number): boolean => {
  // Les marqueurs inline ne sont valides que sur les objets TMDB de liste. Un Show
  // suivi utilise `mediaType`/`tmdbId` et ne doit jamais réactiver une preuve détaillée
  // négative via les OR historiques des vues.
  if (media.media_type !== 'movie' || media.seenitFrenchTheatrical !== true) return false;
  const checkedAt = Number(media.seenitFrenchTheatricalCheckedAt);
  return Number.isFinite(checkedAt) && nowMs - checkedAt <= CINEMA_EVIDENCE_TTL_MS;
};

/**
 * Politique pure de preuve cinéma. Le filtrage TV/adulte reste à la façade TMDB.
 *
 * - release_dates est toujours autoritatif lorsqu'il existe ;
 * - une projection explicitement événementielle déjà passée ne prouve pas une
 *   disponibilité cinéma courante ;
 * - l'ouverture d'une fiche ne peut plus modifier une carte via un cache global ;
 * - seul le marqueur inline d'un résultat TMDB Discover contraint peut servir sans
 *   payload détaillé.
 */
export const hasFrenchTheatricalCinemaEvidence = (media: unknown, now: Date = new Date()): boolean => {
  if (!media) return false;

  const normalizedMedia = toCinemaEvidenceMedia(media);
  const hasReleaseDatesPayload = Array.isArray(normalizedMedia.release_dates?.results);
  if (hasReleaseDatesPayload) return hasCurrentFrenchTheatricalRelease(normalizedMedia, now);

  return isFreshInlineTheatricalEvidence(normalizedMedia, now.getTime());
};
