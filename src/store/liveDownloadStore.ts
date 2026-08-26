import { create } from 'zustand';
import { useDownloadConfigStore } from './downloadConfigStore';
import { fetchLiveDownloadsQueue, LiveDownloadItem, matchShowDownload, matchMovieDownload } from '../services/sonarrRadarr';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';

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

async function checkAndRequestNotificationPermission() {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    let permStatus = await LocalNotifications.checkPermissions();
    if (permStatus.display !== 'granted') {
      permStatus = await LocalNotifications.requestPermissions();
    }
    return permStatus.display === 'granted';
  } catch (e) {
    return false;
  }
}

function sendLocalNotification(title: string, body: string) {
  if (!Capacitor.isNativePlatform()) {
    if (window.Notification && Notification.permission === 'granted') {
      new Notification(title, { body: body });
    } else if (window.Notification && Notification.permission !== 'denied') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          new Notification(title, { body: body });
        }
      });
    }
    return;
  }

  checkAndRequestNotificationPermission().then((granted) => {
    if (granted) {
      LocalNotifications.schedule({
        notifications: [
          {
            title: title,
            body: body,
            id: new Date().getTime(),
            schedule: { at: new Date(Date.now() + 1000) },
            actionTypeId: '',
            extra: null
          }
        ]
      });
    }
  });
}

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
      const currentDownloads = get().downloads;
      const items = await fetchLiveDownloadsQueue({
        sonarrUrl: config.sonarrUrl,
        sonarrApiKey: config.sonarrApiKey,
        radarrUrl: config.radarrUrl,
        radarrApiKey: config.radarrApiKey,
        qbittorrentUrl: config.qbittorrentUrl,
        qbittorrentUsername: config.qbittorrentUsername,
        qbittorrentPassword: config.qbittorrentPassword,
      });

      // Vérifier les téléchargements terminés et démarrés
      if (currentDownloads.length > 0) {
        // Nouveaux téléchargements (présents dans items mais pas dans currentDownloads)
        items.forEach(newItem => {
          const wasPresent = currentDownloads.find(oldItem => oldItem.id === newItem.id);
          if (!wasPresent && newItem.progress < 100) {
            sendLocalNotification('Nouveau téléchargement', `Le téléchargement de "${newItem.title}" a démarré.`);
          }
        });

        // Téléchargements terminés
        currentDownloads.forEach(oldItem => {
          const newItem = items.find(it => it.id === oldItem.id);
          // Si l'item a disparu de la liste ou a atteint 100% alors qu'il n'y était pas avant
          if (!newItem && oldItem.progress > 80) { // On s'assure qu'il était proche de la fin pour éviter les faux positifs d'annulation
            sendLocalNotification('Téléchargement terminé', `Le téléchargement de "${oldItem.title}" est terminé !`);
          } else if (newItem && newItem.progress === 100 && oldItem.progress < 100) {
            sendLocalNotification('Téléchargement terminé', `Le téléchargement de "${newItem.title}" est terminé !`);
          }
        });
      }

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

  startPolling: (intervalMs = 2000) => {
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
