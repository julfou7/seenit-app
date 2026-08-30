import { type LiveDownloadItem } from '../../services/sonarrRadarr';
import { useLiveDownloadStore } from '../../store/liveDownloadStore';

export interface BeginDownloadRequestInput {
  title: string;
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
  return useLiveDownloadStore.getState().addOptimisticDownload({
    title: input.title,
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
}

export function acceptDownloadRequest(
  id: string,
  statusText: string,
  status: 'searching' | 'queued' = 'searching'
): void {
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

export function failDownloadRequest(id: string, message: string): void {
  useLiveDownloadStore.getState().updateDownloadRequest(id, {
    progress: 0,
    status: 'error',
    statusText: 'Impossible de lancer le téléchargement',
    errorMessage: message,
    isOptimistic: true,
    isRestored: false
  });
}

export function updateDownloadRequest(
  id: string,
  patch: Partial<LiveDownloadItem>
): void {
  useLiveDownloadStore.getState().updateDownloadRequest(id, patch);
}
