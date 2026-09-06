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

const originalGetShowDetails = tmdbClient.getShowDetails.bind(tmdbClient);
tmdbClient.getShowDetails = (async (id: number) => {
  const result = await originalGetShowDetails(id);
  if (!result.ok || !result.value) return result;
  const decorated = decorateParentalRatingDetails(
    'tv',
    result.value,
    getParentalRatingOverride('tv', Number(id)),
  );
  return ok(decorated);
}) as typeof tmdbClient.getShowDetails;

const originalGetMovieDetails = tmdbClient.getMovieDetails.bind(tmdbClient);
tmdbClient.getMovieDetails = (async (id: number) => {
  const result = await originalGetMovieDetails(id);
  if (result.ok && result.value) {
    const checkedAt = Date.now();
    const isTheatrical = hasCurrentFrenchTheatricalRelease(result.value);
    if (isTheatrical) rememberFrenchTheatricalEvidence(Number(id), checkedAt);
    else clearFrenchTheatricalEvidence(Number(id));

    const withCinemaEvidence = {
      ...result.value,
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
// seules les politiques « Au cinéma » et « Âge conseillé » sont durcies ici.
tmdbClient.getNowPlaying = strictFrenchNowPlaying as typeof tmdbClient.getNowPlaying;

export const tmdb = tmdbClient;
