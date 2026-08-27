import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useDownloadConfigStore } from './downloadConfigStore';
import { fetchLiveDownloadsQueue, LiveDownloadItem, matchShowDownload, matchMovieDownload, deleteLiveDownloadItem, extractQualityFromTitle } from '../services/sonarrRadarr';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { useToastStore } from './toastStore';
import { useShowsStore } from './showsStore';

interface LiveDownloadState {
  downloads: LiveDownloadItem[];
  removedIds: string[];
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

let pollingTimer: any = null;
let isFetchingInProgress = false;
let lastFetchTime = 0;
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

function normalizeTitleForMatch(str?: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/\(\d{4}\)/g, '')
    .replace(/s\d{1,2}e\d{1,2}.*/gi, '')
    .split(':')[0]
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function sendLocalNotification(title: string, body: string, isSuccess: boolean = false) {
  // Always trigger in-app toast for instantaneous feedback
  try {
    useToastStore.getState().showToast(`${title}: ${body}`, isSuccess ? 'success' : 'download');
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

export const useLiveDownloadStore = create<LiveDownloadState>()(
  persist(
    (set, get) => ({
      downloads: [],
      removedIds: [],
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
          const exists = state.downloads.some(d => d.id === id || (d.tmdbId && d.tmdbId === newItem.tmdbId && d.seasonNumber === newItem.seasonNumber && d.episodeNumber === newItem.episodeNumber));
          if (exists) return state;
          return {
            downloads: [newItem, ...state.downloads]
          };
        });

        get().startPolling(1000);
        return id;
      },

      fetchDownloads: async () => {
        const nowTime = Date.now();
        if (isFetchingInProgress && (nowTime - lastFetchTime < 7000)) {
          return;
        }
        const config = useDownloadConfigStore.getState();
        if (!config.sonarrUrl && !config.radarrUrl && !config.qbittorrentUrl) {
          set({ isLoading: false });
          return;
        }

        isFetchingInProgress = true;
        lastFetchTime = nowTime;

        try {
          const currentDownloads = get().downloads || [];
          const removedSet = new Set(get().removedIds || []);

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
          const serverItems = rawServerItems.filter(si => !removedSet.has(si.id));

          // Conserver les affiches, métadonnées et la progression maximale
          const localShows = useShowsStore.getState().shows || [];

          serverItems.forEach(si => {
            const match = currentDownloads.find(d => {
              if (d.id === si.id) return true;
              if (d.tmdbId && si.tmdbId && Number(d.tmdbId) === Number(si.tmdbId)) return true;
              if (d.tvdbId && si.tvdbId && Number(d.tvdbId) === Number(si.tvdbId)) return true;
              const normD = normalizeTitleForMatch(d.title || d.seriesTitle || d.movieTitle);
              const normSi = normalizeTitleForMatch(si.title || si.seriesTitle || si.movieTitle || si.releaseTitle);
              return Boolean(normD && normSi && (normD === normSi || normD.includes(normSi) || normSi.includes(normD)));
            });

            if (match) {
              if (!si.posterPath && match.posterPath) si.posterPath = match.posterPath;
              if (!si.tmdbId && match.tmdbId) si.tmdbId = match.tmdbId;
              if (!si.tvdbId && match.tvdbId) si.tvdbId = match.tvdbId;
              if (!si.backdropPath && match.backdropPath) si.backdropPath = match.backdropPath;
              if (!si.quality && match.quality) si.quality = match.quality;

              // Protection contre les baisses de progression (ex: 99% -> 77% pendant l'import)
              if (match.progress >= 98 && si.progress < 98 && si.status !== 'completed' && si.status !== 'error') {
                si.progress = match.progress;
              } else if (match.progress > si.progress && si.status !== 'completed' && si.status !== 'error') {
                si.progress = Math.max(match.progress, si.progress);
              }

              if (match.status === 'completed' || si.progress >= 100) {
                si.progress = 100;
                si.status = 'completed';
                si.statusText = 'Téléchargement terminé 🍿';
                si.sizeleft = 0;
              }
            }

            // Recherche du poster dans la bibliothèque SeenIt locale
            if (!si.posterPath && localShows.length > 0) {
              const matchedShow = localShows.find(s => {
                if (si.tmdbId && Number(s.tmdbId) === Number(si.tmdbId)) return true;
                const normShow = normalizeTitleForMatch(s.title);
                const normSi = normalizeTitleForMatch(si.title || si.seriesTitle || si.movieTitle || si.releaseTitle);
                return Boolean(normShow && normSi && (normShow === normSi || normShow.includes(normSi) || normSi.includes(normShow)));
              });

              if (matchedShow) {
                if (matchedShow.posterPath) si.posterPath = matchedShow.posterPath;
                if (matchedShow.backdropPath && !si.backdropPath) si.backdropPath = matchedShow.backdropPath;
                if (matchedShow.tmdbId && !si.tmdbId) si.tmdbId = Number(matchedShow.tmdbId);
              }
            }

            if (!si.quality) {
              si.quality = extractQualityFromTitle(si.releaseTitle || si.title);
            }
          });

          // 1. Nettoyer les items optimistes
          const now = Date.now();
          const currentOptimistic = currentDownloads.filter(d => d.isOptimistic && !removedSet.has(d.id));
          const validOptimistic: LiveDownloadItem[] = [];

          for (const opt of currentOptimistic) {
            const age = now - (optimisticTimestamps[opt.id] || 0);
            const normOpt = normalizeTitleForMatch(opt.title || opt.movieTitle || opt.seriesTitle);

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
              if (opt.tvdbId && si.tvdbId && Number(opt.tvdbId) === Number(si.tvdbId)) return true;
              
              const normSi = normalizeTitleForMatch(si.title || si.seriesTitle || si.movieTitle || si.releaseTitle);
              if (normOpt && normSi && (normOpt === normSi || normOpt.includes(normSi) || normSi.includes(normOpt))) {
                return true;
              }
              return false;
            });

            if (!matchedOnServer && age < 15000) {
              validOptimistic.push(opt);
            } else {
              delete optimisticTimestamps[opt.id];
            }
          }

          // 2. Conserver les téléchargements terminés ou précédemment enregistrés
          const preservedCompletedItems: LiveDownloadItem[] = [];
          for (const oldItem of currentDownloads) {
            if (removedSet.has(oldItem.id)) continue;
            if (oldItem.isOptimistic) continue;

            // Vérifier si un élément pour ce même média exact existe déjà sur le serveur
            const existsOnServer = serverItems.some(si => {
              if (si.id === oldItem.id) return true;
              
              if (oldItem.tmdbId && si.tmdbId && Number(oldItem.tmdbId) === Number(si.tmdbId)) {
                if (oldItem.mediaType === 'tv' && si.mediaType === 'tv') {
                  if (oldItem.seasonNumber != null && si.seasonNumber != null) {
                    return oldItem.seasonNumber === si.seasonNumber && oldItem.episodeNumber === si.episodeNumber;
                  }
                }
                return true;
              }
              if (oldItem.tvdbId && si.tvdbId && Number(oldItem.tvdbId) === Number(si.tvdbId)) {
                 if (oldItem.mediaType === 'tv' && si.mediaType === 'tv') {
                  if (oldItem.seasonNumber != null && si.seasonNumber != null) {
                    return oldItem.seasonNumber === si.seasonNumber && oldItem.episodeNumber === si.episodeNumber;
                  }
                }
                return true;
              }
              
              const normOld = normalizeTitleForMatch(oldItem.title || oldItem.movieTitle || oldItem.seriesTitle);
              const normSi = normalizeTitleForMatch(si.title || si.movieTitle || si.seriesTitle || si.releaseTitle);
              if (normOld && normSi && (normOld === normSi || normOld.includes(normSi) || normSi.includes(normOld))) {
                return true;
              }
              return false;
            });
            
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
            if (!removedSet.has(item.id)) {
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
          set({ error: e?.message || 'Erreur réseau', isLoading: false });
        } finally {
          isFetchingInProgress = false;
        }
      },

      startPolling: (intervalMs) => {
        if (pollingTimer) {
          clearTimeout(pollingTimer);
          pollingTimer = null;
        }

        set({ isPolling: true });
        get().fetchDownloads();

        const scheduleNext = () => {
          if (!get().isPolling) return;
          const downloads = get().downloads || [];
          const hasActive = downloads.some(d => d.progress < 100 && d.status !== 'completed' && d.status !== 'error');
          const hasError = get().error !== null;

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
        const currentRemoved = get().removedIds || [];
        const newRemoved = Array.from(new Set([...currentRemoved, item.id]));
        const config = useDownloadConfigStore.getState();

        set({
          removedIds: newRemoved,
          downloads: (get().downloads || []).filter(d => d.id !== item.id)
        });
        
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
        const current = get().downloads || [];
        const currentRemoved = get().removedIds || [];
        const newRemoved = Array.from(new Set([...currentRemoved, ...current.map(item => item.id)]));
        const config = useDownloadConfigStore.getState();

        set({
          removedIds: newRemoved,
          downloads: []
        });

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
        const all = get().downloads || [];
        return all.filter(item => matchShowDownload(item, tmdbId, tvdbId, showTitle));
      },

      getMovieDownload: (tmdbId, movieTitle) => {
        const all = get().downloads || [];
        return all.find(item => matchMovieDownload(item, tmdbId, movieTitle)) || null;
      },

      getEpisodeDownload: (tmdbId, tvdbId, season, episode) => {
        const showItems = get().getShowDownloads(tmdbId, tvdbId);
        if (!showItems.length) return null;
        if (season !== undefined && episode !== undefined) {
          // Si on a les deux, chercher spécifiquement l'épisode, SINON la saison entière, SINON le show entier
          return showItems.find(it => it.seasonNumber === season && it.episodeNumber === episode)
              || showItems.find(it => it.seasonNumber === season && it.episodeNumber === undefined)
              || showItems.find(it => it.seasonNumber === undefined)
              || null;
        }
        if (season !== undefined) {
          // Si on a que la saison, chercher la saison entière, SINON le show entier
          return showItems.find(it => it.seasonNumber === season && it.episodeNumber === undefined)
              || showItems.find(it => it.seasonNumber === undefined)
              || null;
        }
        return showItems.find(it => it.seasonNumber === undefined) || null;
      }
    }),
    {
      name: 'seenit_live_downloads_v2',
      partialize: (state) => ({
        downloads: state.downloads,
        removedIds: state.removedIds
      })
    }
  )
);

// Écouteurs de reprise au premier plan (Foreground resume)
if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      useLiveDownloadStore.getState().startPolling(1000);
    }
  });
}

if (Capacitor.isNativePlatform()) {
  try {
    CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        useLiveDownloadStore.getState().startPolling(1000);
      }
    });
  } catch (e) {}
}

