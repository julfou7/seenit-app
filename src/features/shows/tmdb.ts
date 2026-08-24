import { type Result, ok, err, tryCatch } from '../../core/Result';
import { getWikidataFranchiseTimeline } from '../../services/wikidata';
import { adjustTMDBShowDataForEurope, adjustTMDBSeasonDataForEurope } from '../../lib/utils';

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
class TMDBClient {
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
    const url = new URL(`${this.baseUrl}${endpoint}`);
    url.searchParams.append('api_key', apiKey);
    url.searchParams.append('query', query);
    url.searchParams.append('page', page.toString());
    if (year && type) {
       url.searchParams.append(type === 'movie' ? 'primary_release_year' : 'first_air_date_year', year);
    }

    const result = await tryCatch(fetch(url.toString()));
    
    if (!result.ok) return err((result as any).error);
    
    const response = result.value;
    if (response.status === 429) {
      return err(new Error('HTTP 429: Rate limit exceeded.'));
    }
    
    if (!response.ok) {
      return err(new Error(`TMDB Error: ${response.status} ${response.statusText}`));
    }

    const data = await tryCatch(response.json() as Promise<SearchResponse>);
    if (!data.ok) return err((data as any).error);

    if (data.value.results.length === 0) {
      return err(new Error('Show not found'));
    }

    // Algorithme de matching: On prend le premier résultat pertinent
    // Dans une V2 on pourrait implémenter un Levenshtein distance
    return ok(data.value.results[0]);
  }
  private detailsCache = new Map<string, any>();

  async getShowDetails(id: number): Promise<Result<any>> {
    const cacheKey = `tv_${id}`;
    if (this.detailsCache.has(cacheKey)) {
      return ok(this.detailsCache.get(cacheKey));
    }
    const apiKey = this.getApiKey();
    if (!apiKey) return err(new Error('Missing API Key'));
    const url = new URL(`${this.baseUrl}/tv/${id}?api_key=${apiKey}&language=fr-FR&append_to_response=credits,aggregate_credits,similar,recommendations,videos,content_ratings,external_ids,images,keywords&include_video_language=fr,en,null&include_image_language=fr,en,null,de,es,it,ja,ko`);
    const res = await tryCatch(fetch(url.toString()));
    if (!res.ok) return err((res as any).error);
    if (!res.value.ok) return err(new Error(`TMDB Error: ${res.value.status}`));
    const data = await tryCatch(res.value.json());
    if (!data.ok) return err((data as any).error);
    if (data.value && data.value.status_code) return err(new Error(data.value.status_message || 'TMDB Error'));
    
    if (data.value) {
      if (data.value.similar?.results) {
        data.value.similar.results = data.value.similar.results.filter((m: any) => !isAdultOrParodyMedia(m));
      }
      if (data.value.recommendations?.results) {
        data.value.recommendations.results = data.value.recommendations.results.filter((m: any) => !isAdultOrParodyMedia(m));
      }
      adjustTMDBShowDataForEurope(data.value);
      this.detailsCache.set(cacheKey, data.value);
    }
    return data;
  }

  async getMovieDetails(id: number): Promise<Result<any>> {
    const cacheKey = `movie_${id}`;
    if (this.detailsCache.has(cacheKey)) {
      return ok(this.detailsCache.get(cacheKey));
    }
    const apiKey = this.getApiKey();
    if (!apiKey) return err(new Error('Missing API Key'));
    const url = new URL(`${this.baseUrl}/movie/${id}?api_key=${apiKey}&language=fr-FR&append_to_response=credits,similar,recommendations,videos,release_dates,external_ids,images,keywords&include_video_language=fr,en,null&include_image_language=fr,en,null,de,es,it,ja,ko`);
    const res = await tryCatch(fetch(url.toString()));
    if (!res.ok) return err((res as any).error);
    if (!res.value.ok) return err(new Error(`TMDB Error: ${res.value.status}`));
    const data = await tryCatch(res.value.json());
    if (!data.ok) return err((data as any).error);
    if (data.value && data.value.status_code) return err(new Error(data.value.status_message || 'TMDB Error'));

    if (data.value) {
      if (data.value.similar?.results) {
        data.value.similar.results = data.value.similar.results.filter((m: any) => !isAdultOrParodyMedia(m));
      }
      if (data.value.recommendations?.results) {
        data.value.recommendations.results = data.value.recommendations.results.filter((m: any) => !isAdultOrParodyMedia(m));
      }
      this.detailsCache.set(cacheKey, data.value);
    }
    return data;
  }

  async getMediaDetails(id: number, type: 'tv' | 'movie' = 'tv'): Promise<Result<any>> {
    return type === 'movie' ? this.getMovieDetails(id) : this.getShowDetails(id);
  }

  async getFranchiseTimeline(media: any): Promise<any[]> {
    if (!media) return [];

    let collectionParts: any[] = [];

    // A. Si c'est un film appartenant à une collection native TMDB (ex: Harry Potter, Dune)
    if (media.belongs_to_collection?.id) {
      const collectionRes = await this.getCollectionDetails(media.belongs_to_collection.id);
      if (collectionRes.ok && collectionRes.value?.parts) {
        collectionParts = collectionRes.value.parts
          .filter((p: any) => (p.release_date || p.first_air_date) && !isAdultOrParodyMedia(p))
          .map((p: any) => ({ ...p, media_type: 'movie' }));
      }
    }

    // B. Interroger Wikidata pour obtenir tous les spin-offs, préquelles, séries dérivées et univers de fiction
    const imdbId = media.external_ids?.imdb_id || media.imdb_id;
    const mediaType = media.media_type || (media.title ? 'movie' : 'tv');
    const franchiseItems = await getWikidataFranchiseTimeline(media.id, mediaType, imdbId);

    // Récupérer les détails TMDB de chaque média trouvé via Wikidata
    const detailsPromises = franchiseItems.map(async (item) => {
      const res = await this.getMediaDetails(item.id, item.media_type);
      if (res.ok && res.value) {
        return {
          ...res.value,
          media_type: item.media_type,
        };
      }
      return null;
    });

    const wikidataResults = await Promise.all(detailsPromises);
    const validWikidataMedia = wikidataResults.filter((r): r is any => r !== null && !isAdultOrParodyMedia(r));

    // Fusionner collection TMDB + Wikidata en supprimant les doublons
    const map = new Map<string, any>();
    [...collectionParts, ...validWikidataMedia].forEach((item) => {
      const type = item.media_type || (item.title ? 'movie' : 'tv');
      const key = `${type}_${item.id}`;
      if (!map.has(key)) {
        map.set(key, { ...item, media_type: type });
      }
    });

    const combined = Array.from(map.values());

    if (combined.length <= 1) return [];

    // Tri chronologique par date de sortie / 1re diffusion
    combined.sort((a, b) => {
      const dateA = new Date(a.release_date || a.first_air_date || 0).getTime();
      const dateB = new Date(b.release_date || b.first_air_date || 0).getTime();
      return dateA - dateB;
    });

    // Ajouter la numérotation d'ordre chronologique (#1, #2, #3...)
    return combined.map((item, index) => ({
      ...item,
      sagaOrder: index + 1
    }));
  }

  async getCollectionDetails(collectionId: number): Promise<Result<any>> {
    const apiKey = this.getApiKey();
    if (!apiKey) return err(new Error('Missing API Key'));
    const url = new URL(`${this.baseUrl}/collection/${collectionId}?api_key=${apiKey}&language=fr-FR`);
    const res = await tryCatch(fetch(url.toString()));
    if (!res.ok) return err((res as any).error);
    if (!res.value.ok) return err(new Error(`TMDB Error: ${res.value.status}`));
    const data = await tryCatch(res.value.json());
    if (!data.ok) return err((data as any).error);
    if (data.value && data.value.status_code) return err(new Error(data.value.status_message || 'TMDB Error'));
    return data;
  }

  private watchProvidersCache = new Map<string, { data: any; timestamp: number }>();
  private episodeDetailsCache = new Map<string, { data: any; timestamp: number }>();

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
