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

export const getCinemaWindow = (now: Date = new Date()) => {
  const pastCutoff = new Date(now);
  pastCutoff.setHours(0, 0, 0, 0);
  pastCutoff.setDate(pastCutoff.getDate() - CINEMA_PAST_DAYS);

  const futureCutoff = new Date(now);
  futureCutoff.setHours(23, 59, 59, 999);
  futureCutoff.setDate(futureCutoff.getDate() + CINEMA_FUTURE_DAYS);

  return { pastCutoff, futureCutoff };
};

const isEndedEventSpecificRelease = (release: any, releaseDate: Date, now: Date): boolean => {
  const note = typeof release?.note === 'string' ? release.note.trim() : '';
  if (!note || !EVENT_SPECIFIC_RELEASE_NOTE_PATTERNS.some(pattern => pattern.test(note))) return false;

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  return releaseDate < todayStart;
};

const getFrenchTheatricalReleaseDates = (media: any, now: Date): Date[] => {
  const countries = media?.release_dates?.results;
  if (!Array.isArray(countries)) return [];

  const france = countries.find((country: any) => country?.iso_3166_1 === 'FR');
  if (!Array.isArray(france?.release_dates)) return [];

  return france.release_dates
    .filter((release: any) => FRENCH_THEATRICAL_RELEASE_TYPES.has(Number(release?.type)))
    .map((release: any) => ({ release, releaseDate: new Date(release?.release_date) }))
    .filter(({ releaseDate }: { releaseDate: Date }) => !Number.isNaN(releaseDate.getTime()))
    .filter(({ release, releaseDate }: { release: any; releaseDate: Date }) => !isEndedEventSpecificRelease(release, releaseDate, now))
    .map(({ releaseDate }: { releaseDate: Date }) => releaseDate);
};

export const hasCurrentFrenchTheatricalRelease = (media: any, now: Date = new Date()): boolean => {
  const theatricalDates = getFrenchTheatricalReleaseDates(media, now);
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

const isFreshInlineTheatricalEvidence = (media: any, nowMs: number): boolean => {
  // Les marqueurs inline ne sont valides que sur les objets TMDB de liste. Un Show
  // suivi utilise `mediaType`/`tmdbId` et ne doit jamais réactiver une preuve détaillée
  // négative via les OR historiques des vues.
  if (media?.media_type !== 'movie' || media?.seenitFrenchTheatrical !== true) return false;
  const checkedAt = Number(media?.seenitFrenchTheatricalCheckedAt);
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
export const hasFrenchTheatricalCinemaEvidence = (media: any, now: Date = new Date()): boolean => {
  if (!media) return false;

  const hasReleaseDatesPayload = Array.isArray(media?.release_dates?.results);
  if (hasReleaseDatesPayload) return hasCurrentFrenchTheatricalRelease(media, now);

  return isFreshInlineTheatricalEvidence(media, now.getTime());
};