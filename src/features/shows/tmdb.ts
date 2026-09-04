import { err, ok, tryCatch } from '../../core/Result';
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
import { decorateParentalRatingDetails } from './parentalRating';
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

const strictFrenchNowPlaying = async (page: number = 1) => {
  const apiKey = localStorage.getItem('TMDB_API_KEY')
    || (import.meta.env.VITE_TMDB_API_KEY as string)
    || '677711df46484bc7129492d4a9267a65';
  if (!apiKey) return err(new Error('Missing API Key'));

  const { pastCutoff, futureCutoff } = getCinemaWindow();
  const url = new URL('https://api.themoviedb.org/3/discover/movie');
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('language', 'fr-FR');
  url.searchParams.set('region', 'FR');
  url.searchParams.set('sort_by', 'popularity.desc');
  url.searchParams.set('with_release_type', '2|3');
  url.searchParams.set('release_date.gte', pastCutoff.toISOString().split('T')[0]);
  url.searchParams.set('release_date.lte', futureCutoff.toISOString().split('T')[0]);
  url.searchParams.set('page', String(page));

  const response = await tryCatch(fetch(url.toString()));
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
