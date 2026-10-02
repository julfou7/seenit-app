import { type LiveDownloadItem } from '../../services/sonarrRadarr';
import { useLiveDownloadStore } from '../../store/liveDownloadStore';
import { auth } from '../../lib/firebase';
import { enqueueDownloadFailureNotification } from './downloadFailureNotificationClient';
import { type DownloadFailureCode } from './downloadNoRelease';

const requestOwners = new Map<string, string>();

export interface BeginDownloadRequestInput {
  title: string;
  seriesTitle?: string;
  movieTitle?: string;
  mediaType: 'tv' | 'movie';
  tmdbId?: number | string;
  tvdbId?: number | string;
  imdbId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  posterPath?: string;
  backdropPath?: string;
  downloadClient: string;
  statusText?: string;
  releaseTitle?: string;
}

export function beginDownloadRequest(input: BeginDownloadRequestInput): string {
  const id = useLiveDownloadStore.getState().addOptimisticDownload({
    title: input.title,
    seriesTitle: input.seriesTitle || (input.mediaType === 'tv' ? input.title : undefined),
    movieTitle: input.movieTitle || (input.mediaType === 'movie' ? input.title : undefined),
    mediaType: input.mediaType,
    tmdbId: input.tmdbId ? Number(input.tmdbId) : undefined,
    tvdbId: input.tvdbId ? Number(input.tvdbId) : undefined,
    imdbId: input.imdbId,
    seasonNumber: input.seasonNumber,
    episodeNumber: input.episodeNumber,
    posterPath: input.posterPath,
    backdropPath: input.backdropPath,
    downloadClient: input.downloadClient,
    progress: 0,
    status: 'submitting',
    statusText: input.statusText || `Demande prise en compte • envoi à ${input.downloadClient}…`,
    releaseTitle: input.releaseTitle || input.title,
    addedAt: Date.now(),
    isOptimistic: true,
    isRestored: false
  });
  if (auth.currentUser) requestOwners.set(id, auth.currentUser.uid);
  return id;
}

export function acceptDownloadRequest(
  id: string,
  statusText: string,
  status: 'searching' | 'queued' = 'searching'
): void {
  const ownerUid = requestOwners.get(id);
  if (ownerUid && ownerUid !== auth.currentUser?.uid) return;
  requestOwners.delete(id);
  useLiveDownloadStore.getState().updateDownloadRequest(id, {
    progress: 0,
    status,
    statusText,
    errorMessage: undefined,
    isOptimistic: true,
    isRestored: false
  });

  // Un seul moteur est autorisé à écrire dans liveDownloadStore : le polling central.
  // Cela évite les courses entre Radarr/Sonarr, qBittorrent et les anciens watchers.
  void useLiveDownloadStore.getState().fetchDownloads();
}

export function failDownloadRequest(id: string, message: string, failureCode?: DownloadFailureCode): void {
  const ownerUid = requestOwners.get(id);
  if (ownerUid && ownerUid !== auth.currentUser?.uid) return;
  useLiveDownloadStore.getState().updateDownloadRequest(id, {
    progress: 0,
    status: 'error',
    statusText: 'Impossible de lancer le téléchargement',
    errorMessage: message,
    isOptimistic: true,
    isRestored: false
  });
  const item = useLiveDownloadStore.getState().downloads.find(download => download.id === id);
  if (failureCode === 'no_release' && ownerUid && item?.status === 'error' && item.tmdbId && item.mediaType) {
    enqueueDownloadFailureNotification({
      ownerUid, requestId: item.requestId || id, failureCode,
      mediaType: item.mediaType, tmdbId: Number(item.tmdbId),
      title: (item.seriesTitle || item.movieTitle || item.title).trim().slice(0, 180),
      ...(item.seasonNumber !== undefined ? { season: item.seasonNumber } : {}),
      ...(item.episodeNumber !== undefined ? { episode: item.episodeNumber } : {})
    });
  }
  requestOwners.delete(id);
}

export function updateDownloadRequest(
  id: string,
  patch: Partial<LiveDownloadItem>
): void {
  useLiveDownloadStore.getState().updateDownloadRequest(id, patch);
}
