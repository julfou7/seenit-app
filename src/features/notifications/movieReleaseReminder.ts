export type MovieReleaseReminderKind = 'theater' | 'home';

type TmdbReleaseDate = {
  type?: number;
  release_date?: string;
};

type TmdbCountryReleaseDates = {
  iso_3166_1?: string;
  release_dates?: TmdbReleaseDate[];
};

const RELEASE_TYPE_PRIORITY: Record<MovieReleaseReminderKind, readonly number[]> = {
  theater: [3, 2],
  home: [4, 5],
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

/**
 * Retourne une date de sortie française explicite fournie par TMDB.
 *
 * - cinéma : priorité au type 3 (sortie salles), puis type 2 (sortie limitée) ;
 * - vidéo : première disponibilité type 4 (digital/VOD) ou, à défaut, type 5
 *   (physique).
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

  for (const releaseType of RELEASE_TYPE_PRIORITY[kind]) {
    const dates = frenchEntries
      .flatMap(entry => Array.isArray(entry.release_dates) ? entry.release_dates : [])
      .filter(entry => Number(entry?.type) === releaseType)
      .map(entry => parseDateKey(entry?.release_date))
      .filter((date): date is string => Boolean(date))
      .sort();
    if (dates.length > 0) return dates[0];
  }

  return null;
}

export function toLocalReminderDate(dateKey: string, hour = 9): Date | null {
  const normalized = parseDateKey(dateKey);
  if (!normalized) return null;
  const [year, month, day] = normalized.split('-').map(Number);
  return new Date(year, month - 1, day, hour, 0, 0, 0);
}
