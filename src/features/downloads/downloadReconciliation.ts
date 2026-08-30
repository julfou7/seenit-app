import type { LiveDownloadItem } from '../../services/sonarrRadarr';
import { mergeDownloadIdAliases } from './downloadIdentity.ts';

/**
 * Fusionne une mutation optimiste arrivée pendant un poll avec un snapshot distant.
 * Le distant reste l'unique source de vérité pour progress/status/débit/ETA.
 */
export function mergeLateOptimisticMetadata(
  remote: LiveDownloadItem,
  optimistic: LiveDownloadItem
): LiveDownloadItem {
  return {
    ...remote,
    requestId: remote.requestId || optimistic.requestId || optimistic.id,
    tmdbId: remote.tmdbId || optimistic.tmdbId,
    tvdbId: remote.tvdbId || optimistic.tvdbId,
    imdbId: remote.imdbId || optimistic.imdbId,
    posterPath: remote.posterPath || optimistic.posterPath,
    backdropPath: remote.backdropPath || optimistic.backdropPath,
    movieTitle: remote.movieTitle || (remote.mediaType === 'movie'
      ? (optimistic.movieTitle || optimistic.title)
      : undefined),
    seriesTitle: remote.seriesTitle || (remote.mediaType === 'tv'
      ? (optimistic.seriesTitle || optimistic.title)
      : undefined),
    seasonNumber: remote.seasonNumber ?? optimistic.seasonNumber,
    episodeNumber: remote.episodeNumber ?? optimistic.episodeNumber,
    addedAt: remote.addedAt || optimistic.addedAt,
    downloadIdAliases: mergeDownloadIdAliases(remote, optimistic),
    isOptimistic: false,
    isRestored: false
  };
}
