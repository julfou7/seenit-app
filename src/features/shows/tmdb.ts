import { err, ok, tryCatch } from '../../core/Result';
import { authenticatedFetch } from '../../lib/apiAuth';
import { resolveSeenItApiUrl } from '../../lib/seenitApi';
import {
  tmdb as tmdbClient,
  isAdultOrParodyMedia,
} from './tmdbClient';
import {
  clearFrenchTheatricalEvidence,
  getCinemaWindow,
  hasCurrentFrenchTheatricalRelease,
  hasFrenchTheatricalCinemaEvidence,
  rememberFrenchTheatricalEvidence,
} from './cinemaPolicy';
import {
  decorateParentalRatingDetails,
  matchesMaxRecommendedAge,
  parseMaxAgeFilter,
  resolveParentalRating,
} from './parentalRating';
import { getParentalRatingOverride } from '../../store/parentalRatingStore';
import { convergeTrackedMediaTitleFromTmdb } from './trackedMediaTitle';
import { mediaKeyFrom } from './mediaRelations';
import { getTVDBFranchiseRelation } from '../../services/tvdb';
import { readWatchProviderCache, writeWatchProviderCache } from '../providers/watchProviderCache';
import {
  DISCOVER_PLATFORM_ID_MAP,
  getGenreIdsForMediaType,
  matchesSelectedGenres,
  parseMinimumRating,
} from '../discover/filterPolicy';

export * from './tmdbClient';

/**
 * SeenIt considère « Au cinéma » uniquement lorsqu'une sortie théâtrale française
 * TMDB (type 2 ou 3) est prouvée dans la fenêtre courante. Une date de sortie
 * générique, digitale, physique ou TV ne suffit jamais.
 */
export function isMovieAtCinema(media: any): boolean {
  if (!media) return false;
  const isTv = media.media_type === 'tv' || media.first_air_date !== undefined;
  if (isTv || isAdultOrParodyMedia(media)) return false;
  return hasFrenchTheatricalCinemaEvidence(media);
}

const withoutDetailRecommendations = (details: any) => {
  if (!details) return details;
  const { similar: _similar, recommendations: _recommendations, ...rest } = details;
  return rest;
};

const originalGetShowDetails = tmdbClient.getShowDetails.bind(tmdbClient);
tmdbClient.getShowDetails = (async (id: number) => {
  const result = await originalGetShowDetails(id);
  if (!result.ok || !result.value) return result;
  const details = withoutDetailRecommendations(result.value);
  convergeTrackedMediaTitleFromTmdb('tv', Number(id), details);
  const decorated = decorateParentalRatingDetails(
    'tv',
    details,
    getParentalRatingOverride('tv', Number(id)),
  );
  return ok(decorated);
}) as typeof tmdbClient.getShowDetails;

const originalGetMovieDetails = tmdbClient.getMovieDetails.bind(tmdbClient);
tmdbClient.getMovieDetails = (async (id: number) => {
  const result = await originalGetMovieDetails(id);
  if (result.ok && result.value) {
    const details = withoutDetailRecommendations(result.value);
    convergeTrackedMediaTitleFromTmdb('movie', Number(id), details);
    const checkedAt = Date.now();
    const isTheatrical = hasCurrentFrenchTheatricalRelease(details);
    if (isTheatrical) rememberFrenchTheatricalEvidence(Number(id), checkedAt);
    else clearFrenchTheatricalEvidence(Number(id));

    const withCinemaEvidence = {
      ...details,
      seenitFrenchTheatrical: isTheatrical,
      seenitFrenchTheatricalCheckedAt: checkedAt,
    };
    return ok(decorateParentalRatingDetails(
      'movie',
      withCinemaEvidence,
      getParentalRatingOverride('movie', Number(id)),
    ));
  }
  return result;
}) as typeof tmdbClient.getMovieDetails;

// Les diffuseurs FR sont des métadonnées publiques. Leur cache mémoire historique
// reste prioritaire, mais une copie bornée et persistante évite de refaire le même
// appel TMDB après chaque redémarrage de la PWA/WebView. Une valeur périmée reste
// utilisable uniquement comme stale-if-error ; elle ne masque jamais un succès neuf.
const originalPeekWatchProviders = tmdbClient.peekWatchProviders.bind(tmdbClient);
const originalGetWatchProviders = tmdbClient.getWatchProviders.bind(tmdbClient);

tmdbClient.peekWatchProviders = ((id: number, type: 'tv' | 'movie' = 'tv') => {
  const memory = originalPeekWatchProviders(id, type);
  if (memory) return memory;
  return readWatchProviderCache(Number(id), type)?.data || null;
}) as typeof tmdbClient.peekWatchProviders;

tmdbClient.getWatchProviders = (async (id: number, type: 'tv' | 'movie' = 'tv') => {
  const memory = originalPeekWatchProviders(id, type);
  if (memory) return ok(memory);

  const freshPersistent = readWatchProviderCache(id, type);
  if (freshPersistent) return ok(freshPersistent.data);

  const stalePersistent = readWatchProviderCache(id, type, { allowStale: true });
  const result = await originalGetWatchProviders(id, type);
  if (result.ok) {
    writeWatchProviderCache(id, type, result.value);
    return result;
  }
  return stalePersistent ? ok(stalePersistent.data) : result;
}) as typeof tmdbClient.getWatchProviders;

const mediaRelationRuntimeCache = new Map<string, { collection: any[]; universe: any[] }>();
const MAX_MEDIA_RELATION_CACHE = 120;

const cacheMediaRelations = (mediaKey: string, snapshot: { collection: any[]; universe: any[] }) => {
  if (mediaRelationRuntimeCache.has(mediaKey)) mediaRelationRuntimeCache.delete(mediaKey);
  mediaRelationRuntimeCache.set(mediaKey, snapshot);
  while (mediaRelationRuntimeCache.size > MAX_MEDIA_RELATION_CACHE) {
    const oldest = mediaRelationRuntimeCache.keys().next().value;
    if (!oldest) break;
    mediaRelationRuntimeCache.delete(oldest);
  }
};

const resolveExactTmdbCollection = async (media: any, mediaType: 'tv' | 'movie'): Promise<any[]> => {
  if (mediaType !== 'movie') return [];
  const collectionId = Number(media?.belongs_to_collection?.id);
  if (!Number.isInteger(collectionId) || collectionId <= 0) return [];

  const result = await tmdbClient.getCollectionDetails(collectionId);
  if (!result.ok || !Array.isArray(result.value?.parts)) return [];

  const parts = result.value.parts
    .filter((part: any) => Number.isInteger(Number(part?.id)) && Number(part.id) > 0 && !isAdultOrParodyMedia(part))
    .map((part: any) => ({ ...part, id: Number(part.id), media_type: 'movie' as const }))
    .sort((left: any, right: any) => {
      const leftDate = String(left.release_date || '9999-12-31');
      const rightDate = String(right.release_date || '9999-12-31');
      return leftDate.localeCompare(rightDate);
    });

  return parts.length > 1
    ? parts.map((part: any, index: number) => ({ ...part, sagaOrder: index + 1 }))
    : [];
};

const hydrateExactTvdbItems = async (
  items: Array<{ id: number; media_type: 'tv' | 'movie' }>,
  relationKind: 'franchise' | 'universe',
): Promise<any[]> => {
  const hydrated: any[] = [];
  const concurrency = 6;

  for (let index = 0; index < items.length; index += concurrency) {
    const batch = items.slice(index, index + concurrency);
    const results = await Promise.all(batch.map(async item => {
      const details = item.media_type === 'movie'
        ? await tmdbClient.getMovieDetails(item.id)
        : await tmdbClient.getShowDetails(item.id);
      return details.ok && details.value
        ? {
            ...details.value,
            id: item.id,
            media_type: item.media_type,
            seenitRelationKind: relationKind,
          }
        : null;
    }));
    for (const item of results) if (item) hydrated.push(item);
  }

  return hydrated;
};

tmdbClient.peekUniverseAndCollection = ((media: any) => {
  const mediaKey = mediaKeyFrom(media);
  return mediaKey ? mediaRelationRuntimeCache.get(mediaKey) || null : null;
}) as typeof tmdbClient.peekUniverseAndCollection;

tmdbClient.getUniverseAndCollection = (async (media: any) => {
  const mediaKey = mediaKeyFrom(media);
  if (!mediaKey) return { collection: [], universe: [] };

  const cached = mediaRelationRuntimeCache.get(mediaKey);
  if (cached) return cached;

  const mediaType: 'tv' | 'movie' = mediaKey.startsWith('movie:') ? 'movie' : 'tv';
  const collection = await resolveExactTmdbCollection(media, mediaType);
  const collectionKeys = new Set(collection.map(item => mediaKeyFrom(item)).filter(Boolean));

  const tvdbId = Number(media?.external_ids?.tvdb_id);
  const imdbId = typeof media?.external_ids?.imdb_id === 'string' ? media.external_ids.imdb_id : null;
  const relation = await getTVDBFranchiseRelation(
    Number.isInteger(tvdbId) && tvdbId > 0 ? tvdbId : null,
    imdbId,
    mediaType,
  );
  const hydratedTvdbItems = relation
    ? await hydrateExactTvdbItems(relation.items, relation.kind)
    : [];

  const universeSeen = new Set<string>();
  let universe = hydratedTvdbItems.filter(item => {
    const itemKey = mediaKeyFrom(item);
    if (!itemKey || collectionKeys.has(itemKey) || universeSeen.has(itemKey)) return false;
    universeSeen.add(itemKey);
    return true;
  });

  if (!universe.some(item => mediaKeyFrom(item) !== mediaKey)) universe = [];
  const snapshot = { collection, universe };
  cacheMediaRelations(mediaKey, snapshot);
  return snapshot;
}) as typeof tmdbClient.getUniverseAndCollection;

const originalDiscoverWithFilters = tmdbClient.discoverWithFilters.bind(tmdbClient);
tmdbClient.discoverWithFilters = (async (options) => {
  const maxAge = parseMaxAgeFilter(options?.pegi || 'Tous');
  const result = await originalDiscoverWithFilters({ ...options, pegi: 'Tous' });
  if (!result.ok || maxAge === null || !Array.isArray(result.value?.results)) return result;

  const hydrated = await Promise.all(result.value.results.map(async (item: any) => {
    const mediaType: 'movie' | 'tv' = item.media_type === 'movie' || Boolean(item.release_date) ? 'movie' : 'tv';
    const detailsResult = mediaType === 'movie'
      ? await tmdbClient.getMovieDetails(Number(item.id))
      : await tmdbClient.getShowDetails(Number(item.id));
    if (!detailsResult.ok || !detailsResult.value) return null;
    const rating = detailsResult.value.seenitParentalRating || resolveParentalRating(
      mediaType,
      detailsResult.value,
      getParentalRatingOverride(mediaType, Number(item.id)),
    );
    if (!matchesMaxRecommendedAge(rating, maxAge)) return null;
    return { ...item, seenitParentalRating: rating };
  }));

  return ok({
    ...result.value,
    results: hydrated.filter((item): item is NonNullable<typeof item> => item !== null),
  });
}) as typeof tmdbClient.discoverWithFilters;

export interface SeenItDiscoverOptions {
  type?: 'tv' | 'movie' | 'all';
  category?: string;
  page?: number;
  watchProviders?: string[];
  genres?: string[];
  pegi?: string;
  minRating?: string;
  sortBy?: 'popular' | 'rating' | 'date' | 'title';
  sortOrder?: 'asc' | 'desc';
}

const sortCombinedDiscoverResults = (
  items: any[],
  sortBy: 'popular' | 'rating' | 'date' | 'title',
  sortOrder: 'asc' | 'desc',
) => {
  const direction = sortOrder === 'asc' ? 1 : -1;
  return items.sort((left, right) => {
    if (sortBy === 'rating') return direction * ((Number(left.vote_average) || 0) - (Number(right.vote_average) || 0));
    if (sortBy === 'date') {
      const leftDate = Date.parse(left.first_air_date || left.release_date || '') || 0;
      const rightDate = Date.parse(right.first_air_date || right.release_date || '') || 0;
      return direction * (leftDate - rightDate);
    }
    if (sortBy === 'title') {
      const leftTitle = String(left.title || left.name || left.original_title || left.original_name || '');
      const rightTitle = String(right.title || right.name || right.original_title || right.original_name || '');
      return direction * leftTitle.localeCompare(rightTitle, 'fr', { sensitivity: 'base' });
    }
    return direction * ((Number(left.popularity) || 0) - (Number(right.popularity) || 0));
  });
};

const applyCanonicalAgeFilter = async (items: any[], pegi: string): Promise<any[]> => {
  const maxAge = parseMaxAgeFilter(pegi || 'Tous');
  if (maxAge === null) return items;

  const hydrated = await Promise.all(items.map(async item => {
    const mediaType: 'movie' | 'tv' = item.media_type === 'movie' || Boolean(item.release_date) ? 'movie' : 'tv';
    const detailsResult = mediaType === 'movie'
      ? await tmdbClient.getMovieDetails(Number(item.id))
      : await tmdbClient.getShowDetails(Number(item.id));
    if (!detailsResult.ok || !detailsResult.value) return null;
    const rating = detailsResult.value.seenitParentalRating || resolveParentalRating(
      mediaType,
      detailsResult.value,
      getParentalRatingOverride(mediaType, Number(item.id)),
    );
    return matchesMaxRecommendedAge(rating, maxAge)
      ? { ...item, seenitParentalRating: rating }
      : null;
  }));

  return hydrated.filter((item): item is NonNullable<typeof item> => item !== null);
};

/**
 * Moteur canonique d'Explorer : les valeurs d'une même famille (genres ou
 * plateformes) sont en OU ; les familles distinctes sont combinées en ET.
 * La pagination reste celle de la requête TMDB brute afin qu'une page devenue
 * clairsemée après résolution parentale n'interrompe jamais la suite.
 */
export async function discoverSeenIt(options: SeenItDiscoverOptions) {
  const {
    type = 'all',
    category = 'Tout',
    page = 1,
    watchProviders = [],
    genres = [],
    pegi = 'Tous',
    minRating = 'Toutes',
    sortBy = 'popular',
    sortOrder = 'desc',
  } = options;

  const categoryDefaultSort: 'popular' | 'rating' | 'date' | 'title' =
    (category === 'Top 100' || category === 'Pépites') && sortBy === 'popular' ? 'rating' : sortBy;

  const fetchType = async (mediaType: 'tv' | 'movie') => {
    const params = new URLSearchParams();
    params.set('language', 'fr-FR');
    params.set('page', String(page));

    let sortParam = `popularity.${sortOrder}`;
    if (categoryDefaultSort === 'rating') sortParam = `vote_average.${sortOrder}`;
    else if (categoryDefaultSort === 'date') {
      sortParam = `${mediaType === 'tv' ? 'first_air_date' : 'primary_release_date'}.${sortOrder}`;
    } else if (categoryDefaultSort === 'title') {
      sortParam = `${mediaType === 'tv' ? 'name' : 'original_title'}.${sortOrder}`;
    }
    params.set('sort_by', sortParam);

    let minVotes = watchProviders.length > 0 ? 5 : (categoryDefaultSort === 'rating' ? 100 : 20);
    if (category === 'Top 100') minVotes = 3000;
    else if (category === 'Pépites') minVotes = 100;
    else if (category === 'Au cinéma') minVotes = 5;
    params.set('vote_count.gte', String(minVotes));

    const selectedMinRating = parseMinimumRating(minRating);
    const categoryMinRating = category === 'Pépites' ? 7.5 : null;
    const effectiveMinRating = Math.max(selectedMinRating ?? 0, categoryMinRating ?? 0);
    if (effectiveMinRating > 0) params.set('vote_average.gte', String(effectiveMinRating));

    if (category === 'Pépites') {
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      params.set(mediaType === 'tv' ? 'first_air_date.gte' : 'primary_release_date.gte', oneYearAgo.toISOString().split('T')[0]);
    }

    if (category === 'Au cinéma' && mediaType === 'movie') {
      const { pastCutoff, futureCutoff } = getCinemaWindow();
      params.set('region', 'FR');
      params.set('with_release_type', '2|3');
      params.set('release_date.gte', pastCutoff.toISOString().split('T')[0]);
      params.set('release_date.lte', futureCutoff.toISOString().split('T')[0]);
    }

    const genreIds = getGenreIdsForMediaType(genres, mediaType);
    if (category === 'Documentaires') {
      params.set('with_genres', '99');
    } else if (genreIds.length > 0) {
      params.set('with_genres', genreIds.join('|'));
    }

    const providerIds = watchProviders.map(provider => DISCOVER_PLATFORM_ID_MAP[provider]).filter(Boolean);
    if (providerIds.length > 0) {
      params.set('watch_region', 'FR');
      params.set('with_watch_providers', providerIds.join('|'));
    }

    const url = `${resolveSeenItApiUrl(`/api/media/tmdb/discover/${mediaType}`)}?${params.toString()}`;
    const response = await tryCatch(authenticatedFetch(url));
    if (!response.ok) return err((response as any).error);
    if (!response.value.ok) return err(new Error(`TMDB Error: ${response.value.status}`));
    const json = await tryCatch(response.value.json() as Promise<any>);
    if (!json.ok) return err((json as any).error);

    const checkedAt = Date.now();
    let results = Array.isArray(json.value?.results)
      ? json.value.results
          .map((item: any) => ({ ...item, media_type: mediaType }))
          .filter((item: any) => !isAdultOrParodyMedia(item))
      : [];

    if (category === 'Documentaires' && genres.length > 0) {
      results = results.filter((item: any) => matchesSelectedGenres(item, genres));
    }

    if (category === 'Au cinéma' && mediaType === 'movie') {
      results = results.map((movie: any) => {
        rememberFrenchTheatricalEvidence(Number(movie.id), checkedAt);
        return {
          ...movie,
          seenitFrenchTheatrical: true,
          seenitFrenchTheatricalCheckedAt: checkedAt,
        };
      });
    }

    return ok({ ...json.value, results });
  };

  let rawResult: any;
  if (type === 'all') {
    const [tvResult, movieResult] = await Promise.all([fetchType('tv'), fetchType('movie')]);
    if (!tvResult.ok && !movieResult.ok) return tvResult;
    const tvValue = tvResult.ok ? tvResult.value : { results: [], total_pages: 0, total_results: 0 };
    const movieValue = movieResult.ok ? movieResult.value : { results: [], total_pages: 0, total_results: 0 };
    rawResult = {
      results: sortCombinedDiscoverResults(
        [...(tvValue.results || []), ...(movieValue.results || [])],
        categoryDefaultSort,
        sortOrder,
      ),
      total_pages: Math.max(Number(tvValue.total_pages || 0), Number(movieValue.total_pages || 0)),
      total_results: Number(tvValue.total_results || 0) + Number(movieValue.total_results || 0),
    };
  } else {
    const typedResult = await fetchType(type);
    if (!typedResult.ok) return typedResult;
    rawResult = typedResult.value;
  }

  const filteredByAge = await applyCanonicalAgeFilter(rawResult.results || [], pegi);
  return ok({ ...rawResult, results: filteredByAge });
}

const strictFrenchNowPlaying = async (page: number = 1) => {
  const { pastCutoff, futureCutoff } = getCinemaWindow();
  const params = new URLSearchParams();
  params.set('language', 'fr-FR');
  params.set('region', 'FR');
  params.set('sort_by', 'popularity.desc');
  params.set('with_release_type', '2|3');
  params.set('release_date.gte', pastCutoff.toISOString().split('T')[0]);
  params.set('release_date.lte', futureCutoff.toISOString().split('T')[0]);
  params.set('page', String(page));
  const url = `${resolveSeenItApiUrl('/api/media/tmdb/discover/movie')}?${params.toString()}`;

  const response = await tryCatch(authenticatedFetch(url));
  if (!response.ok) return err((response as any).error);
  if (!response.value.ok) return err(new Error(`TMDB Error: ${response.value.status}`));
  const jsonResult = await tryCatch(response.value.json() as Promise<any>);
  if (!jsonResult.ok) return err((jsonResult as any).error);

  if (jsonResult.value && Array.isArray(jsonResult.value.results)) {
    const checkedAt = Date.now();
    jsonResult.value.results = jsonResult.value.results
      .map((movie: any) => {
        rememberFrenchTheatricalEvidence(Number(movie.id), checkedAt);
        return {
          ...movie,
          media_type: 'movie' as const,
          seenitFrenchTheatrical: true,
          seenitFrenchTheatricalCheckedAt: checkedAt,
        };
      })
      .filter((movie: any) => !isAdultOrParodyMedia(movie))
      .filter((movie: any) => Number(movie.vote_count || 0) >= 5);
  }
  return jsonResult;
};

// Façade stable : tous les consommateurs historiques gardent le même singleton,
// seules les politiques « Au cinéma », « Âge conseillé », titre localisé et relations exactes sont durcies ici.
tmdbClient.getNowPlaying = strictFrenchNowPlaying as typeof tmdbClient.getNowPlaying;

export const tmdb = tmdbClient;
