import { type Result, ok, err, tryCatch } from '../../core/Result';
import { adjustTMDBShowDataForEurope, adjustTMDBSeasonDataForEurope } from '../../lib/utils';
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
  
  // Cutoff for films released in the last 75 days
  const pastCutoff = new Date();
  pastCutoff.setDate(now.getDate() - 75);

  // Cutoff for films opening this week/within 10 days in theaters
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

  const title = (
    item.title || 
    item.name || 
    item.original_title || 
    item.original_name || 
    ''
  ).toLowerCase();

  const adultTerms = [
    'porn', 'porno', 'xxx', 'hentai', 'erotic', 'erotique', 'érotique',
    'x-rated', 'adult', 'parody', 'parodie', 'softcore', 'hardcore',
    'jedi hunter', 'cum join', 'sex parody', 'porno parody', 'adults only'
  ];

  if (adultTerms.some(term => title.includes(term))) {
    return true;
  }

  if (Array.isArray(item.genres)) {
    if (item.genres.some((g: any) => {
      const gName = (g.name || '').toLowerCase();
      return gName.includes('erotic') || gName.includes('érotique') || gName.includes('adult') || gName.includes('porno');
    })) {
      return true;
    }
  }

  return false;
}

const filterCredibleMedia = (results: TMDBMedia[], minVoteCount: number = 50): TMDBMedia[] => {
  if (!Array.isArray(results)) return [];
  return results.filter((item: any) => {
    if (!item) return false;
    if (isAdultOrParodyMedia(item)) return false;
    // Conserver les fiches de personnes
    if (item.media_type === 'person' || item.known_for_department) return true;
    // Exclure les films / séries avec moins de minVoteCount (ex: 50)
    const count = typeof item.vote_count === 'number' ? item.vote_count : 0;
    return count >= minVoteCount;
  });
};

interface SearchResponse {
  total_results?: number;
  total_pages?: number;
  total_tv?: number;
  total_movie?: number;
  results: TMDBMedia[];
}

/**
 * Staff Engineer Note:
 * API Client avec pattern "Resilience".
 * Utilise un Singleton avec une file d'attente (Queue) et un "Rate Limiter" 
 * pour ne jamais dépasser 40 requêtes par 10 secondes (limite TMDB classique).
 */
export class TMDBClient {
  private getApiKey(): string | null {
    return localStorage.getItem('TMDB_API_KEY') || (import.meta.env.VITE_TMDB_API_KEY as string) || '677711df46484bc7129492d4a9267a65';
  }

  private baseUrl = 'https://api.themoviedb.org/3';

  // Basic rate limiter state
  private lastRequestTime = 0;
  private readonly MIN_MS_BETWEEN_REQUESTS = 250; // 4 req/sec pour être conservateur et éviter le 429

  async searchMedia(query: string, year?: string, type?: 'movie' | 'tv', page: number = 1): Promise<Result<TMDBMedia>> {
    const apiKey = this.getApiKey();
    if (!apiKey) return err(new Error('Missing TMDB API Key. Please add it in settings.'));

    // Throttling synchrone
    const now = Date.now();
    const timeSinceLast = now - this.lastRequestTime;
    if (timeSinceLast < this.MIN_MS_BETWEEN_REQUESTS) {
      await new Promise(res => setTimeout(res, this.MIN_MS_BETWEEN_REQUESTS - timeSinceLast));
    }
    this.lastRequestTime = Date.now();

    const endpoint = type === 'movie' ? '/search/movie' : (type === 'tv' ? '/search/tv' : '/search/multi');

    const fetchResultsForYear = async (searchYear?: string): Promise<TMDBMedia[]> => {
      const url = new URL(`${this.baseUrl}${endpoint}`);
      url.searchParams.append('api_key', apiKey);
      url.searchParams.append('query', query);
      url.searchParams.append('language', 'fr-FR');
      url.searchParams.append('page', page.toString());
      // Ne jamais imposer first_air_date_year pour les séries car l'année de l'épisode/saison peut différer de l'année de démarrage de la série.
      if (searchYear && type === 'movie') {
        url.searchParams.append('primary_release_year', searchYear);
      }

      const res = await tryCatch(fetch(url.toString()));
      if (!res.ok || !res.value.ok) return [];
      const data = await tryCatch(res.value.json() as Promise<SearchResponse>);
      if (!data.ok) return [];
      return data.value.results || [];
    };

    // Tentative 1 avec année (pour les films)
    let rawResults = await fetchResultsForYear(year);

    // Tentative 2 sans année si la recherche avec année n'a retourné aucun résultat
    if (rawResults.length === 0 && year) {
      rawResults = await fetchResultsForYear(undefined);
    }

    if (rawResults.length === 0) {
      return err(new Error('Media not found'));
    }

    const normalize = (t?: string) =>
      (t || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const removeArticles = (t: string) =>
      t.replace(/^(le|la|les|l|un|une|des|the|a|an)\s+/i, '').trim();

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

      // 1. Matching très tolérant des titres (français, original, avec/sans articles)
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
        // Matching par mots-clés (pour titres composés, sous-titres, etc.)
        const candTokens = `${candTitle} ${candOriginal}`.split(' ');
        const matchedTokens = targetTokens.filter(t => candTokens.includes(t));
        const tokenRatio = matchedTokens.length / targetTokens.length;
        if (tokenRatio >= 0.5) {
          score += Math.round(tokenRatio * 50);
        }
      }

      // 2. Score basé sur l'année (adapté différemment pour TV vs Movie)
      if (targetYearNum && candYear && !isNaN(targetYearNum) && !isNaN(candYear)) {
        if (type === 'tv') {
          // Pour les séries, l'année du premier épisode (first_air_date) est <= l'année de l'élément Plex
          if (candYear <= targetYearNum) {
            const diff = targetYearNum - candYear;
            if (diff === 0) score += 100;
            else if (diff <= 10) score += 40; // Très tolérant pour les séries longues
          } else {
            const diff = candYear - targetYearNum;
            if (diff <= 1) score += 20;
            else score -= 30; // Petite pénalité si la série est répertoriée dans le futur
          }
        } else {
          // Pour les films
          const diff = Math.abs(candYear - targetYearNum);
          if (diff === 0) score += 120;
          else if (diff === 1) score += 70;
          else if (diff <= 3) score += 30;
          else score -= 30; // Pénalité très modérée pour ne pas rejeter les matchs de titre exacts
        }
      }

      // 3. Poids de crédibilité et popularité
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
    const apiKey = this.getApiKey();
    if (!apiKey) return err(new Error('Missing TMDB API Key'));

    const now = Date.now();
    const timeSinceLast = now - this.lastRequestTime;
    if (timeSinceLast < this.MIN_MS_BETWEEN_REQUESTS) {
      await new Promise(res => setTimeout(res, this.MIN_MS_BETWEEN_REQUESTS - timeSinceLast));
    }
    this.lastRequestTime = Date.now();

    const cleanId = encodeURIComponent(externalId.trim());
    const url = new URL(`${this.baseUrl}/find/${cleanId}?api_key=${apiKey}&external_source=${externalSource}&language=fr-FR`);

    const result = await tryCatch(fetch(url.toString()));
    if (!result.ok) return err((result as any).error);
    if (!result.value.ok) return err(new Error(`TMDB Error: ${result.value.status}`));

    const data = await tryCatch(result.value.json() as Promise<any>);
    if (!data.ok) return err((data as any).error);

    const val = data.value || {};
    const movieResults: TMDBMedia[] = val.movie_results || [];
    const tvResults: TMDBMedia[] = val.tv_results || [];

    if (type === 'movie' && movieResults.length > 0) {
      return ok({ ...movieResults[0], media_type: 'movie' });
    }
    if (type === 'tv' && tvResults.length > 0) {
      return ok({ ...tvResults[0], media_type: 'tv' });
    }
    if (movieResults.length > 0) {
      return ok({ ...movieResults[0], media_type: 'movie' });
    }
    if (tvResults.length > 0) {
      return ok({ ...tvResults[0], media_type: 'tv' });
    }

    return err(new Error(`No media found on TMDB for external ID ${externalId}`));
  }
  private detailsCache = new BoundedCache<string, any>(80);
  private detailsInFlight = new Map<string, Promise<Result<any>>>();

  peekMediaDetails(id: number, type: RelationMediaType = 'tv'): any | null {
    return this.detailsCache.get(`${type}_${Number(id)}`) || null;
  }

  private async getCachedMediaDetails(id: number, type: RelationMediaType): Promise<Result<any>> {
    const cacheKey = `${type}_${Number(id)}`;
    const cached = this.detailsCache.get(cacheKey);
    if (cached) return ok(cached);

    const existingRequest = this.detailsInFlight.get(cacheKey);
    if (existingRequest) return existingRequest;

    const request = (async (): Promise<Result<any>> => {
      const apiKey = this.getApiKey();
      if (!apiKey) return err(new Error('Missing API Key'));
      const appended = type === 'tv'
        ? 'credits,aggregate_credits,similar,recommendations,videos,content_ratings,external_ids,images,keywords'
        : 'credits,similar,recommendations,videos,release_dates,external_ids,images,keywords';
      const url = new URL(`${this.baseUrl}/${type}/${id}?api_key=${apiKey}&language=fr-FR&append_to_response=${appended}&include_video_language=fr,en,null&include_image_language=fr,en,null,de,es,it,ja,ko`);
      const res = await tryCatch(fetch(url.toString()));
      if (!res.ok) return err((res as any).error);
      if (!res.value.ok) return err(new Error(`TMDB Error: ${res.value.status}`));
      const data = await tryCatch(res.value.json());
      if (!data.ok) return err((data as any).error);
      if (data.value && data.value.status_code) return err(new Error(data.value.status_message || 'TMDB Error'));

      if (data.value) {
        data.value.media_type = type;
        if (data.value.similar?.results) {
          data.value.similar.results = data.value.similar.results.filter((item: any) => !isAdultOrParodyMedia(item));
        }
        if (data.value.recommendations?.results) {
          data.value.recommendations.results = data.value.recommendations.results.filter((item: any) => !isAdultOrParodyMedia(item));
        }
        if (type === 'tv') adjustTMDBShowDataForEurope(data.value);
        this.detailsCache.set(cacheKey, data.value);
      }
      return data;
    })();

    this.detailsInFlight.set(cacheKey, request);
    try {
      return await request;
    } finally {
      this.detailsInFlight.delete(cacheKey);
    }
  }

  async getShowDetails(id: number): Promise<Result<any>> {
    return this.getCachedMediaDetails(id, 'tv');
  }

  async getMovieDetails(id: number): Promise<Result<any>> {
    return this.getCachedMediaDetails(id, 'movie');
  }

  async getMediaDetails(id: number, type: 'tv' | 'movie' = 'tv'): Promise<Result<any>> {
    return type === 'movie' ? this.getMovieDetails(id) : this.getShowDetails(id);
  }

  private relationCache = new BoundedCache<MediaKey, MediaRelationSnapshot>(120);
  private collectionCache = new BoundedCache<number, any>(40);
  private collectionInFlight = new Map<number, Promise<Result<any>>>();

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

    // Une collection TMDB est une preuve de saga exacte. Le manifeste reste prioritaire
    // lorsqu'il définit déjà un ordre validé (par exemple la trilogie Nolan).
    if (collection.length === 0 && mediaType === 'movie' && media.belongs_to_collection?.id) {
      const collectionRes = await this.getCollectionDetails(Number(media.belongs_to_collection.id));
      if (collectionRes.ok && Array.isArray(collectionRes.value?.parts)) {
        const parts = collectionRes.value.parts
          .filter((part: any) => (part.release_date || part.first_air_date) && !isAdultOrParodyMedia(part))
          .map((part: any) => ({ ...part, media_type: 'movie' as const }))
          .sort((a: any, b: any) => String(a.release_date || '').localeCompare(String(b.release_date || '')));
        if (parts.length > 1) {
          collection = parts.map((part: any, index: number) => ({ ...part, sagaOrder: index + 1 }));
        }
      }
    }

    // Priorité saga > univers : une clé typée ne s'affiche que dans la première section.
    const collectionKeys = relationMediaKeys(collection, 'movie');
    universe = universe.filter(item => {
      const key = mediaKeyFrom(item);
      return key !== null && !collectionKeys.has(key);
    });

    // Une auto-relation seule n'a aucune valeur et reste invisible.
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

    const existingRequest = this.collectionInFlight.get(normalizedId);
    if (existingRequest) return existingRequest;

    const request = (async (): Promise<Result<any>> => {
      const apiKey = this.getApiKey();
      if (!apiKey) return err(new Error('Missing API Key'));
      const url = new URL(`${this.baseUrl}/collection/${normalizedId}?api_key=${apiKey}&language=fr-FR`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      try {
        const res = await tryCatch(fetch(url.toString(), { signal: controller.signal }));
        if (!res.ok) return err((res as any).error);
        if (!res.value.ok) return err(new Error(`TMDB Error: ${res.value.status}`));
        const data = await tryCatch(res.value.json());
        if (!data.ok) return err((data as any).error);
        if (data.value && data.value.status_code) return err(new Error(data.value.status_message || 'TMDB Error'));
        if (data.value) this.collectionCache.set(normalizedId, data.value);
        return data;
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

  private watchProvidersCache = new BoundedCache<string, { data: any; timestamp: number }>(80);
  private episodeDetailsCache = new Map<string, { data: any; timestamp: number }>();

  peekWatchProviders(id: number, type: 'tv' | 'movie' = 'tv'): any | null {
    const cached = this.watchProvidersCache.get(`${type}:${Number(id)}`);
    if (!cached || Date.now() - cached.timestamp >= 30 * 60 * 1000) return null;
    return cached.data;
  }

  async getWatchProviders(id: number, type: 'tv' | 'movie' = 'tv'): Promise<Result<any>> {
    const cacheKey = `${type}:${id}`;
    const cached = this.watchProvidersCache.get(cacheKey);
    // Cache for 30 minutes in memory
    if (cached && Date.now() - cached.timestamp < 30 * 60 * 1000) {
      return ok(cached.data);
    }

    const apiKey = this.getApiKey();
    if (!apiKey) return err(new Error('Missing API Key'));
    const url = new URL(`${this.baseUrl}/${type}/${id}/watch/providers?api_key=${apiKey}`);
    const res = await tryCatch(fetch(url.toString()));
    if (!res.ok) return err((res as any).error);
    if (!res.value.ok) return err(new Error(`TMDB Error: ${res.value.status}`));
    const data = await tryCatch(res.value.json());
    if (!data.ok) return err((data as any).error);
    if (data.value && data.value.status_code) return err(new Error(data.value.status_message || 'TMDB Error'));

    this.watchProvidersCache.set(cacheKey, { data: data.value, timestamp: Date.now() });
    return data;
  }

  async getMediaKeywords(id: number, type: 'tv' | 'movie' = 'tv'): Promise<Result<string[]>> {
    const apiKey = this.getApiKey();
    if (!apiKey) return err(new Error('Missing API Key'));
    
    const url = new URL(`${this.baseUrl}/${type}/${id}/keywords?api_key=${apiKey}`);
    const res = await tryCatch(fetch(url.toString()));
    if (!res.ok) return err((res as any).error);
    
    const data = await tryCatch(res.value.json());
    if (!data.ok) return err((data as any).error);

    const list = type === 'tv' ? data.value.results : data.value.keywords;
    const keywords = (list || []).map((k: { name: string }) => k.name);
    return ok(keywords);
  }

  async getSeasonDetails(id: number, seasonNumber: number): Promise<Result<any>> {
    const apiKey = this.getApiKey();
    if (!apiKey) return err(new Error('Missing API Key'));
    const url = new URL(`${this.baseUrl}/tv/${id}/season/${seasonNumber}?api_key=${apiKey}&language=fr-FR&append_to_response=videos&include_video_language=fr,en,null`);
    const res = await tryCatch(fetch(url.toString()));
    if (!res.ok) return err((res as any).error);
    if (!res.value.ok) return err(new Error(`TMDB Error: ${res.value.status}`));
    const data = await tryCatch(res.value.json());
    if (!data.ok) return err((data as any).error);
    if (data.value && data.value.status_code) return err(new Error(data.value.status_message || 'TMDB Error'));
    
    // Globally adjust season dates for European viewers if the show belongs to an offset network
    if (data.value) {
      const tvDetails = this.detailsCache.get(`tv_${id}`);
      adjustTMDBSeasonDataForEurope(data.value, tvDetails?.networks);
    }
    
    return data;
  }

  async getEpisodeDetails(id: number, seasonNumber: number, episodeNumber: number): Promise<Result<any>> {
    const cacheKey = `${id}:${seasonNumber}:${episodeNumber}`;
    const cached = this.episodeDetailsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 30 * 60 * 1000) {
      return ok(cached.data);
    }

    const apiKey = this.getApiKey();
    if (!apiKey) return err(new Error('Missing API Key'));
    const url = new URL(`${this.baseUrl}/tv/${id}/season/${seasonNumber}/episode/${episodeNumber}?api_key=${apiKey}&language=fr-FR&append_to_response=videos&include_video_language=fr,en,null`);
    const res = await tryCatch(fetch(url.toString()));
    if (!res.ok) return err((res as any).error);
    if (!res.value.ok) return err(new Error(`TMDB Error: ${res.value.status}`));
    const data = await tryCatch(res.value.json());
    if (!data.ok) return err((data as any).error);
    if (data.value && data.value.status_code) return err(new Error(data.value.status_message || 'TMDB Error'));
    
    if (data.value) {
      const tvDetails = this.detailsCache.get(`tv_${id}`);
      adjustTMDBSeasonDataForEurope({ episodes: [data.value] }, tvDetails?.networks);
      this.episodeDetailsCache.set(cacheKey, { data: data.value, timestamp: Date.now() });
    }
    
    return data;
  }
  async searchMulti(query: string, page: number = 1, watchProviders?: string[]): Promise<Result<SearchResponse>> {
    const apiKey = this.getApiKey();
    if (!apiKey) return err(new Error('Missing API Key'));
    let urlStr = `${this.baseUrl}/search/multi?api_key=${apiKey}&query=${encodeURIComponent(query)}&language=fr-FR&page=${page}`;

    // Note: TMDB search/multi doesn't technically support with_watch_providers,
    // but if we are passing it down we might want to filter client-side later,
    // or just let it be. We will not modify the URL for search/multi as it ignores it.

    const url = new URL(urlStr);
    const res = await tryCatch(fetch(url.toString()));
    if (!res.ok) return err((res as any).error);
    if (!res.value.ok) return err(new Error(`TMDB Error: ${res.value.status}`));
    const data = await tryCatch(res.value.json() as Promise<SearchResponse>);
    if (!data.ok) return err((data as any).error);
    if ((data.value as any)?.status_code) return err(new Error((data.value as any).status_message || 'TMDB Error'));
    if (data.value && Array.isArray(data.value.results)) {
      data.value.results = filterCredibleMedia(data.value.results, 0);
    }
    return data;
  }

  async searchTV(query: string, page: number = 1, watchProviders?: string[]): Promise<Result<SearchResponse>> {
    const apiKey = this.getApiKey();
    if (!apiKey) return err(new Error('Missing API Key'));
    let urlStr = `${this.baseUrl}/search/tv?api_key=${apiKey}&query=${encodeURIComponent(query)}&language=fr-FR&page=${page}`;

    // Note: TMDB search/tv doesn't support with_watch_providers.

    const url = new URL(urlStr);
    const res = await tryCatch(fetch(url.toString()));
    if (!res.ok) return err((res as any).error);
    if (!res.value.ok) return err(new Error(`TMDB Error: ${res.value.status}`));
    const data = await tryCatch(res.value.json() as Promise<SearchResponse>);
    if (!data.ok) return err((data as any).error);
    if ((data.value as any)?.status_code) return err(new Error((data.value as any).status_message || 'TMDB Error'));
    if (data.value && Array.isArray(data.value.results)) {
      data.value.results = filterCredibleMedia(data.value.results, 0).map(r => ({ ...r, media_type: 'tv' }));
    }
    return data;
  }

  async searchMovie(query: string, page: number = 1, watchProviders?: string[]): Promise<Result<SearchResponse>> {
    const apiKey = this.getApiKey();
    if (!apiKey) return err(new Error('Missing API Key'));
    let urlStr = `${this.baseUrl}/search/movie?api_key=${apiKey}&query=${encodeURIComponent(query)}&language=fr-FR&page=${page}`;

    // Note: TMDB search/movie doesn't support with_watch_providers.

    const url = new URL(urlStr);
    const res = await tryCatch(fetch(url.toString()));
    if (!res.ok) return err((res as any).error);
    if (!res.value.ok) return err(new Error(`TMDB Error: ${res.value.status}`));
    const data = await tryCatch(res.value.json() as Promise<SearchResponse>);
    if (!data.ok) return err((data as any).error);
    if ((data.value as any)?.status_code) return err(new Error((data.value as any).status_message || 'TMDB Error'));
    if (data.value && Array.isArray(data.value.results)) {
      data.value.results = filterCredibleMedia(data.value.results, 0).map(r => ({ ...r, media_type: 'movie' }));
    }
    return data;
  }

  async searchPerson(query: string, page: number = 1): Promise<Result<SearchResponse>> {
    const apiKey = this.getApiKey();
    if (!apiKey) return err(new Error('Missing API Key'));
    const url = new URL(`${this.baseUrl}/search/person?api_key=${apiKey}&query=${encodeURIComponent(query)}&language=fr-FR&page=${page}`);
    const res = await tryCatch(fetch(url.toString()));
    if (!res.ok) return err((res as any).error);
    if (!res.value.ok) return err(new Error(`TMDB Error: ${res.value.status}`));
    const data = await tryCatch(res.value.json() as Promise<SearchResponse>);
    if (!data.ok) return err((data as any).error);
    if ((data.value as any)?.status_code) return err(new Error((data.value as any).status_message || 'TMDB Error'));
    if (data.value && Array.isArray(data.value.results)) {
      data.value.results = data.value.results.map(p => ({ ...p, media_type: 'person' }));
    }
    return data;
  }

  async searchCharacterFallback(query: string, cleaned: string): Promise<{ extraMedia: TMDBMedia[]; extraPersons: TMDBMedia[] }> {
    const extraMedia: TMDBMedia[] = [];
    const extraPersons: TMDBMedia[] = [];

    const cleanStr = (str: string) => 
      str.normalize("NFD")
         .replace(/[\u0300-\u036f]/g, "")
         .replace(/['’\-_]/g, " ")
         .toLowerCase()
         .trim();

    const foundTvIds = new Set<number>();
    const foundMovieIds = new Set<number>();
    const foundPersonIds = new Set<number>();
    const showNamesToQuery = new Set<string>();

    // A. Wikipedia Search API (FR + EN)
    try {
      const wikiUrls = [
        `https://fr.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`,
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`,
        `https://fr.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query + ' série film')}&format=json&origin=*`,
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query + ' TV series movie')}&format=json&origin=*`
      ];
      const wikiResponses = await Promise.all(wikiUrls.map(u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null)));
      
      for (const data of wikiResponses) {
        if (data?.query?.search) {
          for (const item of data.query.search) {
            const title = item.title || '';
            const snippet = item.snippet || '';

            const titleShowMatch = title.match(/\(([^)]+)\)/);
            if (titleShowMatch) {
              const insideParens = titleShowMatch[1].replace(/série télévisée|film|TV series|character|personnage/gi, '').trim();
              if (insideParens.length >= 2) showNamesToQuery.add(insideParens);
            }

            const cleanTitle = title.replace(/\([^)]+\)/g, '').trim();
            if (cleanTitle.length >= 3 && cleanStr(cleanTitle) !== cleaned) {
              showNamesToQuery.add(cleanTitle);
            }

            const snippetText = snippet.replace(/<[^>]+>/g, '');
            const showMatches = snippetText.match(/(?:série|film|series|movie|show|drama)\s+(?:télévisée\s+)?(?:intitulée\s+|nommée\s+|de\s+|in\s+)?([A-ZÉÈÀÙA-Za-z0-9\s'’-]{2,30})/gi);
            if (showMatches) {
              showMatches.forEach(m => {
                const cleanedName = m.replace(/série|film|series|movie|show|drama|télévisée|intitulée|nommée|de|in/gi, '').trim();
                if (cleanedName.length >= 3) showNamesToQuery.add(cleanedName);
              });
            }
          }
        }
      }
    } catch (e) {
      console.error('Wikipedia fallback error:', e);
    }

    // B. Wikidata SPARQL Query
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
        headers: { 'Accept': 'application/json', 'User-Agent': 'SeriesApp/1.0' }
      });
      if (response.ok) {
        const data = await response.json();
        data?.results?.bindings?.forEach((row: any) => {
          if (row.tmdbTv?.value) foundTvIds.add(parseInt(row.tmdbTv.value, 10));
          if (row.tmdbMovie?.value) foundMovieIds.add(parseInt(row.tmdbMovie.value, 10));
          if (row.tmdbPerson?.value) foundPersonIds.add(parseInt(row.tmdbPerson.value, 10));
          if (row.workLabel?.value) {
            const wl = row.workLabel.value.trim();
            if (wl.length >= 3 && !wl.startsWith('Q')) showNamesToQuery.add(wl);
          }
        });
      }
    } catch (e) {
      console.error('Wikidata SPARQL character fallback error:', e);
    }

    // C. Query TMDB with discovered Show Names
    const showNamesList = Array.from(showNamesToQuery).slice(0, 3);
    const searchPromises = showNamesList.map(name => this.searchMulti(name, 1));
    const searchResults = await Promise.all(searchPromises);

    for (const res of searchResults) {
      if (res.ok && res.value?.results) {
        for (const item of res.value.results) {
          if (item.media_type === 'tv' || item.first_air_date) {
            foundTvIds.add(item.id);
          } else if (item.media_type === 'movie' || item.release_date) {
            foundMovieIds.add(item.id);
          } else if (item.media_type === 'person') {
            foundPersonIds.add(item.id);
          }
        }
      }
    }

    // D. Fetch Show Details for found TV / Movie IDs
    const tvIdsList = Array.from(foundTvIds).slice(0, 3);
    const movieIdsList = Array.from(foundMovieIds).slice(0, 3);

    const detailPromises: Promise<any>[] = [
      ...tvIdsList.map(id => this.getShowDetails(id).then(r => r.ok ? { ...r.value, media_type: 'tv' as const } : null)),
      ...movieIdsList.map(id => this.getMovieDetails(id).then(r => r.ok ? { ...r.value, media_type: 'movie' as const } : null))
    ];

    const detailsList = await Promise.all(detailPromises);

    const queryWords = cleaned.split(' ').filter(w => w.length >= 3);

    for (const mediaDetails of detailsList) {
      if (!mediaDetails) continue;
      
      extraMedia.push(mediaDetails);

      const castList = mediaDetails.aggregate_credits?.cast || mediaDetails.credits?.cast || [];
      const mediaName = mediaDetails.name || mediaDetails.title || mediaDetails.original_name || mediaDetails.original_title || '';

      for (const member of castList) {
        const charName = (member.character || (Array.isArray(member.roles) && member.roles[0]?.character) || '').toString();
        if (charName) {
          const charClean = cleanStr(charName);
          const matchesChar = charClean.includes(cleaned) || cleaned.includes(charClean) || 
                              queryWords.some(qw => charClean.includes(qw));
          if (matchesChar) {
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
      }
    }

    if (extraPersons.length === 0 && foundPersonIds.size > 0) {
      const personIdsList = Array.from(foundPersonIds).slice(0, 3);
      const personPromises = personIdsList.map(id => this.getPersonDetails(id).then(r => r.ok ? r.value : null));
      const personDetailsList = await Promise.all(personPromises);
      for (const p of personDetailsList) {
        if (p) {
          extraPersons.push({
            ...p,
            media_type: 'person'
          });
        }
      }
    }

    return { extraMedia, extraPersons };
  }

  async smartSearchMulti(query: string, page: number = 1, watchProviders?: string[]): Promise<Result<SearchResponse>> {
    if (!query || !query.trim()) {
      return ok({ results: [] });
    }

    const res = await this.searchMulti(query, page, watchProviders);
    if (!res.ok) return res;

    // Optional: Filter credible media
    const results = filterCredibleMedia(res.value.results || [], 0);
    return ok({ ...res.value, results });
  }

  async getTopRated(type: 'tv' | 'movie', page: number = 1): Promise<Result<SearchResponse>> {
    const apiKey = this.getApiKey();
    if (!apiKey) return err(new Error('Missing API Key'));
    
    // Pour simuler un Top 100 IMDb, on prend les mieux notés avec au moins 3000 votes
    const url = `${this.baseUrl}/discover/${type}?api_key=${apiKey}&language=fr-FR&sort_by=vote_average.desc&vote_count.gte=3000&page=${page}`;
    const res = await tryCatch(fetch(url));
    if (!res.ok) return err((res as any).error);
    if (!res.value.ok) return err(new Error(`TMDB Error: ${res.value.status}`));
    const data = await tryCatch(res.value.json());
    if (!data.ok) return err((data as any).error);
    return data;
  }

  async getTopRatedRecent(type: 'tv' | 'movie' | 'all', page: number = 1, watchProviders?: string[]): Promise<Result<SearchResponse>> {
    const today = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(today.getFullYear() - 1);
    
    const dateStr = oneYearAgo.toISOString().split('T')[0];
    const apiKey = this.getApiKey();
    if (!apiKey) return err(new Error('Missing API Key'));

    const hasProviders = watchProviders && watchProviders.length > 0;
    const minVotes = hasProviders ? 5 : 50;

    const fetchByType = async (t: 'tv' | 'movie') => {
      const endpoint = `discover/${t}`;
      const dateParam = t === 'tv' ? `first_air_date.gte=${dateStr}` : `primary_release_date.gte=${dateStr}`;
      const voteParam = hasProviders ? 'vote_count.gte=5' : 'vote_count.gte=100';
      let urlStr = `${this.baseUrl}/${endpoint}?api_key=${apiKey}&language=fr-FR&sort_by=vote_average.desc&${voteParam}&vote_average.gte=7.0&${dateParam}&page=${page}`;
      
      if (hasProviders) {
        const PLATFORM_ID_MAP: Record<string, string> = {
          'netflix': '8',
          'hbo': '118',
          'disney': '337',
          'apple': '350',
          'prime': '119',
          'canal': '381',
          'max': '1825',
        };
        const tmdbProviderIds = watchProviders.map(p => PLATFORM_ID_MAP[p]).filter(Boolean);
        if (tmdbProviderIds.length > 0) {
          urlStr += `&watch_region=FR&with_watch_providers=${tmdbProviderIds.join('|')}`;
        }
      }
      
      const res = await tryCatch(fetch(urlStr));
      if (!res.ok) return err((res as any).error);
      const jsonRes = await tryCatch(res.value.json());
      if (jsonRes.ok && jsonRes.value && Array.isArray(jsonRes.value.results)) {
        jsonRes.value.results = filterCredibleMedia(jsonRes.value.results.map(r => ({ ...r, media_type: t })), minVotes);
      }
      return jsonRes;
    };

    if (type === 'all') {
      const [tvRes, movieRes] = await Promise.all([fetchByType('tv'), fetchByType('movie')]);
      if (tvRes.ok && movieRes.ok) {
        const results = filterCredibleMedia([...tvRes.value.results, ...movieRes.value.results], minVotes).sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
        return ok({ results });
      }
      return tvRes.ok ? tvRes : movieRes;
    } else {
      return fetchByType(type);
    }
  }

  async getTrending(type: 'tv' | 'movie' | 'all' = 'tv', page: number = 1, watchProviders?: string[]): Promise<Result<SearchResponse>> {
    const apiKey = this.getApiKey();
    if (!apiKey) return err(new Error('Missing API Key'));
    
    if (watchProviders && watchProviders.length > 0) {
      const PLATFORM_ID_MAP: Record<string, string> = {
        'netflix': '8',
        'hbo': '118',
        'disney': '337',
        'apple': '350',
        'prime': '119',
        'canal': '381',
        'max': '1825',
      };
      const tmdbProviderIds = watchProviders.map(p => PLATFORM_ID_MAP[p]).filter(Boolean);
      if (tmdbProviderIds.length > 0) {
        const providersStr = tmdbProviderIds.join('|');
        if (type === 'all') {
          const [resTv, resMov] = await Promise.all([
            tryCatch(fetch(`${this.baseUrl}/discover/tv?api_key=${apiKey}&language=fr-FR&sort_by=popularity.desc&watch_region=FR&with_watch_providers=${providersStr}&page=${page}`)),
            tryCatch(fetch(`${this.baseUrl}/discover/movie?api_key=${apiKey}&language=fr-FR&sort_by=popularity.desc&watch_region=FR&with_watch_providers=${providersStr}&page=${page}`))
          ]);
          let tvResults: TMDBMedia[] = [];
          let movResults: TMDBMedia[] = [];
          if (resTv.ok && resTv.value.ok) {
            const data = await resTv.value.json();
            tvResults = (data.results || []).map((r: any) => ({ ...r, media_type: 'tv' }));
          }
          if (resMov.ok && resMov.value.ok) {
            const data = await resMov.value.json();
            movResults = (data.results || []).map((r: any) => ({ ...r, media_type: 'movie' }));
          }
          const combined = [...tvResults, ...movResults].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
          return ok({ results: filterCredibleMedia(combined, 5) });
        } else {
          const urlStr = `${this.baseUrl}/discover/${type}?api_key=${apiKey}&language=fr-FR&sort_by=popularity.desc&watch_region=FR&with_watch_providers=${providersStr}&page=${page}`;
          const res = await tryCatch(fetch(urlStr));
          if (!res.ok) return err((res as any).error);
          const jsonRes = await tryCatch(res.value.json());
          if (jsonRes.ok && jsonRes.value && Array.isArray(jsonRes.value.results)) {
            jsonRes.value.results = filterCredibleMedia(jsonRes.value.results.map(r => ({ ...r, media_type: type })), 5);
          }
          return jsonRes;
        }
      }
    }
    
    let urlStr = `${this.baseUrl}/trending/${type}/week?api_key=${apiKey}&language=fr-FR&page=${page}`;
    const url = new URL(urlStr);
    const res = await tryCatch(fetch(url.toString()));
    if (!res.ok) return err((res as any).error);
    const jsonRes = await tryCatch(res.value.json());
    if (jsonRes.ok && jsonRes.value && Array.isArray(jsonRes.value.results)) {
      jsonRes.value.results = filterCredibleMedia(jsonRes.value.results, 50);
    }
    return jsonRes;
  }

  async discoverByGenre(type: 'tv' | 'movie', genreId: number, page: number = 1, watchProviders?: string[]): Promise<Result<SearchResponse>> {
    const apiKey = this.getApiKey();
    if (!apiKey) return err(new Error('Missing API Key'));
    const hasProviders = watchProviders && watchProviders.length > 0;
    const minVotes = hasProviders ? 5 : 50;
    let urlStr = `${this.baseUrl}/discover/${type}?api_key=${apiKey}&language=fr-FR&with_genres=${genreId}&vote_count.gte=${minVotes}&page=${page}`;
    
    if (hasProviders) {
      const PLATFORM_ID_MAP: Record<string, string> = {
        'netflix': '8',
        'hbo': '118',
        'disney': '337',
        'apple': '350',
        'prime': '119',
        'canal': '381',
        'max': '1825',
      };
      const tmdbProviderIds = watchProviders.map(p => PLATFORM_ID_MAP[p]).filter(Boolean);
      if (tmdbProviderIds.length > 0) {
        urlStr += `&watch_region=FR&with_watch_providers=${tmdbProviderIds.join('|')}`;
      }
    }
    
    const url = new URL(urlStr);
    const res = await tryCatch(fetch(url.toString()));
    if (!res.ok) return err((res as any).error);
    const jsonRes = await tryCatch(res.value.json());
    if (jsonRes.ok && jsonRes.value && Array.isArray(jsonRes.value.results)) {
      jsonRes.value.results = filterCredibleMedia(jsonRes.value.results.map(r => ({ ...r, media_type: type })), minVotes);
    }
    return jsonRes;
  }

  async getPopular(type: 'tv' | 'movie' = 'tv', page: number = 1, watchProviders?: string[]): Promise<Result<SearchResponse>> {
    const apiKey = this.getApiKey();
    if (!apiKey) return err(new Error('Missing API Key'));
    const hasProviders = watchProviders && watchProviders.length > 0;
    const minVotes = hasProviders ? 5 : 50;
    const minDateParam = type === 'tv' ? 'first_air_date.gte=2016-01-01' : 'primary_release_date.gte=2016-01-01';
    let urlStr = `${this.baseUrl}/discover/${type}?api_key=${apiKey}&language=fr-FR&sort_by=popularity.desc&vote_count.gte=${minVotes}&page=${page}`;
    if (!hasProviders) {
      urlStr += `&${minDateParam}`;
    }
    
    if (hasProviders) {
      const PLATFORM_ID_MAP: Record<string, string> = {
        'netflix': '8',
        'hbo': '118',
        'disney': '337',
        'apple': '350',
        'prime': '119',
        'canal': '381',
        'max': '1825',
      };
      const tmdbProviderIds = watchProviders.map(p => PLATFORM_ID_MAP[p]).filter(Boolean);
      if (tmdbProviderIds.length > 0) {
        urlStr += `&watch_region=FR&with_watch_providers=${tmdbProviderIds.join('|')}`;
      }
    }
    
    const url = new URL(urlStr);
    const res = await tryCatch(fetch(url.toString()));
    if (!res.ok) return err((res as any).error);
    const jsonRes = await tryCatch(res.value.json());
    if (jsonRes.ok && jsonRes.value && Array.isArray(jsonRes.value.results)) {
      jsonRes.value.results = filterCredibleMedia(jsonRes.value.results.map(r => ({ ...r, media_type: type })), minVotes);
    }
    return jsonRes;
  }

  async getPopularPersons(page: number = 1): Promise<Result<SearchResponse>> {
    const apiKey = this.getApiKey();
    if (!apiKey) return err(new Error('Missing API Key'));
    const url = new URL(`${this.baseUrl}/person/popular?api_key=${apiKey}&language=fr-FR&page=${page}`);
    const res = await tryCatch(fetch(url.toString()));
    if (!res.ok) return err((res as any).error);
    return await tryCatch(res.value.json());
  }

  async getNowPlaying(page: number = 1): Promise<Result<SearchResponse>> {
    const apiKey = this.getApiKey();
    if (!apiKey) return err(new Error('Missing API Key'));

    const now = new Date();
    const pastCutoff = new Date();
    pastCutoff.setDate(now.getDate() - 75);

    const futureCutoff = new Date();
    futureCutoff.setDate(now.getDate() + 10);

    const pastStr = pastCutoff.toISOString().split('T')[0];
    const futureStr = futureCutoff.toISOString().split('T')[0];

    const discoverUrl = `${this.baseUrl}/discover/movie?api_key=${apiKey}&language=fr-FR&region=FR&sort_by=popularity.desc&primary_release_date.gte=${pastStr}&primary_release_date.lte=${futureStr}&page=${page}`;

    const res = await tryCatch(fetch(discoverUrl));
    if (!res.ok) return err((res as any).error);
    const jsonRes = await tryCatch(res.value.json());

    if (jsonRes.ok && jsonRes.value && Array.isArray(jsonRes.value.results)) {
      const movies = jsonRes.value.results
        .map((r: any) => ({ ...r, media_type: 'movie' as const }))
        .filter((m: any) => isMovieAtCinema(m));
      jsonRes.value.results = filterCredibleMedia(movies, 5);
    }

    return jsonRes;
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
    const apiKey = this.getApiKey();
    if (!apiKey) return err(new Error('Missing API Key'));

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

    const GENRE_MAP: Record<string, { movie: number[]; tv: number[] }> = {
      'Action': { movie: [28], tv: [10759] },
      'Aventure': { movie: [12], tv: [10759] },
      'Animation': { movie: [16], tv: [16] },
      'Biopic': { movie: [36, 99], tv: [99, 18] },
      'Comédie': { movie: [35], tv: [35] },
      'Drame': { movie: [18], tv: [18] },
      'Fantastique': { movie: [14], tv: [10765] },
      'Horreur': { movie: [27], tv: [9648] },
      'Romance': { movie: [10749], tv: [10766, 18] },
      'Sci-Fi': { movie: [878], tv: [10765] },
      'Thriller': { movie: [53, 80], tv: [80, 9648] }
    };

    const PLATFORM_ID_MAP: Record<string, string> = {
      'netflix': '8',
      'hbo': '118',
      'disney': '337',
      'apple': '350',
      'prime': '119',
      'canal': '381',
      'max': '1825',
    };

    const buildUrl = (mediaType: 'tv' | 'movie') => {
      let sortParam = 'popularity.desc';
      if (sortBy === 'rating') {
        sortParam = sortOrder === 'asc' ? 'vote_average.asc' : 'vote_average.desc';
      } else if (sortBy === 'date') {
        const dateKey = mediaType === 'tv' ? 'first_air_date' : 'primary_release_date';
        sortParam = sortOrder === 'asc' ? `${dateKey}.asc` : `${dateKey}.desc`;
      }

      let urlStr = `${this.baseUrl}/discover/${mediaType}?api_key=${apiKey}&language=fr-FR&sort_by=${sortParam}&page=${page}`;

      const minVotes = watchProviders.length > 0 ? 5 : (sortBy === 'rating' ? 100 : 20);
      urlStr += `&vote_count.gte=${minVotes}`;

      // Genre filter
      if (genres.length > 0) {
        const genreIds = Array.from(new Set(genres.flatMap(g => GENRE_MAP[g]?.[mediaType] || [])));
        if (genreIds.length > 0) {
          urlStr += `&with_genres=${genreIds.join('|')}`;
        }
      }

      // Classification filter
      if (pegi === '16' || pegi === '-16' || pegi === '16+') {
        urlStr += '&without_genres=10762,10751';
        if (mediaType === 'movie') {
          urlStr += '&certification_country=US&certification=R';
        } else {
          urlStr += '&certification_country=US&certification=TV-MA';
        }
      } else if (pegi === '12' || pegi === '-12' || pegi === '12+') {
        urlStr += '&without_genres=27';
        if (mediaType === 'movie') {
          urlStr += '&certification_country=US&certification=PG-13';
        } else {
          urlStr += '&certification_country=US&certification=TV-14';
        }
      } else if (pegi === '10' || pegi === '-10' || pegi === '10+') {
        urlStr += '&without_genres=27,53,80,10752,10768';
        if (mediaType === 'movie') {
          urlStr += '&certification_country=US&certification=PG';
        } else {
          urlStr += '&certification_country=US&certification=TV-PG';
        }
      } else if (pegi === 'TP' || pegi === 'Tout Public') {
        urlStr += '&without_genres=27,53,80,10752,10768';
        if (mediaType === 'movie') {
          urlStr += '&certification_country=US&certification=G';
        } else {
          urlStr += '&certification_country=US&certification=TV-G';
        }
      }

      // Min rating
      if (minRating !== 'Toutes') {
        const minVal = parseFloat(minRating.replace('+', ''));
        if (!isNaN(minVal)) {
          urlStr += `&vote_average.gte=${minVal}`;
        }
      }

      // Watch providers
      if (watchProviders.length > 0) {
        const tmdbProviderIds = watchProviders.map(p => PLATFORM_ID_MAP[p]).filter(Boolean);
        if (tmdbProviderIds.length > 0) {
          urlStr += `&watch_region=FR&with_watch_providers=${tmdbProviderIds.join('|')}`;
        }
      }

      return urlStr;
    };

    if (type === 'all') {
      const [resTv, resMov] = await Promise.all([
        tryCatch(fetch(buildUrl('tv'))),
        tryCatch(fetch(buildUrl('movie')))
      ]);

      let tvResults: TMDBMedia[] = [];
      let movResults: TMDBMedia[] = [];

      if (resTv.ok && resTv.value.ok) {
        const data = await resTv.value.json();
        tvResults = (data.results || []).map((r: any) => ({ ...r, media_type: 'tv' }));
      }
      if (resMov.ok && resMov.value.ok) {
        const data = await resMov.value.json();
        movResults = (data.results || []).map((r: any) => ({ ...r, media_type: 'movie' }));
      }

      const combined = [...tvResults, ...movResults];
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
    } else {
      const urlStr = buildUrl(type);
      const res = await tryCatch(fetch(urlStr));
      if (!res.ok) return err((res as any).error);
      const jsonRes = await tryCatch(res.value.json());
      if (jsonRes.ok && jsonRes.value && Array.isArray(jsonRes.value.results)) {
        jsonRes.value.results = filterCredibleMedia(jsonRes.value.results.map(r => ({ ...r, media_type: type })), watchProviders.length > 0 ? 5 : 20);
      }
      return jsonRes;
    }
  }
  async getPersonDetails(personId: number): Promise<Result<any>> {
    const apiKey = this.getApiKey();
    if (!apiKey) return err(new Error('Missing API Key'));
    const url = new URL(`${this.baseUrl}/person/${personId}?api_key=${apiKey}&language=fr-FR`);
    const res = await tryCatch(fetch(url.toString()));
    if (!res.ok) return err((res as any).error);
    if (!res.value.ok) return err(new Error(`TMDB Error: ${res.value.status}`));
    const data = await tryCatch(res.value.json());
    if (!data.ok) return err((data as any).error);
    if (data.value && data.value.status_code) return err(new Error(data.value.status_message || 'TMDB Error'));
    
    // Fallback to English if no French biography
    if (data.value && !data.value.biography) {
       try {
         const enUrl = new URL(`${this.baseUrl}/person/${personId}?api_key=${apiKey}&language=en-US`);
         const enRes = await fetch(enUrl.toString());
         if (enRes.ok) {
           const enData = await enRes.json();
           if (enData.biography) data.value.biography = enData.biography;
         }
       } catch (e) {}
    }
    
    return data;
  }

  async getPersonCredits(personId: number): Promise<Result<any>> {
    const apiKey = this.getApiKey();
    if (!apiKey) return err(new Error('Missing API Key'));
    const url = new URL(`${this.baseUrl}/person/${personId}/combined_credits?api_key=${apiKey}&language=fr-FR`);
    const res = await tryCatch(fetch(url.toString()));
    if (!res.ok) return err((res as any).error);
    if (!res.value.ok) return err(new Error(`TMDB Error: ${res.value.status}`));
    const data = await tryCatch(res.value.json());
    if (!data.ok) return err((data as any).error);
    if (data.value && data.value.status_code) return err(new Error(data.value.status_message || 'TMDB Error'));

    if (data.value) {
      if (Array.isArray(data.value.cast)) {
        data.value.cast = data.value.cast.filter((m: any) => !isAdultOrParodyMedia(m));
      }
      if (Array.isArray(data.value.crew)) {
        data.value.crew = data.value.crew.filter((m: any) => !isAdultOrParodyMedia(m));
      }
    }

    return data;
  }
}

export const tmdb = new TMDBClient();
