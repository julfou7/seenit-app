export type DiscoverMediaType = 'tv' | 'movie';

export const DISCOVER_GENRE_MAP: Record<string, Record<DiscoverMediaType, number[]>> = {
  Action: { movie: [28], tv: [10759] },
  Aventure: { movie: [12], tv: [10759] },
  Animation: { movie: [16], tv: [16] },
  Biopic: { movie: [36, 99], tv: [99, 18] },
  'Comédie': { movie: [35], tv: [35] },
  Drame: { movie: [18], tv: [18] },
  Fantastique: { movie: [14], tv: [10765] },
  Horreur: { movie: [27], tv: [9648] },
  Romance: { movie: [10749], tv: [10766, 18] },
  'Sci-Fi': { movie: [878], tv: [10765] },
  Thriller: { movie: [53, 80], tv: [80, 9648] },
};

export const DISCOVER_PLATFORM_ID_MAP: Record<string, string> = {
  netflix: '8',
  hbo: '118',
  disney: '337',
  apple: '350',
  prime: '119',
  canal: '381',
  max: '1825',
};

export const SEARCH_COMPATIBLE_CATEGORIES = new Set(['Tout', 'Séries', 'Films', 'Personnes']);

export function resolveMediaType(item: any): DiscoverMediaType | null {
  if (!item || item.media_type === 'person') return null;
  if (item.media_type === 'movie' || Boolean(item.release_date)) return 'movie';
  if (item.media_type === 'tv' || item.media_type === 'series' || Boolean(item.first_air_date)) return 'tv';
  return null;
}

export function getGenreIdsForMediaType(genres: string[], mediaType: DiscoverMediaType): number[] {
  return Array.from(new Set(genres.flatMap(genre => DISCOVER_GENRE_MAP[genre]?.[mediaType] || [])));
}

/** Plusieurs genres sélectionnés forment un OU. Les autres familles de filtres
 * (plateforme, note, âge, type) se combinent ensuite en ET avec ce groupe. */
export function matchesSelectedGenres(item: any, genres: string[]): boolean {
  if (genres.length === 0) return true;
  const mediaType = resolveMediaType(item);
  if (!mediaType) return false;
  const allowed = getGenreIdsForMediaType(genres, mediaType);
  if (allowed.length === 0) return false;
  const itemGenreIds: number[] = Array.isArray(item.genre_ids)
    ? item.genre_ids.map(Number)
    : Array.isArray(item.genres)
      ? item.genres.map((genre: any) => Number(genre?.id)).filter(Number.isFinite)
      : [];
  return allowed.some(id => itemGenreIds.includes(id));
}

export function parseMinimumRating(value: string): number | null {
  if (!value || value === 'Toutes') return null;
  const parsed = Number.parseFloat(value.replace('+', ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function discoverTypeForCategory(category: string): 'tv' | 'movie' | 'all' {
  if (category === 'Séries') return 'tv';
  if (category === 'Films' || category === 'Au cinéma') return 'movie';
  return 'all';
}

export function isSearchCompatibleCategory(category: string): boolean {
  return SEARCH_COMPATIBLE_CATEGORIES.has(category);
}
