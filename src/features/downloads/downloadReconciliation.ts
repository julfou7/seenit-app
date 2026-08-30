import type { LiveDownloadItem } from '../../services/sonarrRadarr';
import {
  canAttachRecentOptimisticRequest,
  mergeDownloadIdAliases
} from './downloadIdentity.ts';

export interface UniqueRecentOptimisticAttachment {
  requestIndex: number;
  remoteIndex: number;
}

/**
 * Retrouve les rattachements transitoires qui sont non ambigus des deux côtés.
 * C'est la même garantie introduite pour le poll en 1.4.58 : aucun titre n'est
 * comparé. Un rattachement repose uniquement sur la fenêtre temporelle, le type,
 * les IDs exacts disponibles, le scope TV et la résolution.
 */
export function findUniqueRecentOptimisticAttachments(
  requests: LiveDownloadItem[],
  remotes: LiveDownloadItem[],
  now = Date.now()
): UniqueRecentOptimisticAttachment[] {
  const candidatesByRequest = requests.map(request =>
    remotes.flatMap((remote, remoteIndex) => {
      const isTransientRemote = remote.id.startsWith('qbit_') || (!remote.tmdbId && !remote.tvdbId);
      if (!isTransientRemote || !canAttachRecentOptimisticRequest(request, remote, now)) return [];
      return [remoteIndex];
    })
  );

  return candidatesByRequest.flatMap((candidateIndexes, requestIndex) => {
    if (candidateIndexes.length !== 1) return [];
    const remoteIndex = candidateIndexes[0];
    const contenders = candidatesByRequest.filter(indexes => indexes.includes(remoteIndex));
    if (contenders.length !== 1) return [];
    return [{ requestIndex, remoteIndex }];
  });
}

/**
 * Fusionne les métadonnées d'une demande SeenIt avec un snapshot distant déjà
 * identifié. La télémétrie distante reste l'unique source de vérité, tandis que
 * le titre d'affichage SeenIt reste prioritaire une fois l'identité établie.
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
    posterPath: optimistic.posterPath || remote.posterPath,
    backdropPath: optimistic.backdropPath || remote.backdropPath,
    movieTitle: remote.mediaType === 'movie'
      ? (optimistic.movieTitle || optimistic.title || remote.movieTitle)
      : remote.movieTitle,
    seriesTitle: remote.mediaType === 'tv'
      ? (optimistic.seriesTitle || optimistic.title || remote.seriesTitle)
      : remote.seriesTitle,
    seasonNumber: remote.seasonNumber ?? optimistic.seasonNumber,
    episodeNumber: remote.episodeNumber ?? optimistic.episodeNumber,
    addedAt: remote.addedAt || optimistic.addedAt,
    downloadIdAliases: mergeDownloadIdAliases(remote, optimistic),
    isOptimistic: false,
    isRestored: false
  };
}
