import { tmdb } from '../shows/tmdb';
import { arrMediaLabel, seasonEpisodeTitles, type ArrLabelSource } from './arrMediaLabels';

/**
 * Source des libellés SeenIt de Programmés et Téléchargés (SEENIT-DOWNLOAD-022) : les mêmes fiches et saisons TMDB
 * fr-FR, en cache, que la fiche du titre. Module séparé pour que les TNR et le harnais la remplacent.
 */
export const tmdbArrLabelSource: ArrLabelSource = {
  media: async (tmdbId, mediaType) => {
    const result = await tmdb.getMediaDetails(tmdbId, mediaType);
    return result.ok ? arrMediaLabel(result.value, mediaType) : null;
  },
  episodes: async (tmdbId, season) => {
    const result = await tmdb.getSeasonDetails(tmdbId, season);
    return result.ok ? seasonEpisodeTitles(result.value) : null;
  },
};
