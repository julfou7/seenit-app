import { tmdb, type TMDBMedia } from '../shows/tmdb';
import { getC411Top, type C411TopItem } from '../../services/c411';
import { auth } from '../../lib/firebase';

/** Catégorie d'Explorer (SEENIT-C411-004, #900), proposée sous le réglage Téléchargements avec une clé C411. */
export const TOP_C411_CATEGORY = 'Top C411';
const DETAIL_CONCURRENCY = 6;

type MediaDetails = TMDBMedia & { genres?: Array<{ id: number }> };

const CACHE_MS = 10 * 60_000;
type C411TopPage = { media: TMDBMedia[]; notice: string | null; hasMore: boolean; failed?: boolean };
const pageCache = new Map<string, { at: number; value: C411TopPage }>();

/**
 * Titres du Top C411 en cartes d'Explorer : chaque fiche est lue chez TMDB par l'identifiant exact fourni par
 * C411 (jamais par titre) ; une fiche introuvable est écartée sans décaler les autres rangs. Une panne C411 ou un
 * classement sans fiche rattachable donne un message, jamais une liste vide muette.

 *
 * Retour terrain du 08/11 (v1.4.279 : « 27 résultats, d'un coup après 10 s ») : une page C411 par page
 * d'Explorer, chargée au défilement ; une page déjà lue revient instantanément pendant 10 minutes.
 */
export async function loadC411TopMedia(page = 1, isCurrent: () => boolean = () => true, load: typeof getC411Top = getC411Top): Promise<C411TopPage> {
  const key = `${auth.currentUser?.uid || ''}:${page}`;
  const cached = pageCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  let top: { items: C411TopItem[]; unresolved: number; hasMore: boolean };
  try {
    top = await load('videos', page);
  } catch (error: unknown) {
    // Revue Codex (#917) : une page en échec n'est ni mise en cache ni confondue avec la fin du classement.
    return { media: [], notice: error instanceof Error && error.message ? error.message : 'Classement C411 indisponible.', hasMore: false, failed: true };
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
  const value = list.length || page > 1 ? { media: list, notice: null, hasMore: top.hasMore }
    : { media: [], notice: top.items.length || top.unresolved ? 'Aucun titre du classement C411 n’a pu être relié à une fiche.' : 'Le classement C411 est vide pour le moment.', hasMore: top.hasMore };
  if (isCurrent()) pageCache.set(key, { at: Date.now(), value });
  return value;
}
