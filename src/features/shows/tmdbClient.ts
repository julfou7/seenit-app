import { type Result, ok, err, tryCatch } from '../../core/Result';
import { adjustTMDBShowDataForEurope, adjustTMDBSeasonDataForEurope } from '../../lib/utils';
import { authenticatedFetch } from '../../lib/apiAuth';
import { resolveSeenItApiUrl } from '../../lib/seenitApi';
import {
  BoundedCache,
  getManifestRelationSnapshot,
  mediaKeyFrom,
  relationMediaKeys,
  type MediaKey,
  type MediaRelationSnapshot,
  type RelationMediaType,
} from './mediaRelations';

export interface TMDBMedia {
  id: number;
  media_type?: string;
  name?: string;
  title?: string;
  original_name?: string;
  original_title?: string;
  first_air_date?: string;
  release_date?: string;
  poster_path: string | null;
  backdrop_path?: string | null;
  profile_path?: string | null;
  known_for_department?: string;
  character?: string;
  characterShow?: string;
  known_for?: any[];
  popularity?: number;
  vote_average?: number;
  vote_count?: number;
  genre_ids?: number[];
  overview?: string;
  adult?: boolean;
}

export interface SearchResponse {
  total_results?: number;
  total_pages?: number;
  total_tv?: number;
  total_movie?: number;
  results: TMDBMedia[];
}

export function isMovieAtCinema(media: any): boolean {
  if (!media) return false;
  const isTv = media.media_type === 'tv' || media.first_air_date !== undefined;
  if (isTv || isAdultOrParodyMedia(media)) return false;
  const dateStr = media.release_date || media.releaseDate || media.firstAirDate || media.first_air_date;
  if (!dateStr) return false;
  const releaseDate = new Date(dateStr);
  if (Number.isNaN(releaseDate.getTime())) return false;
  const now = new Date();
  const pastCutoff = new Date(now);
  pastCutoff.setDate(now.getDate() - 75);
  const futureCutoff = new Date(now);
  futureCutoff.setDate(now.getDate() + 10);
  return releaseDate >= pastCutoff && releaseDate <= futureCutoff;
}

export function isMovieUpcoming(media: any): boolean {
  if (!media) return false;
  const isTv = media.media_type === 'tv' || media.first_air_date !== undefined;
  if (isTv || isAdultOrParodyMedia(media)) return false;
  const dateStr = media.release_date || media.releaseDate || media.firstAirDate || media.first_air_date;
  if (!dateStr) return false;
  const releaseDate = new Date(dateStr);
  if (Number.isNaN(releaseDate.getTime())) return false;
  const futureCutoff = new Date();
  futureCutoff.setDate(futureCutoff.getDate() + 10);
  return releaseDate > futureCutoff;
}

export function isAdultOrParodyMedia(item: any): boolean {
  if (!item) return false;
  if (item.adult === true) return true;
  const title = (item.title || item.name || item.original_title || item.original_name || '').toLowerCase();
  const adultTerms = [
    'porn', 'porno', 'xxx', 'hentai', 'erotic', 'erotique', 'érotique',
    'x-rated', 'adult', 'parody', 'parodie', 'softcore', 'hardcore',
    'jedi hunter', 'cum join', 'sex parody', 'porno parody', 'adults only'
  ];
  if (adultTerms.some(term => title.includes(term))) return true;
  if (Array.isArray(item.genres)) {
    return item.genres.some((genre: any) => {
      const name = String(genre?.name || '').toLowerCase();
      return name.includes('erotic') || name.includes('érotique') || name.includes('adult') || name.includes('porno');
    });
  }
  return false;
}

const filterCredibleMedia = (results: TMDBMedia[], minVoteCount: number = 50): TMDBMedia[] => {
  if (!Array.isArray(results)) return [];
  return results.filter((item: any) => {
    if (!item || isAdultOrParodyMedia(item)) return false;
    if (item.media_type === 'person' || item.known_for_department) return true;
    return (typeof item.vote_count === 'number' ? item.vote_count : 0) >= minVoteCount;
  });
};

const PLATFORM_ID_MAP: Record<string, string> = {
  netflix: '8',
  hbo: '118',
  disney: '337',
  apple: '350',
  prime: '119',
  canal: '381',
  max: '1825',
};

const GENRE_MAP: Record<string, { movie: number[]; tv: number[] }> = {
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

function addWatchProviders(params: URLSearchParams, providers?: string[]): boolean {
  if (!providers?.length) return false;
  const ids = providers.map(provider => PLATFORM_ID_MAP[provider]).filter(Boolean);
  if (!ids.length) return false;
  params.set('watch_region', 'FR');
  params.set('with_watch_providers', ids.join('|'));
  return true;
}

/**
 * Client TMDB SeenIt. Les secrets fournisseurs ne sont jamais présents dans ce module :
 * tous les appels passent par la façade authentifiée `/api/media/tmdb/*`, qui injecte
 * la clé TMDB exclusivement côté backend.
 */
export class TMDBClient {
  private readonly baseUrl = resolveSeenItApiUrl('/api/media/tmdb');
  private lastRequestTime = 0;
  private readonly MIN_MS_BETWEEN_REQUESTS = 250;
  private detailsCache = new BoundedCache<string, any>(80);
  private detailsInFlight = new Map<string, Promise<Result<any>>>();
  private relationCache = new BoundedCache<MediaKey, MediaRelationSnapshot>(120);
  private collectionCache = new BoundedCache<number, any>(40);
  private collectionInFlight = new Map<number, Promise<Result<any>>>();
  private watchProvidersCache = new BoundedCache<string, { data: any; timestamp: number }>(80);
  private episodeDetailsCache = new Map<string, { data: any; timestamp: number }>();

  private buildUrl(path: string, params: Record<string, string | number | undefined> = {}): string {
    const base = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') searchParams.set(key, String(value));
    }
    const query = searchParams.toString();
    return query ? `${base}?${query}` : base;
  }

  private async fetchJson<T = any>(url: string, init: RequestInit = {}): Promise<Result<T>> {
    const response = await tryCatch(authenticatedFetch(url, init));
    if (!response.ok) return err((response as any).error);
    if (!response.value.ok) return err(new Error(`TMDB Error: ${response.value.status}`));
    const data = await tryCatch(response.value.json() as Promise<T>);
    if (!data.ok) return err((data as any).error);
    if ((data.value as any)?.status_code) {
      return err(new Error((data.value as any).status_message || 'TMDB Error'));
    }
    return data;
  }

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestTime;
    if (elapsed < this.MIN_MS_BETWEEN_REQUESTS) {
      await new Promise(resolve => setTimeout(resolve, this.MIN_MS_BETWEEN_REQUESTS - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  async searchMedia(query: string, year?: string, type?: 'movie' | 'tv', page: number = 1): Promise<Result<TMDBMedia>> {
    await this.throttle();
    const endpoint = type === 'movie' ? '/search/movie' : type === 'tv' ? '/search/tv' : '/search/multi';
    const fetchResultsForYear = async (searchYear?: string): Promise<TMDBMedia[]> => {
      const params: Record<string, string | number | undefined> = {
        query,
        language: 'fr-FR',
        page,
      };
      if (searchYear) {
        if (type === 'movie') params.year = searchYear;
        else if (type === 'tv') params.first_air_date_year = searchYear;
      }
      const result = await this.fetchJson<SearchResponse>(this.buildUrl(endpoint, params));
      return result.ok ? result.value.results || [] : [];
    };

    let rawResults = await fetchResultsForYear(year);
    if (!rawResults.length && year) rawResults = await fetchResultsForYear();
    rawResults = rawResults.filter(item => !isAdultOrParodyMedia(item));
    if (!rawResults.length) return err(new Error('Media not found'));

    const normalize = (value?: string) => (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const removeArticles = (value: string) => value.replace(/^(le|la|les|l|un|une|des|the|a|an)\s+/i, '').trim();
    const target = normalize(query);
    const targetNoArticle = removeArticles(target);
    const targetYear = year ? Number(year) : undefined;

    let best = rawResults[0];
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const candidate of rawResults) {
      const title = normalize(candidate.title || candidate.name);
      const original = normalize(candidate.original_title || candidate.original_name);
      const titleNoArticle = removeArticles(title);
      const originalNoArticle = removeArticles(original);
      let score = 0;
      if ([title, original, titleNoArticle, originalNoArticle].includes(target) || [titleNoArticle, originalNoArticle].includes(targetNoArticle)) score += 150;
      else if (title.includes(target) || original.includes(target) || target.includes(title) || target.includes(original)) score += 60;
      const candidateYear = Number((candidate.release_date || candidate.first_air_date || '').slice(0, 4));
      if (targetYear && candidateYear) score += type === 'tv' && candidateYear <= targetYear ? Math.max(0, 100 - (targetYear - candidateYear) * 6) : Math.max(0, 100 - Math.abs(targetYear - candidateYear) * 30);
      score += Math.min(50, Math.log10((candidate.popularity || 0) + 1) * 10);
      score += Math.min(30, Math.log10((candidate.vote_count || 0) + 1) * 6);
      if (score > bestScore) { best = candidate; bestScore = score; }
    }
    return ok(best);
  }

  async findByExternalId(
    externalId: string,
    externalSource: 'imdb_id' | 'tvdb_id' | 'freebase_mid' | 'freebase_id' | 'tvrage_id',
    type?: 'movie' | 'tv'
  ): Promise<Result<TMDBMedia>> {
    await this.throttle();
    const result = await this.fetchJson<any>(this.buildUrl(`/find/${encodeURIComponent(externalId.trim())}`, {
      external_source: externalSource,
      language: 'fr-FR',
    }));
    if (!result.ok) return result as Result<TMDBMedia>;
    const movieResults: TMDBMedia[] = result.value?.movie_results || [];
    const tvResults: TMDBMedia[] = result.value?.tv_results || [];
    if (type === 'movie' && movieResults[0]) return ok({ ...movieResults[0], media_type: 'movie' });
    if (type === 'tv' && tvResults[0]) return ok({ ...tvResults[0], media_type: 'tv' });
    if (movieResults[0]) return ok({ ...movieResults[0], media_type: 'movie' });
    if (tvResults[0]) return ok({ ...tvResults[0], media_type: 'tv' });
    return err(new Error(`No media found on TMDB for external ID ${externalId}`));
  }

  peekMediaDetails(id: number, type: RelationMediaType = 'tv'): any | null {
    return this.detailsCache.get(`${type}_${Number(id)}`) || null;
  }

  private async getCachedMediaDetails(id: number, type: RelationMediaType): Promise<Result<any>> {
    const cacheKey = `${type}_${Number(id)}`;
    const cached = this.detailsCache.get(cacheKey);
    if (cached) return ok(cached);
    const inFlight = this.detailsInFlight.get(cacheKey);
    if (inFlight) return inFlight;

    const request = (async (): Promise<Result<any>> => {
      const appended = type === 'tv'
        ? 'credits,aggregate_credits,similar,recommendations,videos,content_ratings,external_ids,images,keywords'
        : 'credits,similar,recommendations,videos,release_dates,external_ids,images,keywords';
      const result = await this.fetchJson<any>(this.buildUrl(`/${type}/${id}`, {
        language: 'fr-FR',
        append_to_response: appended,
        include_video_language: 'fr,en,null',
        include_image_language: 'fr,en,null,de,es,it,ja,ko',
      }));
      if (!result.ok) return result;
      const value = result.value;
      if (value) {
        value.media_type = type;
        if (value.similar?.results) value.similar.results = value.similar.results.filter((item: any) => !isAdultOrParodyMedia(item));
        if (value.recommendations?.results) value.recommendations.results = value.recommendations.results.filter((item: any) => !isAdultOrParodyMedia(item));
        if (type === 'tv') adjustTMDBShowDataForEurope(value);
        this.detailsCache.set(cacheKey, value);
      }
      return ok(value);
    })();

    this.detailsInFlight.set(cacheKey, request);
    try { return await request; } finally { this.detailsInFlight.delete(cacheKey); }
  }

  async getShowDetails(id: number): Promise<Result<any>> { return this.getCachedMediaDetails(id, 'tv'); }
  async getMovieDetails(id: number): Promise<Result<any>> { return this.getCachedMediaDetails(id, 'movie'); }
  async getMediaDetails(id: number, type: 'tv' | 'movie' = 'tv'): Promise<Result<any>> {
    return type === 'movie' ? this.getMovieDetails(id) : this.getShowDetails(id);
  }

  peekUniverseAndCollection(media: any): MediaRelationSnapshot | null {
    const mediaKey = mediaKeyFrom(media);
    if (!mediaKey) return null;
    return this.relationCache.get(mediaKey) || getManifestRelationSnapshot(mediaKey);
  }

  async getUniverseAndCollection(media: any): Promise<MediaRelationSnapshot> {
    const mediaKey = mediaKeyFrom(media);
    if (!mediaKey) return { collection: [], universe: [] };
    const cached = this.relationCache.get(mediaKey);
    if (cached) return cached;
    const manifest = getManifestRelationSnapshot(mediaKey);
    let collection = manifest?.collection || [];
    let universe = manifest?.universe || [];
    const mediaType = mediaKey.split(':')[0] as RelationMediaType;
    if (!collection.length && mediaType === 'movie' && media.belongs_to_collection?.id) {
      const collectionResult = await this.getCollectionDetails(Number(media.belongs_to_collection.id));
      if (collectionResult.ok && Array.isArray(collectionResult.value?.parts)) {
        const parts = collectionResult.value.parts
          .filter((part: any) => (part.release_date || part.first_air_date) && !isAdultOrParodyMedia(part))
          .map((part: any) => ({ ...part, media_type: 'movie' as const }))
          .sort((a: any, b: any) => String(a.release_date || '').localeCompare(String(b.release_date || '')));
        if (parts.length > 1) collection = parts.map((part: any, index: number) => ({ ...part, sagaOrder: index + 1 }));
      }
    }
    const collectionKeys = relationMediaKeys(collection, 'movie');
    universe = universe.filter(item => {
      const key = mediaKeyFrom(item);
      return key !== null && !collectionKeys.has(key);
    });
    if (collection.length === 1 && mediaKeyFrom(collection[0]) === mediaKey) collection = [];
    if (universe.length === 1 && mediaKeyFrom(universe[0]) === mediaKey) universe = [];
    const snapshot = { collection, universe };
    this.relationCache.set(mediaKey, snapshot);
    return snapshot;
  }

  async getCollectionDetails(collectionId: number): Promise<Result<any>> {
    const normalizedId = Number(collectionId);
    const cached = this.collectionCache.get(normalizedId);
    if (cached) return ok(cached);
    const inFlight = this.collectionInFlight.get(normalizedId);
    if (inFlight) return inFlight;
    const request = (async () => {
      const result = await this.fetchJson<any>(this.buildUrl(`/collection/${normalizedId}`, { language: 'fr-FR' }), {
        signal: AbortSignal.timeout(4000),
      });
      if (result.ok && result.value) this.collectionCache.set(normalizedId, result.value);
      return result;
    })();
    this.collectionInFlight.set(normalizedId, request);
    try { return await request; } finally { this.collectionInFlight.delete(normalizedId); }
  }

  peekWatchProviders(id: number, type: 'tv' | 'movie' = 'tv'): any | null {
    const cached = this.watchProvidersCache.get(`${type}:${Number(id)}`);
    if (!cached || Date.now() - cached.timestamp >= 30 * 60 * 1000) return null;
    return cached.data;
  }

  async getWatchProviders(id: number, type: 'tv' | 'movie' = 'tv'): Promise<Result<any>> {
    const cacheKey = `${type}:${id}`;
    const cached = this.watchProvidersCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 30 * 60 * 1000) return ok(cached.data);
    const result = await this.fetchJson<any>(this.buildUrl(`/${type}/${id}/watch/providers`));
    if (result.ok) this.watchProvidersCache.set(cacheKey, { data: result.value, timestamp: Date.now() });
    return result;
  }

  async getMediaKeywords(id: number, type: 'tv' | 'movie' = 'tv'): Promise<Result<string[]>> {
    const result = await this.fetchJson<any>(this.buildUrl(`/${type}/${id}/keywords`));
    if (!result.ok) return result as Result<string[]>;
    const list = type === 'tv' ? result.value?.results : result.value?.keywords;
    return ok((list || []).map((item: { name: string }) => item.name));
  }

  async getSeasonDetails(id: number, seasonNumber: number): Promise<Result<any>> {
    const result = await this.fetchJson<any>(this.buildUrl(`/tv/${id}/season/${seasonNumber}`, {
      language: 'fr-FR',
      append_to_response: 'videos',
      include_video_language: 'fr,en,null',
    }));
    if (result.ok && result.value) {
      const tvDetails = this.detailsCache.get(`tv_${id}`);
      adjustTMDBSeasonDataForEurope(result.value, tvDetails?.networks);
    }
    return result;
  }

  async getEpisodeDetails(id: number, seasonNumber: number, episodeNumber: number): Promise<Result<any>> {
    const cacheKey = `${id}:${seasonNumber}:${episodeNumber}`;
    const cached = this.episodeDetailsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 30 * 60 * 1000) return ok(cached.data);
    const result = await this.fetchJson<any>(this.buildUrl(`/tv/${id}/season/${seasonNumber}/episode/${episodeNumber}`, {
      language: 'fr-FR',
      append_to_response: 'videos',
      include_video_language: 'fr,en,null',
    }));
    if (result.ok && result.value) {
      const tvDetails = this.detailsCache.get(`tv_${id}`);
      adjustTMDBSeasonDataForEurope({ episodes: [result.value] }, tvDetails?.networks);
      this.episodeDetailsCache.set(cacheKey, { data: result.value, timestamp: Date.now() });
    }
    return result;
  }

  private async searchEndpoint(endpoint: string, mediaType: 'tv' | 'movie' | 'person' | null, query: string, page: number): Promise<Result<SearchResponse>> {
    const result = await this.fetchJson<SearchResponse>(this.buildUrl(endpoint, { query, language: 'fr-FR', page }));
    if (!result.ok) return result;
    const results = Array.isArray(result.value.results) ? result.value.results : [];
    result.value.results = mediaType === 'person'
      ? results.map(item => ({ ...item, media_type: 'person' }))
      : filterCredibleMedia(results, 0).map(item => mediaType ? ({ ...item, media_type: mediaType }) : item);
    return result;
  }

  async searchMulti(query: string, page: number = 1, _watchProviders?: string[]): Promise<Result<SearchResponse>> {
    return this.searchEndpoint('/search/multi', null, query, page);
  }
  async searchTV(query: string, page: number = 1, _watchProviders?: string[]): Promise<Result<SearchResponse>> {
    return this.searchEndpoint('/search/tv', 'tv', query, page);
  }
  async searchMovie(query: string, page: number = 1, _watchProviders?: string[]): Promise<Result<SearchResponse>> {
    return this.searchEndpoint('/search/movie', 'movie', query, page);
  }
  async searchPerson(query: string, page: number = 1): Promise<Result<SearchResponse>> {
    return this.searchEndpoint('/search/person', 'person', query, page);
  }

  async searchCharacterFallback(query: string, cleaned: string): Promise<{ extraMedia: TMDBMedia[]; extraPersons: TMDBMedia[] }> {
    const extraMedia: TMDBMedia[] = [];
    const extraPersons: TMDBMedia[] = [];
    const base = await this.searchMulti(query, 1);
    if (!base.ok) return { extraMedia, extraPersons };
    const words = cleaned.split(' ').filter(word => word.length >= 3);
    const candidates = (base.value.results || []).filter(item => item.media_type === 'tv' || item.media_type === 'movie').slice(0, 5);
    const details = await Promise.all(candidates.map(item => item.media_type === 'movie'
      ? this.getMovieDetails(item.id)
      : this.getShowDetails(item.id)));
    const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    for (const detail of details) {
      if (!detail.ok || !detail.value) continue;
      const mediaDetails = detail.value;
      extraMedia.push(mediaDetails);
      const cast = mediaDetails.aggregate_credits?.cast || mediaDetails.credits?.cast || [];
      for (const member of cast) {
        const character = String(member.character || member.roles?.[0]?.character || '');
        const normalizedCharacter = normalize(character);
        if (character && (normalizedCharacter.includes(cleaned) || words.some(word => normalizedCharacter.includes(word)))) {
          extraPersons.push({
            id: member.id,
            media_type: 'person',
            name: member.name,
            profile_path: member.profile_path,
            poster_path: null,
            known_for_department: 'Acting',
            character,
            characterShow: mediaDetails.name || mediaDetails.title || '',
            popularity: (member.popularity || 10) + 150,
            known_for: [mediaDetails],
          });
        }
      }
    }
    return { extraMedia, extraPersons };
  }

  async smartSearchMulti(query: string, page: number = 1, watchProviders?: string[]): Promise<Result<SearchResponse>> {
    if (!query?.trim()) return ok({ results: [] });
    const result = await this.searchMulti(query, page, watchProviders);
    if (!result.ok) return result;
    return ok({ ...result.value, results: filterCredibleMedia(result.value.results || [], 0) });
  }

  async getTopRated(type: 'tv' | 'movie', page: number = 1): Promise<Result<SearchResponse>> {
    return this.discover(type, page, { sort_by: 'vote_average.desc', 'vote_count.gte': '3000' }, 0);
  }

  async getTopRatedRecent(type: 'tv' | 'movie' | 'all', page: number = 1, watchProviders?: string[]): Promise<Result<SearchResponse>> {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const date = oneYearAgo.toISOString().split('T')[0];
    const fetchType = (mediaType: 'tv' | 'movie') => this.discover(mediaType, page, {
      sort_by: 'vote_average.desc',
      'vote_count.gte': watchProviders?.length ? '5' : '100',
      'vote_average.gte': '7.0',
      [mediaType === 'tv' ? 'first_air_date.gte' : 'primary_release_date.gte']: date,
    }, watchProviders?.length ? 5 : 50, watchProviders);
    if (type !== 'all') return fetchType(type);
    const [tv, movie] = await Promise.all([fetchType('tv'), fetchType('movie')]);
    if (tv.ok && movie.ok) return ok({ results: [...tv.value.results, ...movie.value.results].sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0)) });
    return tv.ok ? tv : movie;
  }

  async getTrending(type: 'tv' | 'movie' | 'all' = 'tv', page: number = 1, watchProviders?: string[]): Promise<Result<SearchResponse>> {
    if (watchProviders?.length) {
      if (type === 'all') {
        const [tv, movie] = await Promise.all([
          this.discover('tv', page, { sort_by: 'popularity.desc' }, 5, watchProviders),
          this.discover('movie', page, { sort_by: 'popularity.desc' }, 5, watchProviders),
        ]);
        if (tv.ok && movie.ok) return ok({ results: [...tv.value.results, ...movie.value.results].sort((a, b) => (b.popularity || 0) - (a.popularity || 0)) });
        return tv.ok ? tv : movie;
      }
      return this.discover(type, page, { sort_by: 'popularity.desc' }, 5, watchProviders);
    }
    const result = await this.fetchJson<SearchResponse>(this.buildUrl(`/trending/${type}/week`, { language: 'fr-FR', page }));
    if (result.ok && Array.isArray(result.value.results)) result.value.results = filterCredibleMedia(result.value.results, 50);
    return result;
  }

  async discoverByGenre(type: 'tv' | 'movie', genreId: number, page: number = 1, watchProviders?: string[]): Promise<Result<SearchResponse>> {
    return this.discover(type, page, { with_genres: String(genreId) }, watchProviders?.length ? 5 : 50, watchProviders);
  }

  async getPopular(type: 'tv' | 'movie' = 'tv', page: number = 1, watchProviders?: string[]): Promise<Result<SearchResponse>> {
    const extra: Record<string, string> = { sort_by: 'popularity.desc' };
    if (!watchProviders?.length) extra[type === 'tv' ? 'first_air_date.gte' : 'primary_release_date.gte'] = '2016-01-01';
    return this.discover(type, page, extra, watchProviders?.length ? 5 : 50, watchProviders);
  }

  async getPopularPersons(page: number = 1): Promise<Result<SearchResponse>> {
    const result = await this.fetchJson<SearchResponse>(this.buildUrl('/person/popular', { language: 'fr-FR', page }));
    if (result.ok && Array.isArray(result.value.results)) result.value.results = result.value.results.map(item => ({ ...item, media_type: 'person' }));
    return result;
  }

  async getNowPlaying(page: number = 1): Promise<Result<SearchResponse>> {
    const now = new Date();
    const past = new Date(now); past.setDate(now.getDate() - 75);
    const future = new Date(now); future.setDate(now.getDate() + 10);
    const result = await this.discover('movie', page, {
      sort_by: 'popularity.desc',
      'primary_release_date.gte': past.toISOString().split('T')[0],
      'primary_release_date.lte': future.toISOString().split('T')[0],
      region: 'FR',
    }, 5);
    if (result.ok) result.value.results = result.value.results.filter(isMovieAtCinema);
    return result;
  }

  async discoverWithFilters(options: {
    type?: 'tv' | 'movie' | 'all';
    page?: number;
    watchProviders?: string[];
    genres?: string[];
    pegi?: string;
    minRating?: string;
    sortBy?: 'popular' | 'rating' | 'date' | 'title' | 'top100';
    sortOrder?: 'asc' | 'desc';
  }): Promise<Result<SearchResponse>> {
    const {
      type = 'all', page = 1, watchProviders = [], genres = [], pegi = 'Tous',
      minRating = 'Toutes', sortBy = 'popular', sortOrder = 'desc'
    } = options;

    const buildExtra = (mediaType: 'tv' | 'movie') => {
      const extra: Record<string, string> = {};
      if (sortBy === 'rating' || sortBy === 'top100') extra.sort_by = `vote_average.${sortOrder}`;
      else if (sortBy === 'date') extra.sort_by = `${mediaType === 'tv' ? 'first_air_date' : 'primary_release_date'}.${sortOrder}`;
      else if (sortBy === 'title') extra.sort_by = `${mediaType === 'tv' ? 'name' : 'title'}.${sortOrder}`;
      else extra.sort_by = `popularity.${sortOrder}`;
      if (genres.length) {
        const ids = Array.from(new Set(genres.flatMap(genre => GENRE_MAP[genre]?.[mediaType] || [])));
        if (ids.length) extra.with_genres = ids.join('|');
      }
      if (minRating !== 'Toutes') {
        const value = Number(minRating.replace('+', ''));
        if (Number.isFinite(value)) extra['vote_average.gte'] = String(value);
      }
      // Compatibilité des anciens tokens : la politique parentale canonique dans tmdb.ts
      // neutralise ce filtre puis hydrate les vraies classifications.
      if (pegi === '16' || pegi === '-16' || pegi === '16+') {
        extra.without_genres = '10762,10751';
        extra.certification_country = 'US';
        extra.certification = mediaType === 'movie' ? 'R' : 'TV-MA';
      } else if (pegi === '12' || pegi === '-12' || pegi === '12+') {
        extra.without_genres = '27';
        extra.certification_country = 'US';
        extra.certification = mediaType === 'movie' ? 'PG-13' : 'TV-14';
      }
      return extra;
    };

    const fetchType = (mediaType: 'tv' | 'movie') => this.discover(
      mediaType,
      page,
      buildExtra(mediaType),
      watchProviders.length ? 5 : sortBy === 'rating' ? 100 : 20,
      watchProviders,
    );
    if (type !== 'all') return fetchType(type);
    const [tv, movie] = await Promise.all([fetchType('tv'), fetchType('movie')]);
    if (!tv.ok) return tv;
    if (!movie.ok) return movie;
    const results = [...tv.value.results, ...movie.value.results];
    if (sortBy === 'rating' || sortBy === 'top100') results.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
    else if (sortBy === 'date') results.sort((a, b) => String(b.first_air_date || b.release_date || '').localeCompare(String(a.first_air_date || a.release_date || '')));
    else results.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    return ok({ results });
  }

  async getPersonDetails(personId: number): Promise<Result<any>> {
    return this.fetchJson<any>(this.buildUrl(`/person/${personId}`, { language: 'fr-FR' }));
  }

  async getPersonCredits(personId: number): Promise<Result<any>> {
    return this.fetchJson<any>(this.buildUrl(`/person/${personId}/combined_credits`, { language: 'fr-FR' }));
  }

  private async discover(
    type: 'tv' | 'movie',
    page: number,
    extra: Record<string, string>,
    minVotes: number,
    watchProviders?: string[],
  ): Promise<Result<SearchResponse>> {
    const params = new URLSearchParams();
    params.set('language', 'fr-FR');
    params.set('page', String(page));
    params.set('vote_count.gte', extra['vote_count.gte'] || String(minVotes));
    Object.entries(extra).forEach(([key, value]) => params.set(key, value));
    addWatchProviders(params, watchProviders);
    const result = await this.fetchJson<SearchResponse>(
      `${this.baseUrl}/discover/${type}?${params.toString()}`
    );
    if (result.ok && Array.isArray(result.value.results)) {
      result.value.results = filterCredibleMedia(result.value.results.map(item => ({ ...item, media_type: type })), minVotes);
    }
    return result;
  }
}

export const tmdb = new TMDBClient();
