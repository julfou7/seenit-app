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
  if (isTv) return false;
  if (isAdultOrParodyMedia(media)) return false;

  const dateStr = media.release_date || media.releaseDate || media.firstAirDate || media.first_air_date;
  if (!dateStr) return false;

  const releaseDate = new Date(dateStr);
  if (isNaN(releaseDate.getTime())) return false;

  const now = new Date();
  const pastCutoff = new Date();
  pastCutoff.setDate(now.getDate() - 75);
  const futureCutoff = new Date();
  futureCutoff.setDate(now.getDate() + 10);
  return releaseDate >= pastCutoff && releaseDate <= futureCutoff;
}

export function isMovieUpcoming(media: any): boolean {
  if (!media) return false;
  const isTv = media.media_type === 'tv' || media.first_air_date !== undefined;
  if (isTv) return false;
  if (isAdultOrParodyMedia(media)) return false;

  const dateStr = media.release_date || media.releaseDate || media.firstAirDate || media.first_air_date;
  if (!dateStr) return false;

  const releaseDate = new Date(dateStr);
  if (isNaN(releaseDate.getTime())) return false;

  const futureCutoff = new Date();
  futureCutoff.setDate(new Date().getDate() + 10);
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
    if (item.genres.some((g: any) => {
      const gName = (g.name || '').toLowerCase();
      return gName.includes('erotic') || gName.includes('érotique') || gName.includes('adult') || gName.includes('porno');
    })) return true;
  }
  return false;
}

const filterCredibleMedia = (results: TMDBMedia[], minVoteCount: number = 50): TMDBMedia[] => {
  if (!Array.isArray(results)) return [];
  return results.filter((item: any) => {
    if (!item) return false;
    if (isAdultOrParodyMedia(item)) return false;
    if (item.media_type === 'person' || item.known_for_department) return true;
    const count = typeof item.vote_count === 'number' ? item.vote_count : 0;
    return count >= minVoteCount;
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
 * tous les appels TMDB passent par la façade authentifiée `/api/media/tmdb/*`, qui injecte
 * la clé fournisseur exclusivement côté backend. Les fallbacks Wikipedia/Wikidata restent
 * des sources publiques sans secret et conservent le comportement historique de recherche.
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
    const endpoint = type === 'movie' ? '/search/movie' : (type === 'tv' ? '/search/tv' : '/search/multi');

    const fetchResultsForYear = async (searchYear?: string): Promise<TMDBMedia[]> => {
      const params: Record<string, string | number | undefined> = {
        query,
        language: 'fr-FR',
        page,
      };
      // Conserver le comportement historique : ne jamais imposer first_air_date_year aux séries.
      if (searchYear && type === 'movie') params.primary_release_year = searchYear;
      const result = await this.fetchJson<SearchResponse>(this.buildUrl(endpoint, params));
      return result.ok ? result.value.results || [] : [];
    };

    let rawResults = await fetchResultsForYear(year);
    if (rawResults.length === 0 && year) rawResults = await fetchResultsForYear(undefined);
    if (rawResults.length === 0) return err(new Error('Media not found'));

    const normalize = (t?: string) =>
      (t || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const removeArticles = (t: string) => t.replace(/^(le|la|les|l|un|une|des|the|a|an)\s+/i, '').trim();

    const targetNorm = normalize(query);
    const targetNoArticle = removeArticles(targetNorm);
    const targetYearNum = year ? parseInt(year, 10) : undefined;
    const targetTokens = targetNorm.split(' ').filter(w => w.length >= 2);

    let bestCandidate: TMDBMedia = rawResults[0];
    let bestScore = -99999;

    for (const candidate of rawResults) {
      if (isAdultOrParodyMedia(candidate)) continue;

      let score = 0;
      const candTitle = normalize(candidate.title || candidate.name);
      const candOriginal = normalize(candidate.original_title || candidate.original_name);
      const candTitleNoArticle = removeArticles(candTitle);
      const candOriginalNoArticle = removeArticles(candOriginal);
      const candDate = candidate.release_date || candidate.first_air_date || '';
      const candYear = candDate ? parseInt(candDate.slice(0, 4), 10) : undefined;
      const pop = candidate.popularity || 0;
      const votes = candidate.vote_count || 0;

      if (
        candTitle === targetNorm ||
        candOriginal === targetNorm ||
        candTitleNoArticle === targetNoArticle ||
        candOriginalNoArticle === targetNoArticle
      ) {
        score += 150;
      } else if (
        candTitle.startsWith(targetNorm) ||
        candOriginal.startsWith(targetNorm) ||
        targetNorm.startsWith(candTitle) ||
        targetNorm.startsWith(candOriginal) ||
        candTitleNoArticle.startsWith(targetNoArticle) ||
        candOriginalNoArticle.startsWith(targetNoArticle)
      ) {
        score += 90;
      } else if (
        candTitle.includes(targetNorm) ||
        candOriginal.includes(targetNorm) ||
        targetNorm.includes(candTitle) ||
        targetNorm.includes(candOriginal)
      ) {
        score += 60;
      } else if (targetTokens.length > 0) {
        const candTokens = `${candTitle} ${candOriginal}`.split(' ');
        const matchedTokens = targetTokens.filter(t => candTokens.includes(t));
        const tokenRatio = matchedTokens.length / targetTokens.length;
        if (tokenRatio >= 0.5) score += Math.round(tokenRatio * 50);
      }

      if (targetYearNum && candYear && !isNaN(targetYearNum) && !isNaN(candYear)) {
        if (type === 'tv') {
          if (candYear <= targetYearNum) {
            const diff = targetYearNum - candYear;
            if (diff === 0) score += 100;
            else if (diff <= 10) score += 40;
          } else {
            const diff = candYear - targetYearNum;
            if (diff <= 1) score += 20;
            else score -= 30;
          }
        } else {
          const diff = Math.abs(candYear - targetYearNum);
          if (diff === 0) score += 120;
          else if (diff === 1) score += 70;
          else if (diff <= 3) score += 30;
          else score -= 30;
        }
      }

      score += Math.min(Math.log10(votes + 1) * 10, 40);
      score += Math.min(pop * 0.3, 15);

      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }
    return ok(bestCandidate);
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
    try {
      return await request;
    } finally {
      this.detailsInFlight.delete(cacheKey);
    }
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

    const request = (async (): Promise<Result<any>> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      try {
        const result = await this.fetchJson<any>(this.buildUrl(`/collection/${normalizedId}`, { language: 'fr-FR' }), {
          signal: controller.signal,
        });
        if (result.ok && result.value) this.collectionCache.set(normalizedId, result.value);
        return result;
      } finally {
        clearTimeout(timeout);
      }
    })();

    this.collectionInFlight.set(normalizedId, request);
    try {
      return await request;
    } finally {
      this.collectionInFlight.delete(normalizedId);
    }
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

    const cleanStr = (str: string) =>
      str.normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/['’\-_]/g, ' ')
        .toLowerCase()
        .trim();

    const foundTvIds = new Set<number>();
    const foundMovieIds = new Set<number>();
    const foundPersonIds = new Set<number>();
    const showNamesToQuery = new Set<string>();

    // Les recherches Wikipedia/Wikidata sont des fallbacks publics sans secret fournisseur.
    try {
      const wikiUrls = [
        `https://fr.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`,
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`,
        `https://fr.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query + ' série film')}&format=json&origin=*`,
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query + ' TV series movie')}&format=json&origin=*`
      ];
      const wikiResponses = await Promise.all(wikiUrls.map(u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null)));

      for (const data of wikiResponses) {
        if (!data?.query?.search) continue;
        for (const item of data.query.search) {
          const title = item.title || '';
          const snippet = item.snippet || '';
          const titleShowMatch = title.match(/\(([^)]+)\)/);
          if (titleShowMatch) {
            const insideParens = titleShowMatch[1].replace(/série télévisée|film|TV series|character|personnage/gi, '').trim();
            if (insideParens.length >= 2) showNamesToQuery.add(insideParens);
          }

          const cleanTitle = title.replace(/\([^)]+\)/g, '').trim();
          if (cleanTitle.length >= 3 && cleanStr(cleanTitle) !== cleaned) showNamesToQuery.add(cleanTitle);

          const snippetText = snippet.replace(/<[^>]+>/g, '');
          const showMatches = snippetText.match(/(?:série|film|series|movie|show|drama)\s+(?:télévisée\s+)?(?:intitulée\s+|nommée\s+|de\s+|in\s+)?([A-ZÉÈÀÙA-Za-z0-9\s'’-]{2,30})/gi);
          if (showMatches) {
            showMatches.forEach((match: string) => {
              const cleanedName = match.replace(/série|film|series|movie|show|drama|télévisée|intitulée|nommée|de|in/gi, '').trim();
              if (cleanedName.length >= 3) showNamesToQuery.add(cleanedName);
            });
          }
        }
      }
    } catch (error) {
      console.error('Wikipedia fallback error:', error);
    }

    try {
      const sparqlQuery = `
        SELECT DISTINCT ?work ?tmdbTv ?tmdbMovie ?actor ?tmdbPerson ?workLabel WHERE {
          SERVICE wikibase:mwapi {
            bd:serviceParam wikibase:endpoint "www.wikidata.org";
                            wikibase:api "EntitySearch";
                            mwapi:search "${query.replace(/"/g, '')}";
                            mwapi:language "en".
            ?item wikibase:apiOutputItem ?item.
          }
          {
            ?item wdt:P1441 ?work .
            OPTIONAL { ?item wdt:P175 ?actor . }
          } UNION {
            ?work wdt:P674 ?item .
            OPTIONAL { ?item wdt:P175 ?actor . }
          } UNION {
            ?item wdt:P175 ?actor .
            OPTIONAL { ?item wdt:P1441 ?work . }
          } UNION {
            BIND(?item AS ?work)
          }
          OPTIONAL { ?work wdt:P4983 ?tmdbTv . }
          OPTIONAL { ?work wdt:P4947 ?tmdbMovie . }
          OPTIONAL { ?actor wdt:P3987 ?tmdbPerson . }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
        } LIMIT 10
      `;
      const sparqlUrl = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparqlQuery)}&format=json`;
      const response = await fetch(sparqlUrl, {
        headers: { Accept: 'application/json', 'User-Agent': 'SeriesApp/1.0' }
      });
      if (response.ok) {
        const data = await response.json();
        data?.results?.bindings?.forEach((row: any) => {
          if (row.tmdbTv?.value) foundTvIds.add(parseInt(row.tmdbTv.value, 10));
          if (row.tmdbMovie?.value) foundMovieIds.add(parseInt(row.tmdbMovie.value, 10));
          if (row.tmdbPerson?.value) foundPersonIds.add(parseInt(row.tmdbPerson.value, 10));
          if (row.workLabel?.value) {
            const label = row.workLabel.value.trim();
            if (label.length >= 3 && !label.startsWith('Q')) showNamesToQuery.add(label);
          }
        });
      }
    } catch (error) {
      console.error('Wikidata SPARQL character fallback error:', error);
    }

    const showNamesList = Array.from(showNamesToQuery).slice(0, 3);
    const searchResults = await Promise.all(showNamesList.map(name => this.searchMulti(name, 1)));
    for (const result of searchResults) {
      if (!result.ok || !result.value?.results) continue;
      for (const item of result.value.results) {
        if (item.media_type === 'tv' || item.first_air_date) foundTvIds.add(item.id);
        else if (item.media_type === 'movie' || item.release_date) foundMovieIds.add(item.id);
        else if (item.media_type === 'person') foundPersonIds.add(item.id);
      }
    }

    const tvIdsList = Array.from(foundTvIds).slice(0, 3);
    const movieIdsList = Array.from(foundMovieIds).slice(0, 3);
    const detailsList = await Promise.all([
      ...tvIdsList.map(id => this.getShowDetails(id).then(result => result.ok ? { ...result.value, media_type: 'tv' as const } : null)),
      ...movieIdsList.map(id => this.getMovieDetails(id).then(result => result.ok ? { ...result.value, media_type: 'movie' as const } : null))
    ]);

    const queryWords = cleaned.split(' ').filter(word => word.length >= 3);
    for (const mediaDetails of detailsList) {
      if (!mediaDetails) continue;
      extraMedia.push(mediaDetails);

      const castList = mediaDetails.aggregate_credits?.cast || mediaDetails.credits?.cast || [];
      const mediaName = mediaDetails.name || mediaDetails.title || mediaDetails.original_name || mediaDetails.original_title || '';
      for (const member of castList) {
        const charName = (member.character || (Array.isArray(member.roles) && member.roles[0]?.character) || '').toString();
        if (!charName) continue;
        const charClean = cleanStr(charName);
        const matchesChar = charClean.includes(cleaned) || cleaned.includes(charClean) || queryWords.some(word => charClean.includes(word));
        if (!matchesChar) continue;

        const personObj: any = {
          id: member.id,
          media_type: 'person',
          name: member.name,
          profile_path: member.profile_path,
          known_for_department: 'Acting',
          character: charName,
          characterShow: mediaName,
          popularity: (member.popularity || 10) + 150,
          known_for: [mediaDetails]
        };
        extraPersons.push(personObj);
      }
    }

    if (extraPersons.length === 0 && foundPersonIds.size > 0) {
      const personDetailsList = await Promise.all(
        Array.from(foundPersonIds).slice(0, 3).map(id => this.getPersonDetails(id).then(result => result.ok ? result.value : null))
      );
      for (const person of personDetailsList) {
        if (person) extraPersons.push({ ...person, media_type: 'person' });
      }
    }

    return { extraMedia, extraPersons };
  }

  async smartSearchMulti(query: string, page: number = 1, watchProviders?: string[]): Promise<Result<SearchResponse>> {
    if (!query || !query.trim()) return ok({ results: [] });
    const result = await this.searchMulti(query, page, watchProviders);
    if (!result.ok) return result;
    return ok({ ...result.value, results: filterCredibleMedia(result.value.results || [], 0) });
  }

  async getTopRated(type: 'tv' | 'movie', page: number = 1): Promise<Result<SearchResponse>> {
    return this.discover(type, page, { sort_by: 'vote_average.desc', 'vote_count.gte': '3000' }, 0);
  }

  async getTopRatedRecent(type: 'tv' | 'movie' | 'all', page: number = 1, watchProviders?: string[]): Promise<Result<SearchResponse>> {
    const today = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(today.getFullYear() - 1);
    const date = oneYearAgo.toISOString().split('T')[0];
    const hasProviders = Boolean(watchProviders?.length);
    const minVotes = hasProviders ? 5 : 50;

    const fetchType = (mediaType: 'tv' | 'movie') => this.discover(mediaType, page, {
      sort_by: 'vote_average.desc',
      'vote_count.gte': hasProviders ? '5' : '100',
      'vote_average.gte': '7.0',
      [mediaType === 'tv' ? 'first_air_date.gte' : 'primary_release_date.gte']: date,
    }, minVotes, watchProviders);

    if (type !== 'all') return fetchType(type);
    const [tv, movie] = await Promise.all([fetchType('tv'), fetchType('movie')]);
    if (tv.ok && movie.ok) {
      const results = filterCredibleMedia([...tv.value.results, ...movie.value.results], minVotes)
        .sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
      return ok({ results });
    }
    return tv.ok ? tv : movie;
  }

  async getTrending(type: 'tv' | 'movie' | 'all' = 'tv', page: number = 1, watchProviders?: string[]): Promise<Result<SearchResponse>> {
    if (watchProviders?.length) {
      if (type === 'all') {
        const [tv, movie] = await Promise.all([
          this.discover('tv', page, { sort_by: 'popularity.desc' }, 5, watchProviders),
          this.discover('movie', page, { sort_by: 'popularity.desc' }, 5, watchProviders),
        ]);
        if (tv.ok && movie.ok) {
          const combined = [...tv.value.results, ...movie.value.results].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
          return ok({ results: filterCredibleMedia(combined, 5) });
        }
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
    return this.fetchJson<SearchResponse>(this.buildUrl('/person/popular', { language: 'fr-FR', page }));
  }

  async getNowPlaying(page: number = 1): Promise<Result<SearchResponse>> {
    const now = new Date();
    const past = new Date();
    past.setDate(now.getDate() - 75);
    const future = new Date();
    future.setDate(now.getDate() + 10);

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
      type = 'all',
      page = 1,
      watchProviders = [],
      genres = [],
      pegi = 'Tous',
      minRating = 'Toutes',
      sortBy = 'popular',
      sortOrder = 'desc'
    } = options;

    const buildExtra = (mediaType: 'tv' | 'movie'): { extra: Record<string, string>; minVotes: number } => {
      let sortParam = 'popularity.desc';
      if (sortBy === 'rating') {
        sortParam = sortOrder === 'asc' ? 'vote_average.asc' : 'vote_average.desc';
      } else if (sortBy === 'date') {
        const dateKey = mediaType === 'tv' ? 'first_air_date' : 'primary_release_date';
        sortParam = sortOrder === 'asc' ? `${dateKey}.asc` : `${dateKey}.desc`;
      }

      const minVotes = watchProviders.length > 0 ? 5 : (sortBy === 'rating' ? 100 : 20);
      const extra: Record<string, string> = { sort_by: sortParam, 'vote_count.gte': String(minVotes) };

      if (genres.length > 0) {
        const genreIds = Array.from(new Set(genres.flatMap(genre => GENRE_MAP[genre]?.[mediaType] || [])));
        if (genreIds.length > 0) extra.with_genres = genreIds.join('|');
      }

      if (pegi === '16' || pegi === '-16' || pegi === '16+') {
        extra.without_genres = '10762,10751';
        extra.certification_country = 'US';
        extra.certification = mediaType === 'movie' ? 'R' : 'TV-MA';
      } else if (pegi === '12' || pegi === '-12' || pegi === '12+') {
        extra.without_genres = '27';
        extra.certification_country = 'US';
        extra.certification = mediaType === 'movie' ? 'PG-13' : 'TV-14';
      } else if (pegi === '10' || pegi === '-10' || pegi === '10+') {
        extra.without_genres = '27,53,80,10752,10768';
        extra.certification_country = 'US';
        extra.certification = mediaType === 'movie' ? 'PG' : 'TV-PG';
      } else if (pegi === 'TP' || pegi === 'Tout Public') {
        extra.without_genres = '27,53,80,10752,10768';
        extra.certification_country = 'US';
        extra.certification = mediaType === 'movie' ? 'G' : 'TV-G';
      }

      if (minRating !== 'Toutes') {
        const minValue = parseFloat(minRating.replace('+', ''));
        if (!isNaN(minValue)) extra['vote_average.gte'] = String(minValue);
      }

      return { extra, minVotes };
    };

    const fetchType = (mediaType: 'tv' | 'movie') => {
      const { extra, minVotes } = buildExtra(mediaType);
      return this.discover(mediaType, page, extra, minVotes, watchProviders);
    };

    if (type !== 'all') return fetchType(type);

    const [tv, movie] = await Promise.all([fetchType('tv'), fetchType('movie')]);
    if (!tv.ok) return tv;
    if (!movie.ok) return movie;

    const combined = [...tv.value.results, ...movie.value.results];
    if (sortBy === 'rating') {
      combined.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
    } else if (sortBy === 'date') {
      combined.sort((a, b) => {
        const dateA = a.first_air_date || a.release_date || '';
        const dateB = b.first_air_date || b.release_date || '';
        return new Date(dateB).getTime() - new Date(dateA).getTime();
      });
    } else {
      combined.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    }

    return ok({ results: filterCredibleMedia(combined, watchProviders.length > 0 ? 5 : 20) });
  }

  async getPersonDetails(personId: number): Promise<Result<any>> {
    const data = await this.fetchJson<any>(this.buildUrl(`/person/${personId}`, { language: 'fr-FR' }));
    if (!data.ok) return data;

    if (data.value && !data.value.biography) {
      try {
        const english = await this.fetchJson<any>(this.buildUrl(`/person/${personId}`, { language: 'en-US' }));
        if (english.ok && english.value?.biography) data.value.biography = english.value.biography;
      } catch {
        // Le fallback anglais est non bloquant, comme dans le client historique.
      }
    }
    return data;
  }

  async getPersonCredits(personId: number): Promise<Result<any>> {
    const data = await this.fetchJson<any>(this.buildUrl(`/person/${personId}/combined_credits`, { language: 'fr-FR' }));
    if (!data.ok) return data;

    if (data.value) {
      if (Array.isArray(data.value.cast)) data.value.cast = data.value.cast.filter((media: any) => !isAdultOrParodyMedia(media));
      if (Array.isArray(data.value.crew)) data.value.crew = data.value.crew.filter((media: any) => !isAdultOrParodyMedia(media));
    }
    return data;
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

    const result = await this.fetchJson<SearchResponse>(`${this.baseUrl}/discover/${type}?${params.toString()}`);
    if (result.ok && Array.isArray(result.value.results)) {
      result.value.results = filterCredibleMedia(
        result.value.results.map(item => ({ ...item, media_type: type })),
        minVotes,
      );
    }
    return result;
  }
}

export const tmdb = new TMDBClient();