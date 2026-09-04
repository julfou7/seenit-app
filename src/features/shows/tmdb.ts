import { err, tryCatch } from '../../core/Result';
import {
  tmdb as tmdbClient,
  isAdultOrParodyMedia,
} from './tmdbClient';

export * from './tmdbClient';

const CINEMA_PAST_DAYS = 75;
const CINEMA_FUTURE_DAYS = 10;
const FRENCH_THEATRICAL_RELEASE_TYPES = new Set([2, 3]);

const getCinemaWindow = () => {
  const now = new Date();
  const pastCutoff = new Date(now);
  pastCutoff.setDate(now.getDate() - CINEMA_PAST_DAYS);
  const futureCutoff = new Date(now);
  futureCutoff.setDate(now.getDate() + CINEMA_FUTURE_DAYS);
  return { pastCutoff, futureCutoff };
};

const getFrenchTheatricalReleaseDates = (media: any): Date[] => {
  const countries = media?.release_dates?.results;
  if (!Array.isArray(countries)) return [];

  const france = countries.find((country: any) => country?.iso_3166_1 === 'FR');
  if (!Array.isArray(france?.release_dates)) return [];

  return france.release_dates
    .filter((release: any) => FRENCH_THEATRICAL_RELEASE_TYPES.has(Number(release?.type)))
    .map((release: any) => new Date(release?.release_date))
    .filter((releaseDate: Date) => !Number.isNaN(releaseDate.getTime()));
};

/**
 * SeenIt considère « Au cinéma » uniquement lorsqu'une sortie théâtrale française
 * TMDB (type 2 ou 3) est prouvée dans la fenêtre courante. Une date de sortie
 * générique, digitale, physique ou TV ne suffit jamais.
 */
export function isMovieAtCinema(media: any): boolean {
  if (!media) return false;
  const isTv = media.media_type === 'tv' || media.first_air_date !== undefined;
  if (isTv || isAdultOrParodyMedia(media)) return false;

  // Les résultats de getNowPlaying portent ce marqueur uniquement après une requête
  // TMDB France contrainte aux release types 2|3 et à la même fenêtre temporelle.
  if (media.seenitFrenchTheatrical === true) return true;

  const theatricalDates = getFrenchTheatricalReleaseDates(media);
  if (theatricalDates.length === 0) return false;

  const { pastCutoff, futureCutoff } = getCinemaWindow();
  return theatricalDates.some(releaseDate => releaseDate >= pastCutoff && releaseDate <= futureCutoff);
}

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
    jsonResult.value.results = jsonResult.value.results
      .map((movie: any) => ({
        ...movie,
        media_type: 'movie' as const,
        seenitFrenchTheatrical: true,
      }))
      .filter((movie: any) => !isAdultOrParodyMedia(movie))
      .filter((movie: any) => Number(movie.vote_count || 0) >= 5);
  }

  return jsonResult;
};

// Façade stable : tous les consommateurs historiques gardent le même singleton,
// seule la politique « Au cinéma » est durcie ici.
tmdbClient.getNowPlaying = strictFrenchNowPlaying as typeof tmdbClient.getNowPlaying;

export const tmdb = tmdbClient;
