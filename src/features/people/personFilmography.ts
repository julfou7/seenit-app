export type PersonCreditMediaType = 'movie' | 'tv';
export type PersonActingCategory = 'movies' | 'series' | 'appearances';

export interface PersonCredit {
  id: number;
  media_type: PersonCreditMediaType;
  name?: string;
  title?: string;
  first_air_date?: string;
  release_date?: string;
  poster_path: string | null;
  backdrop_path?: string | null;
  original_language?: string;
  popularity?: number;
  vote_average?: number;
  vote_count?: number;
  character?: string;
  job?: string;
  rawCharacters?: string[];
  rawJobs?: string[];
}

export interface PersonActingCredits {
  movies: PersonCredit[];
  series: PersonCredit[];
  appearances: PersonCredit[];
}

export const PERSON_FILMOGRAPHY_PAGE_SIZE = 48;

const ASIAN_LANGUAGES = new Set(['ja', 'ko', 'zh', 'cn', 'th', 'hi', 'ta', 'te']);

function jobPriority(job: string): number {
  const normalized = job.toLowerCase();
  if (normalized.includes('director') || normalized.includes('réalisateur')) return 1;
  if (normalized.includes('creator') || normalized.includes('créateur')) return 2;
  if (normalized.includes('writer') || normalized.includes('screenplay') || normalized.includes('scénariste') || normalized.includes('story')) return 3;
  if (normalized.includes('producer') || normalized.includes('producteur')) return 4;
  return 5;
}

function translateJob(job: string): string {
  const translations: Record<string, string> = {
    Director: 'Réalisateur',
    Writer: 'Scénariste',
    Screenplay: 'Scénariste',
    Story: 'Histoire originale',
    Producer: 'Producteur',
    'Executive Producer': 'Producteur exécutif',
    Creator: 'Créateur',
    Author: 'Auteur',
    Novel: 'Roman',
    'Co-Director': 'Co-réalisateur',
    'Original Concept': 'Concept original'
  };
  return translations[job] || job;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function inferMediaType(record: Record<string, unknown>): PersonCreditMediaType {
  if (record.media_type === 'tv') return 'tv';
  if (record.media_type === 'movie') return 'movie';
  return record.first_air_date !== undefined ? 'tv' : 'movie';
}

function normalizeCredit(value: unknown): PersonCredit | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = readNumber(record.id);
  if (id <= 0) return null;

  const source = value as Partial<PersonCredit>;
  return {
    ...source,
    id,
    media_type: inferMediaType(record),
    poster_path: typeof record.poster_path === 'string' ? record.poster_path : null,
    original_language: readString(record.original_language) || undefined,
    popularity: readNumber(record.popularity),
    vote_average: readNumber(record.vote_average),
    vote_count: readNumber(record.vote_count),
    character: readString(record.character),
    job: readString(record.job)
  };
}

export function deduplicateAndSortPersonCredits(
  rawList: unknown,
  type: 'cast' | 'crew'
): PersonCredit[] {
  if (!Array.isArray(rawList)) return [];

  const credits = new Map<string, PersonCredit>();
  for (const value of rawList) {
    const item = normalizeCredit(value);
    if (!item) continue;

    if (item.original_language && ASIAN_LANGUAGES.has(item.original_language)) {
      if (!(Number(item.popularity || 0) >= 35
          || (Number(item.vote_average || 0) >= 7.8 && Number(item.vote_count || 0) >= 100))) continue;
    }

    const key = personCreditIdentity(item);
    const existing = credits.get(key);
    if (!existing) {
      if (type === 'crew') {
        item.rawJobs = item.job ? [item.job] : [];
        item.job = item.job ? translateJob(item.job) : '';
      } else {
        item.rawCharacters = item.character ? [item.character] : [];
      }
      credits.set(key, item);
      continue;
    }

    if (type === 'crew') {
      const rawJob = readString((value as Record<string, unknown>).job);
      const jobs = existing.rawJobs || [];
      if (rawJob && !jobs.includes(rawJob)) {
        existing.rawJobs = [...jobs, rawJob].sort((a, b) => jobPriority(a) - jobPriority(b));
        existing.job = existing.rawJobs.map(translateJob).join(', ');
      }
    } else {
      const character = readString((value as Record<string, unknown>).character);
      const characters = existing.rawCharacters || [];
      if (character && !characters.includes(character)) {
        existing.rawCharacters = [...characters, character];
        existing.character = existing.rawCharacters.join(' / ');
      }
    }

    if (!existing.poster_path && item.poster_path) existing.poster_path = item.poster_path;
    if (!existing.vote_average && item.vote_average) existing.vote_average = item.vote_average;
  }

  return Array.from(credits.values()).sort((a, b) => {
    const dateA = Date.parse(a.release_date || a.first_air_date || '1900-01-01');
    const dateB = Date.parse(b.release_date || b.first_air_date || '1900-01-01');
    return dateB - dateA;
  });
}

export function isExplicitSelfAppearance(character: unknown): boolean {
  const normalized = readString(character)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
  return /^(?:self|himself|herself|themself|themselves)(?:\s*(?:[-–—:(]|as\b).*)?$/.test(normalized);
}

export function isSelfAppearanceCredit(credit: PersonCredit): boolean {
  const characters = (credit.rawCharacters?.length ? credit.rawCharacters : [credit.character])
    .map(readString)
    .filter(Boolean);
  return characters.length > 0 && characters.every(isExplicitSelfAppearance);
}

export function partitionPersonActingCredits(credits: readonly PersonCredit[]): PersonActingCredits {
  return credits.reduce<PersonActingCredits>((groups, credit) => {
    if (isSelfAppearanceCredit(credit)) groups.appearances.push(credit);
    else if (credit.media_type === 'tv') groups.series.push(credit);
    else groups.movies.push(credit);
    return groups;
  }, { movies: [], series: [], appearances: [] });
}

export function personCreditIdentity(credit: Pick<PersonCredit, 'id' | 'media_type'>): string {
  return `${credit.media_type}:${Number(credit.id)}`;
}

export function storedPersonShowIdentity(show: {
  tmdbId?: number | null;
  mediaType?: PersonCreditMediaType | null;
}): string | null {
  const tmdbId = Number(show.tmdbId);
  if (!Number.isFinite(tmdbId) || tmdbId <= 0) return null;
  return `${show.mediaType || 'tv'}:${tmdbId}`;
}

export function takeVisiblePersonCredits<T>(credits: readonly T[], limit: number): T[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : PERSON_FILMOGRAPHY_PAGE_SIZE;
  return credits.slice(0, safeLimit);
}
