import { create } from 'zustand';
import { useDownloadConfigStore } from './downloadConfigStore';
import { fetchLiveDownloadsQueue, LiveDownloadItem, matchShowDownload, matchMovieDownload, deleteLiveDownloadItem } from '../services/sonarrRadarr';
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
  removeDownload: (item: LiveDownloadItem) => Promise<boolean>;
  clearAllDownloads: () => Promise<void>;

  getShowDownloads: (tmdbId?: number | string, tvdbId?: number | string, showTitle?: string) => LiveDownloadItem[];
  getMovieDownload: (tmdbId?: number | string, movieTitle?: string) => LiveDownloadItem | null;
  getEpisodeDownload: (tmdbId?: number | string, tvdbId?: number | string, season?: number, episode?: number) => LiveDownloadItem | null;
}

import { useToastStore } from './toastStore';

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

function sendLocalNotification(title: string, body: string, isSuccess: boolean = false) {
  // Always trigger in-app toast for instantaneous feedback
  try {
    useToastStore.getState().showToast(`${title}: ${body}`, isSuccess ? 'success' : 'info');
  } catch (e) {}

  if (!Capacitor.isNativePlatform()) {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        try { new Notification(title, { body }); } catch (e) {}
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
          if (permission === 'granted') {
            try { new Notification(title, { body }); } catch (e) {}
          }
        });
      }
    }
    return;
  }

  checkAndRequestNotificationPermission().then((granted) => {
    if (granted) {
      try {
        // Android requires 32-bit integer IDs (max 2^31 - 1)
        const notificationId = Math.floor(Math.random() * 2000000000) + 1;
        LocalNotifications.schedule({
          notifications: [
            {
              title: title,
              body: body,
              id: notificationId,
              schedule: { at: new Date(Date.now() + 200) },
              sound: undefined,
              actionTypeId: '',
              extra: null
            }
          ]
        });
      } catch (err) {
        console.warn('[Notifications] Error scheduling local notification:', err);
      }
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
            sendLocalNotification('Nouveau téléchargement', `Le téléchargement de "${newItem.title}" a démarré.`, false);
          }
        });

        // Téléchargements terminés
        currentDownloads.forEach(oldItem => {
          const newItem = items.find(it => it.id === oldItem.id);
          // Si l'item a disparu de la liste ou a atteint 100% alors qu'il n'y était pas avant
          if (!newItem && oldItem.progress > 80) { // On s'assure qu'il était proche de la fin pour éviter les faux positifs d'annulation
            sendLocalNotification('Téléchargement terminé 🍿', `Le téléchargement de "${oldItem.title}" est terminé !`, true);
          } else if (newItem && newItem.progress === 100 && oldItem.progress < 100) {
            sendLocalNotification('Téléchargement terminé 🍿', `Le téléchargement de "${newItem.title}" est terminé !`, true);
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

  removeDownload: async (item: LiveDownloadItem) => {
    const config = useDownloadConfigStore.getState();
    // Suppression optimiste de la liste locale
    set({ downloads: get().downloads.filter(d => d.id !== item.id) });
    
    try {
      const res = await deleteLiveDownloadItem(item, {
        sonarrUrl: config.sonarrUrl,
        sonarrApiKey: config.sonarrApiKey,
        radarrUrl: config.radarrUrl,
        radarrApiKey: config.radarrApiKey,
        qbittorrentUrl: config.qbittorrentUrl,
        qbittorrentUsername: config.qbittorrentUsername,
        qbittorrentPassword: config.qbittorrentPassword,
      });
      return res.success;
    } catch (e) {
      console.warn('[LiveDownloadStore] Erreur suppression item:', e);
      return false;
    }
  },

  clearAllDownloads: async () => {
    const current = get().downloads;
    const config = useDownloadConfigStore.getState();
    set({ downloads: [] });

    for (const item of current) {
      try {
        await deleteLiveDownloadItem(item, {
          sonarrUrl: config.sonarrUrl,
          sonarrApiKey: config.sonarrApiKey,
          radarrUrl: config.radarrUrl,
          radarrApiKey: config.radarrApiKey,
          qbittorrentUrl: config.qbittorrentUrl,
          qbittorrentUsername: config.qbittorrentUsername,
          qbittorrentPassword: config.qbittorrentPassword,
        });
      } catch {}
    }
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
