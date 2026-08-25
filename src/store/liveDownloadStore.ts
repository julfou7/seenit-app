import { create } from 'zustand';
import { useDownloadConfigStore } from './downloadConfigStore';
import { fetchLiveDownloadsQueue, LiveDownloadItem, matchShowDownload, matchMovieDownload } from '../services/sonarrRadarr';

interface LiveDownloadState {
  downloads: LiveDownloadItem[];
  isLoading: boolean;
  lastUpdated: number | null;
  error: string | null;
  isPolling: boolean;
  
  fetchDownloads: () => Promise<void>;
  startPolling: (intervalMs?: number) => void;
  stopPolling: () => void;

  getShowDownloads: (tmdbId?: number | string, tvdbId?: number | string, showTitle?: string) => LiveDownloadItem[];
  getMovieDownload: (tmdbId?: number | string, movieTitle?: string) => LiveDownloadItem | null;
  getEpisodeDownload: (tmdbId?: number | string, tvdbId?: number | string, season?: number, episode?: number) => LiveDownloadItem | null;
}

let pollingTimer: any = null;

export const useLiveDownloadStore = create<LiveDownloadState>((set, get) => ({
  downloads: [],
  isLoading: false,
  lastUpdated: null,
  error: null,
  isPolling: false,

  fetchDownloads: async () => {
    const config = useDownloadConfigStore.getState();
    if (!config.sonarrUrl && !config.radarrUrl && !config.qbittorrentUrl) {
      set({ downloads: [], isLoading: false });
      return;
    }

    try {
      const items = await fetchLiveDownloadsQueue({
        sonarrUrl: config.sonarrUrl,
        sonarrApiKey: config.sonarrApiKey,
        radarrUrl: config.radarrUrl,
        radarrApiKey: config.radarrApiKey,
        qbittorrentUrl: config.qbittorrentUrl,
        qbittorrentUsername: config.qbittorrentUsername,
        qbittorrentPassword: config.qbittorrentPassword,
      });

      set({
        downloads: items,
        isLoading: false,
        lastUpdated: Date.now(),
        error: null,
      });
    } catch (e: any) {
      console.warn('[LiveDownloadStore] Erreur lors de la mise à jour:', e);
      set({ error: e?.message || 'Erreur réseau', isLoading: false });
    }
  },

  startPolling: (intervalMs = 4000) => {
    if (get().isPolling && pollingTimer) return;

    set({ isPolling: true });
    get().fetchDownloads();

    pollingTimer = setInterval(() => {
      get().fetchDownloads();
    }, intervalMs);
  },

  stopPolling: () => {
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
    set({ isPolling: false });
  },

  getShowDownloads: (tmdbId, tvdbId, showTitle) => {
    const all = get().downloads;
    return all.filter(item => matchShowDownload(item, tmdbId, tvdbId, showTitle));
  },

  getMovieDownload: (tmdbId, movieTitle) => {
    const all = get().downloads;
    return all.find(item => matchMovieDownload(item, tmdbId, movieTitle)) || null;
  },

  getEpisodeDownload: (tmdbId, tvdbId, season, episode) => {
    const showItems = get().getShowDownloads(tmdbId, tvdbId);
    if (!showItems.length) return null;
    if (season !== undefined && episode !== undefined) {
      return showItems.find(it => it.seasonNumber === season && it.episodeNumber === episode) || showItems[0] || null;
    }
    return showItems[0] || null;
  }
}));
