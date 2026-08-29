import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { onAuthStateChanged } from 'firebase/auth';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { useDownloadConfigStore } from './downloadConfigStore';
import {
  fetchLiveDownloadsQueue,
  type LiveDownloadItem,
  matchShowDownload,
  matchMovieDownload,
  deleteLiveDownloadItem,
  extractQualityFromTitle
} from '../services/sonarrRadarr';
import { useToastStore } from './toastStore';
import { useShowsStore } from './showsStore';
import { auth } from '../lib/firebase';

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
  updateDownloadRequest: (id: string, patch: Partial<LiveDownloadItem>) => void;
  removeDownload: (item: LiveDownloadItem) => Promise<boolean>;
  clearAllDownloads: () => Promise<void>;

  getShowDownloads: (tmdbId?: number | string, tvdbId?: number | string, showTitle?: string) => LiveDownloadItem[];
  getMovieDownload: (tmdbId?: number | string, movieTitle?: string) => LiveDownloadItem | null;
  getEpisodeDownload: (tmdbId?: number | string, tvdbId?: number | string, season?: number, episode?: number) => LiveDownloadItem | null;
}

let pollingTimer: ReturnType<typeof setTimeout> | null = null;
let pollingIntervalMs = 1000;
let isFetchingInProgress = false;
let lastFetchTime = 0;
let activeScopedUid: string | null = null;

const optimisticTimestamps: Record<string, number> = {};
const missingSince: Record<string, number> = {};
const OPTIMISTIC_TTL_MS = 120_000;
const OPTIMISTIC_ERROR_TTL_MS = 60_000;
const MISSING_WARNING_DELAY_MS = 30_000;

async function checkAndRequestNotificationPermission() {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    let permStatus = await LocalNotifications.checkPermissions();
    if (permStatus.display !== 'granted') {
      permStatus = await LocalNotifications.requestPermissions();
    }
    return permStatus.display === 'granted';
  } catch {
    return false;
  }
}

function normalizeTitleForMatch(str?: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(\d{4}\)/g, '')
    .replace(/s\d{1,2}e\d{1,2}.*/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function sameDownloadIdentity(a: LiveDownloadItem, b: LiveDownloadItem): boolean {
  if (a.id === b.id) return true;
  if (a.mediaType !== b.mediaType) return false;

  if (a.tmdbId && b.tmdbId && Number(a.tmdbId) === Number(b.tmdbId)) {
    if (a.mediaType === 'tv') {
      if (a.seasonNumber != null && b.seasonNumber != null && a.seasonNumber !== b.seasonNumber) return false;
      if (a.episodeNumber != null && b.episodeNumber != null && a.episodeNumber !== b.episodeNumber) return false;
    }
    return true;
  }

  if (a.tvdbId && b.tvdbId && Number(a.tvdbId) === Number(b.tvdbId)) {
    if (a.mediaType === 'tv') {
      if (a.seasonNumber != null && b.seasonNumber != null && a.seasonNumber !== b.seasonNumber) return false;
      if (a.episodeNumber != null && b.episodeNumber != null && a.episodeNumber !== b.episodeNumber) return false;
    }
    return true;
  }

  const aTitle = normalizeTitleForMatch(a.title || a.seriesTitle || a.movieTitle || a.releaseTitle);
  const bTitle = normalizeTitleForMatch(b.title || b.seriesTitle || b.movieTitle || b.releaseTitle);
  return Boolean(aTitle && bTitle && aTitle === bTitle);
}

function sendLocalNotification(title: string, body: string, isSuccess = false) {
  try {
    useToastStore.getState().showToast(`${title}: ${body}`, isSuccess ? 'success' : 'download');
  } catch {}

  if (!Capacitor.isNativePlatform()) {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        try { new Notification(title, { body }); } catch {}
      }
    }
    return;
  }

  checkAndRequestNotificationPermission().then((granted) => {
    if (!granted) return;
    try {
      LocalNotifications.schedule({
        notifications: [{
          title,
          body,
          id: Math.floor(Math.random() * 2_000_000_000) + 1,
          schedule: { at: new Date(Date.now() + 200) },
          sound: undefined,
          actionTypeId: '',
          extra: null
        }]
      });
    } catch (error) {
      console.warn('[Notifications] Impossible de planifier la notification:', error);
    }
  });
}

function clearPollingTimer() {
  if (pollingTimer) {
    clearTimeout(pollingTimer);
    pollingTimer = null;
  }
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
        const candidate: LiveDownloadItem = {
          id: item.id || `opt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
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
          progress: item.progress ?? 0,
          status: item.status || 'submitting',
          statusText: item.statusText || 'Demande prise en compte…',
          errorMessage: item.errorMessage,
          downloadClient: item.downloadClient || (item.mediaType === 'tv' ? 'Sonarr' : 'Radarr'),
          releaseTitle: item.releaseTitle || item.title,
          isOptimistic: true
        };

        const existing = get().downloads.find(download =>
          download.status !== 'completed' &&
          download.status !== 'error' &&
          sameDownloadIdentity(download, candidate)
        );

        if (existing) {
          optimisticTimestamps[existing.id] = Date.now();
          set(state => ({
            downloads: state.downloads.map(download =>
              download.id === existing.id
                ? {
                    ...download,
                    ...candidate,
                    id: existing.id,
                    posterPath: candidate.posterPath || download.posterPath,
                    isOptimistic: true
                  }
                : download
            )
          }));
          if (!get().isPolling) get().startPolling(1000);
          else void get().fetchDownloads();
          return existing.id;
        }

        optimisticTimestamps[candidate.id] = Date.now();
        set(state => ({ downloads: [candidate, ...state.downloads] }));

        if (!get().isPolling) get().startPolling(1000);
        else void get().fetchDownloads();
        return candidate.id;
      },

      updateDownloadRequest: (id, patch) => {
        const existing = get().downloads.find(download => download.id === id);
        if (existing?.isOptimistic || patch.isOptimistic) {
          optimisticTimestamps[id] = Date.now();
        }

        set(state => ({
          downloads: state.downloads.map(download =>
            download.id === id ? { ...download, ...patch, id: download.id } : download
          )
        }));
      },

      fetchDownloads: async () => {
        const nowTime = Date.now();
        if (isFetchingInProgress && nowTime - lastFetchTime < 7000) return;

        const config = useDownloadConfigStore.getState();
        const hasAnyClient = Boolean(
          (config.sonarrUrl && config.sonarrApiKey) ||
          (config.radarrUrl && config.radarrApiKey) ||
          config.qbittorrentUrl
        );

        if (!hasAnyClient) {
          set({ isLoading: false, error: null });
          return;
        }

        isFetchingInProgress = true;
        lastFetchTime = nowTime;

        try {
          const currentDownloads = get().downloads || [];
          const rawServerItems = await fetchLiveDownloadsQueue({
            sonarrUrl: config.sonarrUrl,
            sonarrApiKey: config.sonarrApiKey,
            radarrUrl: config.radarrUrl,
            radarrApiKey: config.radarrApiKey,
            qbittorrentUrl: config.qbittorrentUrl,
            qbittorrentUsername: config.qbittorrentUsername,
            qbittorrentPassword: config.qbittorrentPassword
          });

          // Un ID supprimé n'est masqué que tant qu'il existe encore réellement côté client.
          const rawIds = new Set(rawServerItems.map(item => item.id));
          const prunedRemovedIds = (get().removedIds || []).filter(id => rawIds.has(id));
          const removedSet = new Set(prunedRemovedIds);
          const serverItems = rawServerItems.filter(item => !removedSet.has(item.id));
          const localShows = useShowsStore.getState().shows || [];

          serverItems.forEach(serverItem => {
            delete missingSince[serverItem.id];

            const localMatch = currentDownloads.find(current => sameDownloadIdentity(current, serverItem));
            if (localMatch) {
              if (!serverItem.posterPath && localMatch.posterPath) serverItem.posterPath = localMatch.posterPath;
              if (!serverItem.backdropPath && localMatch.backdropPath) serverItem.backdropPath = localMatch.backdropPath;
              if (!serverItem.tmdbId && localMatch.tmdbId) serverItem.tmdbId = localMatch.tmdbId;
              if (!serverItem.tvdbId && localMatch.tvdbId) serverItem.tvdbId = localMatch.tvdbId;
              if (!serverItem.quality && localMatch.quality) serverItem.quality = localMatch.quality;
            }

            if (!serverItem.posterPath && localShows.length > 0) {
              const matchedShow = localShows.find(show => {
                if (serverItem.tmdbId && Number(show.tmdbId) === Number(serverItem.tmdbId)) return true;
                const showTitle = normalizeTitleForMatch(show.title);
                const downloadTitle = normalizeTitleForMatch(
                  serverItem.title || serverItem.seriesTitle || serverItem.movieTitle || serverItem.releaseTitle
                );
                return Boolean(showTitle && downloadTitle && showTitle === downloadTitle);
              });

              if (matchedShow) {
                serverItem.posterPath = matchedShow.posterPath || serverItem.posterPath;
                serverItem.backdropPath = matchedShow.backdropPath || serverItem.backdropPath;
                if (!serverItem.tmdbId && matchedShow.tmdbId) serverItem.tmdbId = Number(matchedShow.tmdbId);
              }
            }

            if (!serverItem.quality) {
              serverItem.quality = extractQualityFromTitle(serverItem.releaseTitle || serverItem.title);
            }

            if (serverItem.progress >= 100 || serverItem.status === 'completed') {
              serverItem.progress = 100;
              serverItem.status = 'completed';
              serverItem.statusText = 'Téléchargement terminé 🍿';
              serverItem.sizeleft = 0;
            }
          });

          const now = Date.now();
          const pendingOptimistic: LiveDownloadItem[] = [];

          for (const optimistic of currentDownloads.filter(item => item.isOptimistic && !removedSet.has(item.id))) {
            const serverMatch = serverItems.some(serverItem => sameDownloadIdentity(optimistic, serverItem));
            if (serverMatch) {
              delete optimisticTimestamps[optimistic.id];
              continue;
            }

            if (!optimisticTimestamps[optimistic.id]) optimisticTimestamps[optimistic.id] = now;
            const age = now - optimisticTimestamps[optimistic.id];
            const ttl = optimistic.status === 'error' ? OPTIMISTIC_ERROR_TTL_MS : OPTIMISTIC_TTL_MS;

            if (age < ttl) {
              pendingOptimistic.push(optimistic);
            } else {
              delete optimisticTimestamps[optimistic.id];
            }
          }

          // Une disparition de queue n'est plus assimilée à un succès.
          // On conserve l'état connu et on passe en avertissement si l'absence dure.
          const preservedItems: LiveDownloadItem[] = [];
          for (const oldItem of currentDownloads) {
            if (oldItem.isOptimistic || removedSet.has(oldItem.id)) continue;
            if (serverItems.some(serverItem => sameDownloadIdentity(oldItem, serverItem))) continue;

            if (oldItem.status === 'completed' || oldItem.progress >= 100) {
              preservedItems.push({
                ...oldItem,
                progress: 100,
                status: 'completed',
                statusText: 'Téléchargement terminé 🍿',
                sizeleft: 0,
                speedBytesPerSec: 0,
                speedFormatted: '',
                timeleft: '',
                timeleftSeconds: 0
              });
              continue;
            }

            if (!missingSince[oldItem.id]) missingSince[oldItem.id] = now;
            const missingFor = now - missingSince[oldItem.id];
            preservedItems.push({
              ...oldItem,
              status: missingFor >= MISSING_WARNING_DELAY_MS ? 'warning' : oldItem.status,
              statusText: missingFor >= MISSING_WARNING_DELAY_MS
                ? 'Source temporairement introuvable • vérification en cours'
                : 'Synchronisation du téléchargement…',
              speedBytesPerSec: 0,
              speedFormatted: '',
              timeleft: '',
              timeleftSeconds: 0
            });
          }

          const itemMap = new Map<string, LiveDownloadItem>();
          for (const item of [...serverItems, ...pendingOptimistic, ...preservedItems]) {
            if (!removedSet.has(item.id)) itemMap.set(item.id, item);
          }
          const finalItems = Array.from(itemMap.values());

          // Notification uniquement sur une confirmation explicite à 100 %, jamais sur une disparition.
          for (const serverItem of serverItems) {
            const previous = currentDownloads.find(oldItem => sameDownloadIdentity(oldItem, serverItem));
            if (serverItem.progress >= 100 && previous && previous.progress < 100 && previous.status !== 'completed') {
              sendLocalNotification(
                'Téléchargement terminé 🍿',
                `Le téléchargement de "${serverItem.title}" est terminé !`,
                true
              );
            }
          }

          set({
            downloads: finalItems,
            removedIds: prunedRemovedIds,
            isLoading: false,
            lastUpdated: Date.now(),
            error: null
          });
        } catch (error: any) {
          set({
            error: error?.message || 'Erreur réseau',
            isLoading: false
          });
        } finally {
          isFetchingInProgress = false;
        }
      },

      startPolling: (intervalMs = 1000) => {
        pollingIntervalMs = Math.max(1000, Math.min(pollingIntervalMs, intervalMs));

        // Le polling est global à la session. Les écrans peuvent le demander sans se voler le timer.
        if (get().isPolling) {
          void get().fetchDownloads();
          return;
        }

        clearPollingTimer();
        set({ isPolling: true });

        const scheduleNext = () => {
          if (!get().isPolling) return;
          const downloads = get().downloads || [];
          const hasActive = downloads.some(item =>
            item.status !== 'completed' && item.status !== 'error' && item.progress < 100
          );
          const hasError = Boolean(get().error);

          const delay = hasError
            ? 15_000
            : hasActive
              ? pollingIntervalMs
              : 8_000;

          pollingTimer = setTimeout(async () => {
            await get().fetchDownloads();
            scheduleNext();
          }, delay);
        };

        void get().fetchDownloads().finally(scheduleNext);
      },

      stopPolling: () => {
        // Tant qu'un utilisateur est connecté, le moniteur reste globalement actif.
        // Cela évite qu'une modale ou un écran secondaire coupe le suivi des autres vues.
        if (auth.currentUser) return;
        clearPollingTimer();
        pollingIntervalMs = 1000;
        set({ isPolling: false });
      },

      removeDownload: async (item) => {
        const newRemovedIds = Array.from(new Set([...(get().removedIds || []), item.id]));
        const config = useDownloadConfigStore.getState();

        set({
          removedIds: newRemovedIds,
          downloads: (get().downloads || []).filter(download => download.id !== item.id)
        });

        delete optimisticTimestamps[item.id];
        delete missingSince[item.id];

        if (item.isOptimistic || item.id.startsWith('opt_')) return true;

        try {
          const result = await deleteLiveDownloadItem(item, {
            sonarrUrl: config.sonarrUrl,
            sonarrApiKey: config.sonarrApiKey,
            radarrUrl: config.radarrUrl,
            radarrApiKey: config.radarrApiKey,
            qbittorrentUrl: config.qbittorrentUrl,
            qbittorrentUsername: config.qbittorrentUsername,
            qbittorrentPassword: config.qbittorrentPassword
          });
          return result.success;
        } catch {
          return false;
        }
      },

      clearAllDownloads: async () => {
        const current = get().downloads || [];
        const newRemovedIds = Array.from(new Set([
          ...(get().removedIds || []),
          ...current.map(item => item.id)
        ]));
        const config = useDownloadConfigStore.getState();

        set({ removedIds: newRemovedIds, downloads: [] });

        for (const item of current) {
          delete optimisticTimestamps[item.id];
          delete missingSince[item.id];
          if (item.isOptimistic || item.id.startsWith('opt_')) continue;
          try {
            await deleteLiveDownloadItem(item, {
              sonarrUrl: config.sonarrUrl,
              sonarrApiKey: config.sonarrApiKey,
              radarrUrl: config.radarrUrl,
              radarrApiKey: config.radarrApiKey,
              qbittorrentUrl: config.qbittorrentUrl,
              qbittorrentUsername: config.qbittorrentUsername,
              qbittorrentPassword: config.qbittorrentPassword
            });
          } catch {}
        }
      },

      getShowDownloads: (tmdbId, tvdbId, showTitle) => {
        return (get().downloads || []).filter(item =>
          matchShowDownload(item, tmdbId, tvdbId, showTitle)
        );
      },

      getMovieDownload: (tmdbId, movieTitle) => {
        return (get().downloads || []).find(item =>
          matchMovieDownload(item, tmdbId, movieTitle)
        ) || null;
      },

      getEpisodeDownload: (tmdbId, tvdbId, season, episode) => {
        const showItems = get().getShowDownloads(tmdbId, tvdbId);
        if (!showItems.length) return null;

        if (season !== undefined && episode !== undefined) {
          return showItems.find(item => item.seasonNumber === season && item.episodeNumber === episode)
            || showItems.find(item => item.seasonNumber === season && item.episodeNumber === undefined)
            || showItems.find(item => item.seasonNumber === undefined)
            || null;
        }

        if (season !== undefined) {
          return showItems.find(item => item.seasonNumber === season && item.episodeNumber === undefined)
            || showItems.find(item => item.seasonNumber === undefined)
            || null;
        }

        return showItems.find(item => item.seasonNumber === undefined) || null;
      }
    }),
    {
      name: 'seenit_live_downloads_v3',
      partialize: state => ({
        downloads: state.downloads,
        removedIds: state.removedIds
      })
    }
  )
);

function forceStopGlobalPolling() {
  clearPollingTimer();
  pollingIntervalMs = 1000;
  useLiveDownloadStore.setState({ isPolling: false });
}

if (typeof window !== 'undefined') {
  onAuthStateChanged(auth, user => {
    const nextUid = user?.uid || null;
    const scopeKey = 'seenit_live_downloads_scope_v3';
    const previousUid = localStorage.getItem(scopeKey) || null;

    if (previousUid !== nextUid || activeScopedUid !== nextUid) {
      activeScopedUid = nextUid;
      useLiveDownloadStore.setState({
        downloads: [],
        removedIds: [],
        error: null,
        lastUpdated: null
      });
      localStorage.setItem(scopeKey, nextUid || '');
    }

    if (user) {
      useLiveDownloadStore.getState().startPolling(1000);
    } else {
      forceStopGlobalPolling();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && auth.currentUser) {
      useLiveDownloadStore.getState().startPolling(1000);
    }
  });
}

if (Capacitor.isNativePlatform()) {
  try {
    CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive && auth.currentUser) {
        useLiveDownloadStore.getState().startPolling(1000);
      }
    });
  } catch {}
}
