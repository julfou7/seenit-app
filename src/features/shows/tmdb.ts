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
import { convergeTrackedMediaArtworkFromTmdb } from './trackedMediaArtwork';
import { mediaKeyFrom } from './mediaRelations';
import { getTVDBFranchiseRelation } from '../../services/tvdb';
import { readWatchProviderCache, writeWatchProviderCache } from '../providers/watchProviderCache';

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
  convergeTrackedMediaArtworkFromTmdb('tv', Number(id), details);
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
    convergeTrackedMediaArtworkFromTmdb('movie', Number(id), details);
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

  const freshPersistent = readWatchProviderCache(Number(id), type);
  if (freshPersistent) return ok(freshPersistent.data);

  const stalePersistent = readWatchProviderCache(Number(id), type, { allowStale: true });
  const result = await originalGetWatchProviders(id, type);
  if (result.ok) {
    writeWatchProviderCache(Number(id), type, result.value);
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
    const rating = resolveParentalRating(
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
// seules les politiques « Au cinéma », « Âge conseillé », titre/visuels localisés et relations exactes sont durcies ici.
tmdbClient.getNowPlaying = strictFrenchNowPlaying as typeof tmdbClient.getNowPlaying;

export const tmdb = tmdbClient;
