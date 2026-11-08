import { tmdb, type TMDBMedia } from '../shows/tmdb';
import { getC411Top, type C411TopItem } from '../../services/c411';

/** Catégorie d'Explorer (SEENIT-C411-004, #900), proposée sous le réglage Téléchargements avec une clé C411. */
export const TOP_C411_CATEGORY = 'Top C411';
const DETAIL_CONCURRENCY = 6;

type MediaDetails = TMDBMedia & { genres?: Array<{ id: number }> };

/**
 * Titres du Top C411 en cartes d'Explorer : chaque fiche est lue chez TMDB par l'identifiant exact fourni par
 * C411 (jamais par titre) ; une fiche introuvable est écartée sans décaler les autres rangs. Une panne C411 ou un
 * classement sans fiche rattachable donne un message, jamais une liste vide muette.
 */
export async function loadC411TopMedia(isCurrent: () => boolean = () => true, load: typeof getC411Top = getC411Top): Promise<{ media: TMDBMedia[]; notice: string | null }> {
  let top: { items: C411TopItem[]; unresolved: number };
  try {
    top = await load('videos');
  } catch (error: unknown) {
    return { media: [], notice: error instanceof Error && error.message ? error.message : 'Classement C411 indisponible.' };
  }
  const media: Array<TMDBMedia | null> = new Array(top.items.length).fill(null);
  for (let index = 0; index < top.items.length && isCurrent(); index += DETAIL_CONCURRENCY) {
    await Promise.all(top.items.slice(index, index + DETAIL_CONCURRENCY).map(async (item, offset) => {
      const result = await tmdb.getMediaDetails(item.tmdbId, item.mediaType).catch(() => null);
      const details = result?.ok ? result.value as MediaDetails | null : null;
      if (!details || Number(details.id) !== item.tmdbId) return;
      media[index + offset] = {
        id: item.tmdbId, media_type: item.mediaType, title: details.title, name: details.name,
        original_title: details.original_title, original_name: details.original_name,
        release_date: details.release_date, first_air_date: details.first_air_date,
        poster_path: details.poster_path ?? null, backdrop_path: details.backdrop_path ?? null,
        popularity: details.popularity, vote_average: details.vote_average, vote_count: details.vote_count,
        genre_ids: details.genre_ids || details.genres?.map(genre => genre.id), overview: details.overview,
        seenitC411: { rank: item.rank, seeders: item.seeders },
      };
    }));
  }
  const list = media.filter((entry): entry is TMDBMedia => entry !== null);
  if (list.length) return { media: list, notice: null };
  return { media: [], notice: top.items.length || top.unresolved ? 'Aucun titre du classement C411 n’a pu être relié à une fiche.' : 'Le classement C411 est vide pour le moment.' };
}
