import type { LiveDownloadItem } from '../../services/sonarrRadarrLive';
import type { ArrDownloadLaunch } from './downloadLaunch';

/**
 * #664 — retour du propriétaire du 15/11 : « un bouton retry pour forcer la nouvelle tentative ». Une demande en
 * attente de disponibilité se relance par le même chemin qu'un lancement depuis la fiche : même identité TMDB, même
 * périmètre (film, saison ou épisode), même qualité. La nouvelle demande prend la place de l'attente (même
 * périmètre) ; si rien n'est trouvé, l'attente revient avec la raison exacte (aucune version, disque plein…).
 * Sans identité TMDB, rien n'est relancé : jamais de recherche par titre.
 */
export function waitingRetryLaunch(item: LiveDownloadItem): Omit<ArrDownloadLaunch, 'config' | 'notify'> | null {
  if (item.status !== 'waiting' || !(Number(item.tmdbId) > 0)) return null;
  const isTv = item.mediaType === 'tv';
  const season = isTv && Number.isFinite(item.seasonNumber) ? Number(item.seasonNumber) : undefined;
  return {
    mediaType: item.mediaType,
    title: (isTv ? item.seriesTitle : item.movieTitle) || item.title,
    tmdbId: item.tmdbId,
    tvdbId: item.tvdbId,
    imdbId: item.imdbId,
    posterPath: item.posterPath,
    season,
    episode: season !== undefined && Number.isFinite(item.episodeNumber) ? Number(item.episodeNumber) : undefined,
    qualityPreference: /4k|2160/i.test(item.quality || '') ? '4k' : '1080p',
  };
}
