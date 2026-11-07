import { type C411Torrent, openC411Magnet } from '../../services/c411';
import { pushReleaseDirectly } from '../../services/sonarrRadarr';
import { acceptDownloadRequest, beginDownloadRequest, failDownloadRequest } from './downloadLifecycle';
import type { useDownloadConfigStore } from '../../store/downloadConfigStore';

type DownloadConfig = ReturnType<typeof useDownloadConfigStore.getState>;
type ToastKind = 'download' | 'success' | 'error' | 'info';

export interface ReleaseSend {
  config: DownloadConfig;
  torrent: C411Torrent;
  mediaType: 'movie' | 'tv';
  title: string;
  tmdbId?: number | string;
  tvdbId?: number | string;
  imdbId?: string;
  year?: number | string;
  posterPath?: string;
  season?: number;
  episode?: number;
  notify: (action: string, toastType?: ToastKind) => void;
}

/** `magnetOnly` : aucun client configuré, le lien a été remis au système (ou rien n'a pu l'ouvrir). */
export type ReleaseSendResult = { success: boolean; message: string; magnetOnly?: boolean };

/**
 * #879 — Envoi d'une version choisie à la main, partagé par la popup et la page « Version précise ».
 * Corps déplacé tel quel depuis DownloadModal : Sonarr (série) ou Radarr (film) en priorité, sinon
 * qBittorrent, sinon le lien Magnet local ; demande durable suivie du début à la fin.
 */
export async function sendReleaseToClient({ config, torrent, mediaType, title, tmdbId, tvdbId, imdbId, year, posterPath, season, episode, notify }: ReleaseSend): Promise<ReleaseSendResult> {
  const isTv = mediaType === 'tv';
  let service: 'sonarr' | 'radarr' | 'qbittorrent' | null = null;
  let url = '';
  let apiKey = '';
  let username = '';
  let password = '';

  if (isTv && config.sonarrUrl && config.sonarrApiKey) {
    service = 'sonarr';
    url = config.sonarrUrl;
    apiKey = config.sonarrApiKey;
  } else if (!isTv && config.radarrUrl && config.radarrApiKey) {
    service = 'radarr';
    url = config.radarrUrl;
    apiKey = config.radarrApiKey;
  } else if (config.qbittorrentUrl) {
    service = 'qbittorrent';
    url = config.qbittorrentUrl;
    username = config.qbittorrentUsername;
    password = config.qbittorrentPassword;
  }

  if (!service) {
    if (torrent.magnetUri) {
      const opened = await openC411Magnet(torrent.magnetUri);
      const message = opened ? 'Ouverture du client BitTorrent local…' : 'Aucun client BitTorrent ne peut ouvrir ce lien.';
      notify(message, opened ? 'info' : 'error');
      return { success: opened, message, magnetOnly: true };
    }
    notify('Aucun client de téléchargement disponible.', 'error');
    return { success: false, message: 'Aucun client de téléchargement disponible.', magnetOnly: true };
  }

  const clientLabel = service === 'sonarr' ? 'Sonarr' : service === 'radarr' ? 'Radarr' : 'qBittorrent';
  const requestId = beginDownloadRequest({
    title,
    seriesTitle: isTv ? title : undefined,
    movieTitle: !isTv ? title : undefined,
    mediaType,
    tmdbId,
    imdbId,
    seasonNumber: isTv ? season : undefined,
    episodeNumber: isTv && season !== undefined ? episode : undefined,
    posterPath,
    downloadClient: clientLabel,
    statusText: 'Demande prise en compte • préparation du téléchargement…',
    releaseTitle: torrent.name
  });

  notify('Préparation du téléchargement…', 'download');

  try {
    const result = await pushReleaseDirectly({
      service,
      url,
      apiKey,
      username,
      password,
      torrent,
      mediaType,
      mediaInfo: {
        title,
        tmdbId,
        tvdbId,
        imdbId,
        year,
        season: isTv ? season : undefined,
        episode: isTv && season !== undefined ? episode : undefined
      }
    });
    if (result.success) {
      acceptDownloadRequest(requestId, `Téléchargement accepté • mise en file d'attente`, 'queued');
      return { success: true, message: 'Téléchargement lancé.' };
    }
    failDownloadRequest(requestId, result.message);
    notify(result.message, 'error');
    return { success: false, message: result.message };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erreur lors de l'envoi de la release.";
    failDownloadRequest(requestId, message);
    notify(message, 'error');
    return { success: false, message };
  }
}
