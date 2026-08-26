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
  addOptimisticDownload: (item: Partial<LiveDownloadItem> & { title: string; mediaType: 'tv' | 'movie' }) => string;
  removeDownload: (item: LiveDownloadItem) => Promise<boolean>;
  clearAllDownloads: () => Promise<void>;

  getShowDownloads: (tmdbId?: number | string, tvdbId?: number | string, showTitle?: string) => LiveDownloadItem[];
  getMovieDownload: (tmdbId?: number | string, movieTitle?: string) => LiveDownloadItem | null;
  getEpisodeDownload: (tmdbId?: number | string, tvdbId?: number | string, season?: number, episode?: number) => LiveDownloadItem | null;
}

import { useToastStore } from './toastStore';

let pollingTimer: any = null;
let isFetchingInProgress = false;
const optimisticTimestamps: Record<string, number> = {};

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

  addOptimisticDownload: (item) => {
    const id = item.id || `opt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    optimisticTimestamps[id] = Date.now();

    const newItem: LiveDownloadItem = {
      id,
      mediaType: item.mediaType,
      title: item.title,
      seriesTitle: item.seriesTitle,
      movieTitle: item.movieTitle,
      tmdbId: item.tmdbId ? Number(item.tmdbId) : undefined,
      tvdbId: item.tvdbId ? Number(item.tvdbId) : undefined,
      imdbId: item.imdbId,
      seasonNumber: item.seasonNumber,
      episodeNumber: item.episodeNumber,
      size: item.size || 0,
      sizeleft: item.sizeleft || 0,
      progress: item.progress ?? 1,
      status: 'downloading',
      statusText: item.statusText || 'Lancement du téléchargement...',
      downloadClient: item.downloadClient || (item.mediaType === 'tv' ? 'Sonarr' : 'Radarr'),
      releaseTitle: item.releaseTitle || item.title,
      isOptimistic: true
    };

    set((state) => {
      // Éviter les doublons
      const exists = state.downloads.some(d => d.id === id || (d.tmdbId && d.tmdbId === newItem.tmdbId && d.seasonNumber === newItem.seasonNumber && d.episodeNumber === newItem.episodeNumber));
      if (exists) return state;
      return {
        downloads: [newItem, ...state.downloads]
      };
    });

    // Déclencher le polling à 1 seconde immédiatement
    get().startPolling(1000);
    return id;
  },

  fetchDownloads: async () => {
    if (isFetchingInProgress) return;
    const config = useDownloadConfigStore.getState();
    if (!config.sonarrUrl && !config.radarrUrl && !config.qbittorrentUrl) {
      set({ downloads: [], isLoading: false });
      return;
    }

    isFetchingInProgress = true;
    try {
      const currentDownloads = get().downloads;
      const serverItems = await fetchLiveDownloadsQueue({
        sonarrUrl: config.sonarrUrl,
        sonarrApiKey: config.sonarrApiKey,
        radarrUrl: config.radarrUrl,
        radarrApiKey: config.radarrApiKey,
        qbittorrentUrl: config.qbittorrentUrl,
        qbittorrentUsername: config.qbittorrentUsername,
        qbittorrentPassword: config.qbittorrentPassword,
      });

      // Nettoyer les items optimistes
      const now = Date.now();
      const currentOptimistic = currentDownloads.filter(d => d.isOptimistic);
      const validOptimistic: LiveDownloadItem[] = [];

      for (const opt of currentOptimistic) {
        const age = now - (optimisticTimestamps[opt.id] || 0);
        // Si le serveur a déjà renvoyé un élément correspondant, on supprime l'optimiste
        const matchedOnServer = serverItems.some(si => {
          if (opt.mediaType === 'tv' && si.mediaType === 'tv') {
            if (opt.tmdbId && si.tmdbId && Number(opt.tmdbId) === Number(si.tmdbId)) {
              if (opt.seasonNumber != null && si.seasonNumber != null) {
                return opt.seasonNumber === si.seasonNumber && (opt.episodeNumber == null || opt.episodeNumber === si.episodeNumber);
              }
              return true;
            }
          }
          if (opt.mediaType === 'movie' && si.mediaType === 'movie') {
            if (opt.tmdbId && si.tmdbId && Number(opt.tmdbId) === Number(si.tmdbId)) return true;
          }
          if (opt.title && si.title && (opt.title.toLowerCase().includes(si.title.toLowerCase()) || si.title.toLowerCase().includes(opt.title.toLowerCase()))) {
            return true;
          }
          return false;
        });

        // Si non trouvé sur le serveur et âgé de moins de 25 secondes, on le garde temporairement
        if (!matchedOnServer && age < 25000) {
          validOptimistic.push(opt);
        } else {
          delete optimisticTimestamps[opt.id];
        }
      }

      // Fusionner les items réels du serveur + les optimistes récents
      const finalItems = [...serverItems, ...validOptimistic];

      // Vérifier les notifications de téléchargements terminés et démarrés
      if (currentDownloads.length > 0) {
        serverItems.forEach(newItem => {
          const wasPresent = currentDownloads.find(oldItem => oldItem.id === newItem.id);
          if (!wasPresent && newItem.progress < 100 && !newItem.isOptimistic) {
            sendLocalNotification('Nouveau téléchargement', `Le téléchargement de "${newItem.title}" a démarré.`, false);
          }
        });

        currentDownloads.forEach(oldItem => {
          if (oldItem.isOptimistic) return;
          const newItem = serverItems.find(it => it.id === oldItem.id);
          if (!newItem && oldItem.progress > 80) {
            sendLocalNotification('Téléchargement terminé 🍿', `Le téléchargement de "${oldItem.title}" est terminé !`, true);
          } else if (newItem && newItem.progress === 100 && oldItem.progress < 100) {
            sendLocalNotification('Téléchargement terminé 🍿', `Le téléchargement de "${newItem.title}" est terminé !`, true);
          }
        });
      }

      set({
        downloads: finalItems,
        isLoading: false,
        lastUpdated: Date.now(),
        error: null,
      });
    } catch (e: any) {
      console.warn('[LiveDownloadStore] Erreur lors de la mise à jour:', e);
      set({ error: e?.message || 'Erreur réseau', isLoading: false });
    } finally {
      isFetchingInProgress = false;
    }
  },

  startPolling: (intervalMs = 1000) => {
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
