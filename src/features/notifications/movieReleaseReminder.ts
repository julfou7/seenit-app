export type MovieReleaseReminderKind = 'theater' | 'home';

type TmdbReleaseDate = {
  type?: number;
  release_date?: string;
};

type TmdbCountryReleaseDates = {
  iso_3166_1?: string;
  release_dates?: TmdbReleaseDate[];
};

function parseDateKey(value: unknown): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function collectFrenchDates(
  frenchEntries: TmdbCountryReleaseDates[],
  releaseTypes: readonly number[],
): string[] {
  const allowedTypes = new Set(releaseTypes);
  return frenchEntries
    .flatMap(entry => Array.isArray(entry.release_dates) ? entry.release_dates : [])
    .filter(entry => allowedTypes.has(Number(entry?.type)))
    .map(entry => parseDateKey(entry?.release_date))
    .filter((date): date is string => Boolean(date))
    .sort();
}

/**
 * Retourne une date de sortie française explicite fournie par TMDB.
 *
 * - cinéma : priorité au type 3 (sortie salles), puis type 2 (sortie limitée) ;
 * - vidéo : première disponibilité explicite parmi type 4 (digital/VOD) et
 *   type 5 (physique).
 *
 * Aucune date générique ni estimation à partir de la sortie originale n'est
 * acceptée : une absence de preuve reste `null` afin d'éviter un faux rappel.
 */
export function resolveFrenchMovieReleaseReminderDate(
  details: any,
  kind: MovieReleaseReminderKind,
): string | null {
  const countries = Array.isArray(details?.release_dates?.results)
    ? details.release_dates.results as TmdbCountryReleaseDates[]
    : [];
  const frenchEntries = countries.filter(entry => entry?.iso_3166_1 === 'FR');
  if (frenchEntries.length === 0) return null;

  if (kind === 'home') {
    return collectFrenchDates(frenchEntries, [4, 5])[0] || null;
  }

  const theatrical = collectFrenchDates(frenchEntries, [3]);
  if (theatrical.length > 0) return theatrical[0];
  return collectFrenchDates(frenchEntries, [2])[0] || null;
}

export function toLocalReminderDate(dateKey: string, hour = 9): Date | null {
  const normalized = parseDateKey(dateKey);
  if (!normalized) return null;
  const [year, month, day] = normalized.split('-').map(Number);
  return new Date(year, month - 1, day, hour, 0, 0, 0);
}
