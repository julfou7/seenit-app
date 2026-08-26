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
const removedDownloadIds = new Set<string>();

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
      posterPath: item.posterPath,
      backdropPath: item.backdropPath,
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
      const rawServerItems = await fetchLiveDownloadsQueue({
        sonarrUrl: config.sonarrUrl,
        sonarrApiKey: config.sonarrApiKey,
        radarrUrl: config.radarrUrl,
        radarrApiKey: config.radarrApiKey,
        qbittorrentUrl: config.qbittorrentUrl,
        qbittorrentUsername: config.qbittorrentUsername,
        qbittorrentPassword: config.qbittorrentPassword,
      });

      // Filtrer les éléments supprimés manuellement par l'utilisateur
      const serverItems = rawServerItems.filter(si => !removedDownloadIds.has(si.id));

      // 1. Nettoyer les items optimistes
      const now = Date.now();
      const currentOptimistic = currentDownloads.filter(d => d.isOptimistic && !removedDownloadIds.has(d.id));
      const validOptimistic: LiveDownloadItem[] = [];

      for (const opt of currentOptimistic) {
        const age = now - (optimisticTimestamps[opt.id] || 0);
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

        if (!matchedOnServer && age < 25000) {
          validOptimistic.push(opt);
        } else {
          delete optimisticTimestamps[opt.id];
        }
      }

      // 2. Conserver les téléchargements terminés (disparus de la file active du serveur)
      // Ils restent affichés dans "Téléchargements" jusqu'à ce que l'utilisateur clique sur la croix rouge.
      const preservedCompletedItems: LiveDownloadItem[] = [];
      for (const oldItem of currentDownloads) {
        if (removedDownloadIds.has(oldItem.id)) continue;
        if (oldItem.isOptimistic) continue;

        const existsOnServer = serverItems.some(si => si.id === oldItem.id);
        if (!existsOnServer) {
          preservedCompletedItems.push({
            ...oldItem,
            progress: 100,
            sizeleft: 0,
            status: 'completed',
            statusText: 'Téléchargement terminé 🍿',
            speedBytesPerSec: 0,
            speedFormatted: '',
            timeleft: '',
            timeleftSeconds: 0
          });
        }
      }

      // Fusionner items serveur + terminés conservés + optimistes
      const itemMap = new Map<string, LiveDownloadItem>();
      for (const item of [...serverItems, ...preservedCompletedItems, ...validOptimistic]) {
        if (!removedDownloadIds.has(item.id)) {
          itemMap.set(item.id, item);
        }
      }
      const finalItems = Array.from(itemMap.values());

      // Notifications
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
          if (!newItem && oldItem.progress > 80 && oldItem.status !== 'completed') {
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
      // Ignorer silencieusement si c'est une déconnexion ponctuelle
      set({ error: e?.message || 'Erreur réseau', isLoading: false });
    } finally {
      isFetchingInProgress = false;
    }
  },

  startPolling: (intervalMs) => {
    if (get().isPolling && pollingTimer) return;

    set({ isPolling: true });
    get().fetchDownloads();

    const scheduleNext = () => {
      if (!get().isPolling) return;
      const downloads = get().downloads;
      const hasActive = downloads.some(d => d.progress < 100 && d.status !== 'completed' && d.status !== 'error');
      const hasError = get().error !== null;

      // Fréquence adaptative : 1s si téléchargement actif (pour mise à jour de vitesse en temps réel), 8s si inactif/terminé, 15s si serveur hors ligne
      let delay = 8000;
      if (hasError) {
        delay = 15000;
      } else if (hasActive) {
        delay = intervalMs || 1000;
      }

      pollingTimer = setTimeout(async () => {
        await get().fetchDownloads();
        scheduleNext();
      }, delay);
    };

    scheduleNext();
  },

  stopPolling: () => {
    if (pollingTimer) {
      clearTimeout(pollingTimer);
      pollingTimer = null;
    }
    set({ isPolling: false });
  },

  removeDownload: async (item: LiveDownloadItem) => {
    removedDownloadIds.add(item.id);
    const config = useDownloadConfigStore.getState();
    // Suppression de la liste locale
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
      return false;
    }
  },

  clearAllDownloads: async () => {
    const current = get().downloads;
    current.forEach(item => removedDownloadIds.add(item.id));
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
