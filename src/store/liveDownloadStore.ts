import { create } from 'zustand';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { useDownloadConfigStore } from './downloadConfigStore';
import {
  fetchLiveDownloadsQueue,
  getLastLiveDownloadSourceHealth,
  type LiveDownloadItem,
  matchShowDownload,
  matchMovieDownload,
  deleteLiveDownloadItem,
  extractQualityFromTitle
} from '../services/sonarrRadarr';
import { useToastStore } from './toastStore';
import { useShowsStore } from './showsStore';
import { auth, db } from '../lib/firebase';
import { canAttachRecentOptimisticRequest, getPhysicalDownloadId, getStrongPhysicalDownloadIds, hasConflictingStrongPhysicalIds, mergeDownloadIdAliases, sameDownloadRequest, sameLegacyPhysicalTransfer, samePhysicalDownload, sameTransferPath } from '../features/downloads/downloadIdentity';
import { findUniqueRecentOptimisticAttachments, mergeLateOptimisticMetadata } from '../features/downloads/downloadReconciliation';
import { fetchRecentDownloadHistory, resolveDownloadHistoryOutcome } from '../features/downloads/downloadHistory';
import { preferSeenItImagePath } from '../features/downloads/downloadPosterStability';
import { isDownloadInHistorySection } from '../features/downloads/downloadStatePolicy';
import { buildLiveDownloadStorageKey, isDownloadRequestScopeCurrent } from '../features/downloads/downloadUserScope';
import { normalizeUnresolvedQbitScope, shouldSuppressUnresolvedQbit } from '../features/downloads/downloadTransientVisibility';

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
  clearAllDownloads: (section?: 'completed' | 'cancelled' | 'error') => Promise<void>;

  getShowDownloads: (tmdbId?: number | string, tvdbId?: number | string, showTitle?: string) => LiveDownloadItem[];
  getMovieDownload: (tmdbId?: number | string, movieTitle?: string) => LiveDownloadItem | null;
  getEpisodeDownload: (tmdbId?: number | string, tvdbId?: number | string, season?: number, episode?: number) => LiveDownloadItem | null;
}

let pollingTimer: ReturnType<typeof setTimeout> | null = null;
let pollingIntervalMs = 1000;
let activeFetchPromise: Promise<void> | null = null;
let downloadScopeEpoch = 0;
let activeDownloadStorageUid: string | null = null;

const optimisticTimestamps: Record<string, number> = {};
const missingSince: Record<string, number> = {};
const completionNotificationEligibility = new Set<string>();
let localMutationRevision = 0;
const localItemMutationRevision: Record<string, number> = {};
let sharedDownloadUnsubscribe: (() => void) | null = null;
const SHARED_DOWNLOAD_REQUEST_TTL_MS = 10 * 60_000;

function markLocalItemMutation(id: string) {
  localMutationRevision += 1;
  localItemMutationRevision[id] = localMutationRevision;
}

function sharedRequestDocId(item: Pick<LiveDownloadItem, 'id' | 'requestId'>): string {
  return String(item.requestId || item.id).replace(/\//g, '_');
}

function serializeSharedDownloadRequest(item: LiveDownloadItem): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    id: item.id,
    requestId: item.requestId || item.id,
    mediaType: item.mediaType,
    title: item.title,
    seriesTitle: item.seriesTitle,
    movieTitle: item.movieTitle,
    tmdbId: item.tmdbId,
    tvdbId: item.tvdbId,
    imdbId: item.imdbId,
    posterPath: item.posterPath,
    backdropPath: item.backdropPath,
    seasonNumber: item.seasonNumber,
    episodeNumber: item.episodeNumber,
    quality: item.quality,
    releaseTitle: item.releaseTitle,
    progress: item.progress || 0,
    status: item.status,
    statusText: item.statusText,
    errorMessage: item.errorMessage,
    addedAt: item.addedAt || Date.now(),
    sharedUpdatedAt: Date.now(),
    sharedExpiresAt: Date.now() + SHARED_DOWNLOAD_REQUEST_TTL_MS
  };
  return Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined));
}

async function publishSharedDownloadRequest(item: LiveDownloadItem) {
  const user = auth.currentUser;
  if (!user || !item.isOptimistic) return;
  try {
    await setDoc(
      doc(db, 'users', user.uid, 'downloadRequests', sharedRequestDocId(item)),
      serializeSharedDownloadRequest(item),
      { merge: true }
    );
  } catch (error) {
    console.warn('[Downloads Sync] Impossible de publier la demande partagée:', error);
  }
}

async function removeSharedDownloadRequest(item: Pick<LiveDownloadItem, 'id' | 'requestId'>) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await deleteDoc(doc(db, 'users', user.uid, 'downloadRequests', sharedRequestDocId(item)));
  } catch {}
}

function stopSharedDownloadRequestSync() {
  if (sharedDownloadUnsubscribe) {
    sharedDownloadUnsubscribe();
    sharedDownloadUnsubscribe = null;
  }
}

function startSharedDownloadRequestSync(uid: string) {
  stopSharedDownloadRequestSync();
  sharedDownloadUnsubscribe = onSnapshot(
    collection(db, 'users', uid, 'downloadRequests'),
    snapshot => {
      if (auth.currentUser?.uid !== uid) return;
      const now = Date.now();
      const removedRequestDocIds = new Set(
        snapshot.docChanges()
          .filter(change => change.type === 'removed')
          .map(change => change.doc.id)
      );
      const remoteItems: LiveDownloadItem[] = [];
      for (const entry of snapshot.docs) {
        const data = entry.data() as any;
        if (Number(data.sharedExpiresAt || 0) <= now) {
          void deleteDoc(entry.ref).catch(() => {});
          continue;
        }
        if (!data.title || (data.mediaType !== 'tv' && data.mediaType !== 'movie')) continue;
        remoteItems.push({
          id: String(data.id || entry.id),
          requestId: String(data.requestId || data.id || entry.id),
          mediaType: data.mediaType,
          title: String(data.title),
          seriesTitle: data.seriesTitle,
          movieTitle: data.movieTitle,
          tmdbId: data.tmdbId ? Number(data.tmdbId) : undefined,
          tvdbId: data.tvdbId ? Number(data.tvdbId) : undefined,
          imdbId: data.imdbId,
          posterPath: data.posterPath,
          backdropPath: data.backdropPath,
          seasonNumber: data.seasonNumber != null ? Number(data.seasonNumber) : undefined,
          episodeNumber: data.episodeNumber != null ? Number(data.episodeNumber) : undefined,
          quality: data.quality,
          releaseTitle: data.releaseTitle || data.title,
          size: 0,
          sizeleft: 0,
          progress: Number(data.progress || 0),
          status: data.status || 'searching',
          statusText: data.statusText || 'Synchronisation du téléchargement…',
          errorMessage: data.errorMessage,
          addedAt: Number(data.addedAt || data.sharedUpdatedAt || now),
          isOptimistic: true,
          isRestored: false
        });
      }

      if (!remoteItems.length && removedRequestDocIds.size === 0) return;
      useLiveDownloadStore.setState(state => {
        const downloads = [...(state.downloads || [])].filter(item =>
          !item.isOptimistic || !removedRequestDocIds.has(sharedRequestDocId(item))
        );
        const unmatchedRemoteItems: LiveDownloadItem[] = [];

        for (const remote of remoteItems) {
          const index = downloads.findIndex(local => sameDownloadIdentity(local, remote) || sameRequestScope(local, remote));
          if (index < 0) {
            unmatchedRemoteItems.push(remote);
            continue;
          }

          const local = downloads[index];
          if (!local.isOptimistic) {
            downloads[index] = mergeLateOptimisticMetadata(local, remote);
            markLocalItemMutation(local.id);
            continue;
          }

          downloads[index] = {
            ...local,
            ...remote,
            id: local.id,
            requestId: local.requestId || remote.requestId,
            posterPath: remote.posterPath || local.posterPath,
            backdropPath: remote.backdropPath || local.backdropPath,
            movieTitle: remote.mediaType === 'movie'
              ? (remote.movieTitle || remote.title || local.movieTitle)
              : (remote.movieTitle || local.movieTitle),
            seriesTitle: remote.mediaType === 'tv'
              ? (remote.seriesTitle || remote.title || local.seriesTitle)
              : (remote.seriesTitle || local.seriesTitle),
            isOptimistic: true,
            isRestored: false
          };
          optimisticTimestamps[local.id] = Date.now();
          markLocalItemMutation(local.id);
        }

        const liveCandidates = downloads.filter(item => !item.isOptimistic && !isTerminalDownload(item));
        const attachments = findUniqueRecentOptimisticAttachments(unmatchedRemoteItems, liveCandidates, now);
        const attachedRequestIndexes = new Set<number>();
        for (const attachment of attachments) {
          const request = unmatchedRemoteItems[attachment.requestIndex];
          const local = liveCandidates[attachment.remoteIndex];
          const index = downloads.findIndex(item => item.id === local.id);
          if (index < 0) continue;
          downloads[index] = mergeLateOptimisticMetadata(downloads[index], request);
          markLocalItemMutation(local.id);
          attachedRequestIndexes.add(attachment.requestIndex);
        }

        unmatchedRemoteItems.forEach((remote, requestIndex) => {
          if (attachedRequestIndexes.has(requestIndex)) return;
          downloads.unshift(remote);
          optimisticTimestamps[remote.id] = Date.now();
          markLocalItemMutation(remote.id);
        });

        return { downloads };
      });

      const state = useLiveDownloadStore.getState();
      if (!state.isPolling) state.startPolling(1000);
      else void state.fetchDownloads();
    },
    error => console.warn('[Downloads Sync] Écoute Firestore interrompue:', error)
  );
}
const OPTIMISTIC_TTL_MS = 120_000;
const OPTIMISTIC_ERROR_TTL_MS = 60_000;
const MISSING_GRACE_MS = 10_000;
const MISSING_WARNING_DELAY_MS = 20_000;

function sameCanonicalMedia(a: LiveDownloadItem, b: LiveDownloadItem): boolean {
  if (a.mediaType !== b.mediaType) return false;
  if (a.tmdbId && b.tmdbId && Number(a.tmdbId) === Number(b.tmdbId)) return true;
  if (a.tvdbId && b.tvdbId && Number(a.tvdbId) === Number(b.tvdbId)) return true;
  if (a.imdbId && b.imdbId && String(a.imdbId).toLowerCase() === String(b.imdbId).toLowerCase()) return true;
  return false;
}

function resolutionBucket(item: LiveDownloadItem): '4k' | '1080p' | '720p' | null {
  const value = `${item.quality || ''} ${item.releaseTitle || ''}`.toLowerCase();
  if (/2160|4k|uhd/.test(value)) return '4k';
  if (/1080/.test(value)) return '1080p';
  if (/720/.test(value)) return '720p';
  return null;
}

function completionNotificationKeys(item: LiveDownloadItem): string[] {
  const keys = new Set<string>();
  for (const id of getStrongPhysicalDownloadIds(item)) keys.add(`physical:${id}`);

  const quality = resolutionBucket(item) || 'auto';
  if (item.mediaType === 'movie') {
    if (item.tmdbId) keys.add(`movie:tmdb:${Number(item.tmdbId)}:${quality}`);
    else if (item.imdbId) keys.add(`movie:imdb:${String(item.imdbId).toLowerCase()}:${quality}`);
  } else {
    const canonical = item.tmdbId ? `tmdb:${Number(item.tmdbId)}` : item.tvdbId ? `tvdb:${Number(item.tvdbId)}` : '';
    if (canonical) {
      keys.add(`tv:${canonical}:s${item.seasonNumber ?? "*"}:e${item.episodeNumber ?? "*"}:${quality}`);
    }
  }

  return Array.from(keys);
}

function markCompletionNotificationEligible(item: LiveDownloadItem) {
  for (const key of completionNotificationKeys(item)) completionNotificationEligibility.add(key);
}

function consumeCompletionNotificationEligibility(item: LiveDownloadItem): boolean {
  const keys = completionNotificationKeys(item);
  const eligible = keys.some(key => completionNotificationEligibility.has(key));
  if (eligible) keys.forEach(key => completionNotificationEligibility.delete(key));
  return eligible;
}

function sameRequestScope(a: LiveDownloadItem, b: LiveDownloadItem): boolean {
  if (!sameCanonicalMedia(a, b)) return false;
  if (a.mediaType !== 'tv') return true;
  return (a.seasonNumber ?? null) === (b.seasonNumber ?? null)
    && (a.episodeNumber ?? null) === (b.episodeNumber ?? null);
}

function isCancelledDownload(item: LiveDownloadItem): boolean {
  return String(item.status || '').toLowerCase() === 'cancelled';
}

function isTerminalDownload(item: LiveDownloadItem): boolean {
  return isCancelledDownload(item) || item.status === 'completed' || Number(item.progress || 0) >= 100;
}

function sameDownloadIdentity(a: LiveDownloadItem, b: LiveDownloadItem): boolean {
  if (a.id === b.id) return true;
  if (sameDownloadRequest(a, b)) return true;
  if (samePhysicalDownload(a, b)) return true;

  if (hasConflictingStrongPhysicalIds(a, b)) return false;
  if (sameTransferPath(a, b)) return true;

  const aResolution = resolutionBucket(a);
  const bResolution = resolutionBucket(b);
  if (aResolution && bResolution && aResolution !== bResolution) return false;

  if (sameLegacyPhysicalTransfer(a, b)) return true;

  if (isTerminalDownload(a) !== isTerminalDownload(b)) return false;
  if (!sameCanonicalMedia(a, b)) return false;

  if (a.mediaType === 'tv') {
    if (a.seasonNumber != null && b.seasonNumber != null && a.seasonNumber !== b.seasonNumber) return false;
    if (a.episodeNumber != null && b.episodeNumber != null && a.episodeNumber !== b.episodeNumber) return false;
  }

  return Boolean(a.isOptimistic || b.isOptimistic || a.isRestored || b.isRestored);
}

function sameCancellationIdentity(cancelled: LiveDownloadItem, remote: LiveDownloadItem, now = Date.now()): boolean {
  if (sameDownloadIdentity(cancelled, remote)) return true;
  if (cancelled.mediaType !== remote.mediaType) return false;

  const sameCanonical = Boolean(
    cancelled.tmdbId && remote.tmdbId && Number(cancelled.tmdbId) === Number(remote.tmdbId)
  ) || Boolean(
    cancelled.tvdbId && remote.tvdbId && Number(cancelled.tvdbId) === Number(remote.tvdbId)
  );

  if (sameCanonical) {
    if (cancelled.mediaType === 'tv') {
      if (cancelled.seasonNumber != null && remote.seasonNumber != null
          && Number(cancelled.seasonNumber) !== Number(remote.seasonNumber)) return false;
      if (cancelled.episodeNumber != null && remote.episodeNumber != null
          && Number(cancelled.episodeNumber) !== Number(remote.episodeNumber)) return false;
    }
    const cancelledResolution = resolutionBucket(cancelled);
    const remoteResolution = resolutionBucket(remote);
    return !(cancelledResolution && remoteResolution && cancelledResolution !== remoteResolution);
  }

  return canAttachRecentOptimisticRequest(
    { ...cancelled, isOptimistic: true },
    remote,
    now,
    5 * 60_000
  );
}

function sendLocalNotification(title: string, body: string, isSuccess = false, item?: LiveDownloadItem) {
  try {
    if (item) {
      const mediaTitle = item.movieTitle || item.seriesTitle;
      if (!mediaTitle) return;
      const subtitle = item.mediaType === 'tv' && item.seasonNumber != null
        ? item.episodeNumber != null
          ? `S${String(item.seasonNumber).padStart(2, '0')}E${String(item.episodeNumber).padStart(2, '0')}`
          : `Saison ${item.seasonNumber}`
        : undefined;
      useToastStore.getState().showToast({
        title: mediaTitle,
        subtitle,
        action: isSuccess ? 'Téléchargement terminé' : body,
        posterPath: item.posterPath
      }, isSuccess ? 'success' : 'download');
    } else {
      useToastStore.getState().showToast(`${title}: ${body}`, isSuccess ? 'success' : 'download');
    }
  } catch {}

  // Les notifications système de téléchargement sont désormais exclusivement
  // émises par les webhooks Sonarr/Radarr → FCM. Le polling local ne produit qu'un
  // toast dans SeenIt afin d'éviter les doubles notifications et les noms de torrent.
}

function clearPollingTimer() {
  if (pollingTimer) {
    clearTimeout(pollingTimer);
    pollingTimer = null;
  }
}

export const useLiveDownloadStore = create<LiveDownloadState>()(
  (set, get) => ({
      downloads: [],
      removedIds: [],
      isLoading: false,
      lastUpdated: null,
      error: null,
      isPolling: false,

      addOptimisticDownload: item => {
        const candidateId = item.id || `opt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const candidate: LiveDownloadItem = {
          id: candidateId,
          requestId: item.requestId || candidateId,
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
          downloadId: item.downloadId,
          downloadIdAliases: item.downloadIdAliases,
          transferPath: item.transferPath,
          addedAt: item.addedAt || Date.now(),
          isRestored: false,
          isOptimistic: true
        };

        markCompletionNotificationEligible(candidate);

        const existing = get().downloads.find(download =>
          download.status !== 'completed'
          && download.status !== 'error'
          && sameRequestScope(download, candidate)
        );

        if (existing) {
          optimisticTimestamps[existing.id] = Date.now();
          markLocalItemMutation(existing.id);
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
          void publishSharedDownloadRequest({
            ...existing,
            ...candidate,
            id: existing.id,
            requestId: existing.requestId || candidate.requestId || existing.id,
            posterPath: candidate.posterPath || existing.posterPath,
            isOptimistic: true
          });
          if (!get().isPolling) get().startPolling(1000);
          else void get().fetchDownloads();
          return existing.id;
        }

        optimisticTimestamps[candidate.id] = Date.now();
        markLocalItemMutation(candidate.id);
        set(state => ({ downloads: [candidate, ...state.downloads] }));
        void publishSharedDownloadRequest(candidate);

        if (!get().isPolling) get().startPolling(1000);
        else void get().fetchDownloads();
        return candidate.id;
      },

      updateDownloadRequest: (id, patch) => {
        const existing = get().downloads.find(download => download.id === id);
        markLocalItemMutation(id);
        if (existing?.isOptimistic || patch.isOptimistic) {
          optimisticTimestamps[id] = Date.now();
        }

        set(state => ({
          downloads: state.downloads.map(download =>
            download.id === id ? { ...download, ...patch, id: download.id } : download
          )
        }));
        if (existing) {
          const next = { ...existing, ...patch, id: existing.id } as LiveDownloadItem;
          if (next.isOptimistic) void publishSharedDownloadRequest(next);
        }
      },

      fetchDownloads: async () => {
        if (activeFetchPromise) return activeFetchPromise;

        const fetchUid = auth.currentUser?.uid || null;
        const fetchEpoch = downloadScopeEpoch;
        const isCurrentScope = () => isDownloadRequestScopeCurrent(
          { uid: fetchUid, epoch: fetchEpoch },
          { uid: auth.currentUser?.uid || null, epoch: downloadScopeEpoch }
        );
        if (!fetchUid) {
          set({ isLoading: false, error: null });
          return;
        }

        const config = useDownloadConfigStore.getState();
        const hasAnyClient = Boolean(
          (config.sonarrUrl && config.sonarrApiKey)
          || (config.radarrUrl && config.radarrApiKey)
          || config.qbittorrentUrl
        );

        if (!hasAnyClient) {
          set({ isLoading: false, error: null });
          return;
        }

        let resolveFlight!: () => void;
        const currentFlight = new Promise<void>(resolve => { resolveFlight = resolve; });
        activeFetchPromise = currentFlight;
        set({ isLoading: get().lastUpdated == null });

        try {
          const fetchStartedMutationRevision = localMutationRevision;
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
          if (!isCurrentScope()) return;

          const sourceHealth = getLastLiveDownloadSourceHealth();
          const normalizedServerItems = rawServerItems.map(normalizeUnresolvedQbitScope);
          const rawIds = new Set(normalizedServerItems.map(item => item.id));
          const prunedRemovedIds = (get().removedIds || []).filter(id => rawIds.has(id));
          const removedSet = new Set(prunedRemovedIds);
          const cancelledLocals = currentDownloads.filter(isCancelledDownload);
          const pendingRequests = currentDownloads.filter(item => item.isOptimistic && !isTerminalDownload(item));
          const visibilityNow = Date.now();
          const serverItems = normalizedServerItems.filter(item =>
            !removedSet.has(item.id)
            && !cancelledLocals.some(cancelled => sameCancellationIdentity(cancelled, item))
            && !shouldSuppressUnresolvedQbit(item, pendingRequests, visibilityNow)
          );
          const localShows = useShowsStore.getState().shows || [];

          serverItems.forEach(serverItem => {
            delete missingSince[serverItem.id];

            const localMatch = currentDownloads.find(current => sameDownloadIdentity(current, serverItem));
            if (localMatch) {
              if (localMatch.requestId) {
                serverItem.posterPath = preferSeenItImagePath(serverItem.posterPath, localMatch.posterPath);
                serverItem.backdropPath = preferSeenItImagePath(serverItem.backdropPath, localMatch.backdropPath);
              } else {
                if (!serverItem.posterPath && localMatch.posterPath) serverItem.posterPath = localMatch.posterPath;
                if (!serverItem.backdropPath && localMatch.backdropPath) serverItem.backdropPath = localMatch.backdropPath;
              }
              if (!serverItem.tmdbId && localMatch.tmdbId) serverItem.tmdbId = localMatch.tmdbId;
              if (!serverItem.tvdbId && localMatch.tvdbId) serverItem.tvdbId = localMatch.tvdbId;
              if (!serverItem.quality && localMatch.quality) serverItem.quality = localMatch.quality;
              if (!serverItem.transferPath && localMatch.transferPath) serverItem.transferPath = localMatch.transferPath;
              if (!serverItem.addedAt && localMatch.addedAt) serverItem.addedAt = localMatch.addedAt;
              if (!serverItem.requestId && localMatch.requestId) serverItem.requestId = localMatch.requestId;

              if (localMatch.requestId) {
                if (serverItem.mediaType === 'movie') {
                  const seenItTitle = localMatch.movieTitle || (localMatch.isOptimistic ? localMatch.title : undefined);
                  if (seenItTitle) serverItem.movieTitle = seenItTitle;
                } else {
                  const seenItTitle = localMatch.seriesTitle || (localMatch.isOptimistic ? localMatch.title : undefined);
                  if (seenItTitle) serverItem.seriesTitle = seenItTitle;
                }
              }

              serverItem.isRestored = false;
              serverItem.downloadIdAliases = mergeDownloadIdAliases(serverItem, localMatch);
              if (!serverItem.downloadId && localMatch.downloadId) serverItem.downloadId = localMatch.downloadId;

              if ((samePhysicalDownload(localMatch, serverItem) || sameTransferPath(localMatch, serverItem) || sameLegacyPhysicalTransfer(localMatch, serverItem) || sameDownloadRequest(localMatch, serverItem))
                  && Number(localMatch.progress || 0) > Number(serverItem.progress || 0)) {
                serverItem.progress = localMatch.progress;
                if (localMatch.size > 0) serverItem.size = localMatch.size;
                if (serverItem.size > 0 && Number(localMatch.sizeleft || 0) >= 0) {
                  const remoteLeft = Number(serverItem.sizeleft || serverItem.size);
                  serverItem.sizeleft = Math.min(remoteLeft, Number(localMatch.sizeleft || remoteLeft));
                }
              }
            }

            if (!serverItem.posterPath && serverItem.tmdbId && localShows.length > 0) {
              const matchedShow = localShows.find(show => Number(show.tmdbId) === Number(serverItem.tmdbId));
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
            } else {
              markCompletionNotificationEligible(serverItem);
            }
          });

          const handshakeNow = Date.now();
          const recentOptimistics = currentDownloads.filter(item => item.isOptimistic && !isTerminalDownload(item));
          const handshakeCandidates = recentOptimistics.map(optimistic => ({
            optimistic,
            candidates: serverItems.filter(serverItem =>
              !sameDownloadIdentity(optimistic, serverItem)
              && (serverItem.id.startsWith('qbit_') || (!serverItem.tmdbId && !serverItem.tvdbId))
              && canAttachRecentOptimisticRequest(optimistic, serverItem, handshakeNow)
            )
          }));

          for (const entry of handshakeCandidates) {
            if (entry.candidates.length !== 1) continue;
            const serverItem = entry.candidates[0];
            const contenders = handshakeCandidates.filter(other => other.candidates.includes(serverItem));
            if (contenders.length !== 1) continue;

            const optimistic = entry.optimistic;
            serverItem.requestId = serverItem.requestId || optimistic.requestId || optimistic.id;
            if (!serverItem.tmdbId && optimistic.tmdbId) serverItem.tmdbId = optimistic.tmdbId;
            if (!serverItem.tvdbId && optimistic.tvdbId) serverItem.tvdbId = optimistic.tvdbId;
            if (!serverItem.imdbId && optimistic.imdbId) serverItem.imdbId = optimistic.imdbId;
            serverItem.posterPath = preferSeenItImagePath(serverItem.posterPath, optimistic.posterPath);
            serverItem.backdropPath = preferSeenItImagePath(serverItem.backdropPath, optimistic.backdropPath);
            if (serverItem.seasonNumber == null && optimistic.seasonNumber != null) serverItem.seasonNumber = optimistic.seasonNumber;
            if (serverItem.episodeNumber == null && optimistic.episodeNumber != null) serverItem.episodeNumber = optimistic.episodeNumber;
            if (serverItem.mediaType === 'movie') {
              serverItem.movieTitle = optimistic.movieTitle || optimistic.title;
            } else {
              serverItem.seriesTitle = optimistic.seriesTitle || optimistic.title;
            }
            serverItem.downloadIdAliases = mergeDownloadIdAliases(serverItem, optimistic);
            markCompletionNotificationEligible(serverItem);
          }

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

          const missingActiveItems = currentDownloads.filter(oldItem =>
            !oldItem.isOptimistic
            && !removedSet.has(oldItem.id)
            && !isTerminalDownload(oldItem)
            && !serverItems.some(serverItem => sameDownloadIdentity(oldItem, serverItem))
          );
          const historySnapshot = missingActiveItems.length > 0
            ? await fetchRecentDownloadHistory({
                sonarrUrl: config.sonarrUrl,
                sonarrApiKey: config.sonarrApiKey,
                radarrUrl: config.radarrUrl,
                radarrApiKey: config.radarrApiKey,
                qbittorrentUrl: config.qbittorrentUrl,
                qbittorrentUsername: config.qbittorrentUsername,
                qbittorrentPassword: config.qbittorrentPassword
              })
            : null;
          if (!isCurrentScope()) return;

          const preservedItems: LiveDownloadItem[] = [];
          for (const oldItem of currentDownloads) {
            if (oldItem.isOptimistic || removedSet.has(oldItem.id)) continue;
            if (serverItems.some(serverItem => sameDownloadIdentity(oldItem, serverItem))) continue;

            if (isCancelledDownload(oldItem)) {
              preservedItems.push({
                ...oldItem,
                status: 'cancelled',
                statusText: 'Téléchargement annulé',
                errorMessage: undefined,
                speedBytesPerSec: 0,
                speedFormatted: '',
                timeleft: '',
                timeleftSeconds: 0,
                isRestored: false
              });
              continue;
            }

            if (isTerminalDownload(oldItem)) {
              preservedItems.push({
                ...oldItem,
                progress: 100,
                status: 'completed',
                statusText: 'Téléchargement terminé 🍿',
                sizeleft: 0,
                speedBytesPerSec: 0,
                speedFormatted: '',
                timeleft: '',
                timeleftSeconds: 0,
                isRestored: false
              });
              continue;
            }

            const historyOutcome = historySnapshot
              ? resolveDownloadHistoryOutcome(oldItem, historySnapshot)
              : { state: 'unknown' as const };

            if (historyOutcome.state === 'completed') {
              delete missingSince[oldItem.id];
              preservedItems.push({
                ...oldItem,
                quality: historyOutcome.quality || oldItem.quality,
                progress: 100,
                status: 'completed',
                statusText: 'Téléchargement terminé 🍿',
                errorMessage: undefined,
                sizeleft: 0,
                speedBytesPerSec: 0,
                speedFormatted: '',
                timeleft: '',
                timeleftSeconds: 0,
                isRestored: false
              });
              continue;
            }

            if (historyOutcome.state === 'failed') {
              delete missingSince[oldItem.id];
              preservedItems.push({
                ...oldItem,
                status: 'error',
                statusText: 'Téléchargement échoué',
                errorMessage: historyOutcome.message || 'Le téléchargement a échoué.',
                speedBytesPerSec: 0,
                speedFormatted: '',
                timeleft: '',
                timeleftSeconds: 0,
                isRestored: false
              });
              continue;
            }

            if (!missingSince[oldItem.id]) missingSince[oldItem.id] = now;
            const missingFor = now - missingSince[oldItem.id];
            const arrHealth = oldItem.mediaType === 'movie' ? sourceHealth.radarr : sourceHealth.sonarr;
            const qbitHealth = sourceHealth.qbittorrent;
            const arrHealthy = !arrHealth.configured || arrHealth.ok;
            const qbitHealthy = !qbitHealth.configured || qbitHealth.ok;
            const sourcesHealthy = arrHealthy && qbitHealthy;

            if (sourcesHealthy && missingFor >= MISSING_GRACE_MS) {
              delete missingSince[oldItem.id];
              continue;
            }

            preservedItems.push({
              ...oldItem,
              status: missingFor >= MISSING_WARNING_DELAY_MS ? 'warning' : 'searching',
              statusText: missingFor >= MISSING_WARNING_DELAY_MS
                ? 'Connexion au téléchargement interrompue • nouvelle tentative…'
                : 'Vérification de la fin du téléchargement…',
              speedBytesPerSec: 0,
              speedFormatted: '',
              timeleft: '',
              timeleftSeconds: 0
            });
          }

          const metadataScore = (item: LiveDownloadItem) =>
            (item.posterPath ? 20 : 0)
            + (item.tmdbId ? 20 : 0)
            + (item.tvdbId ? 8 : 0)
            + (item.movieTitle || item.seriesTitle ? 8 : 0)
            + (item.imdbId ? 4 : 0)
            + (item.quality ? 2 : 0);

          const liveScore = (item: LiveDownloadItem) =>
            (item.id.startsWith('qbit_') ? 50 : 0)
            + (Number(item.speedBytesPerSec || 0) > 0 ? 10 : 0)
            + (Number(item.timeleftSeconds || 0) > 0 ? 5 : 0)
            + (Number(item.progress || 0) % 1 !== 0 ? 2 : 0);

          const mergeRepresentations = (a: LiveDownloadItem, b: LiveDownloadItem): LiveDownloadItem => {
            const meta = metadataScore(a) >= metadataScore(b) ? a : b;
            const live = liveScore(a) >= liveScore(b) ? a : b;
            const identitySource = !a.isOptimistic ? a : !b.isOptimistic ? b : meta;
            const seenItRequest = a.isOptimistic ? a : b.isOptimistic ? b : null;
            const aliases = mergeDownloadIdAliases(a, b);
            const strongIds = [...getStrongPhysicalDownloadIds(a), ...getStrongPhysicalDownloadIds(b)];
            const cancelled = isCancelledDownload(a) || isCancelledDownload(b);
            const cancelledSource = isCancelledDownload(a) ? a : b;
            const completed = !cancelled && (
              a.status === 'completed' || Number(a.progress || 0) >= 100
              || b.status === 'completed' || Number(b.progress || 0) >= 100
            );
            const hasError = !cancelled && !completed && (a.status === 'error' || b.status === 'error' || Boolean(a.errorMessage) || Boolean(b.errorMessage));
            const errorSource = a.status === 'error' || a.errorMessage ? a : b;
            const progress = completed
              ? 100
              : cancelled
                ? Number(cancelledSource.progress || 0)
                : Math.max(Number(a.progress || 0), Number(b.progress || 0));
            const liveWithBestProgress = Number(a.progress || 0) > Number(b.progress || 0) ? a : live;

            return {
              ...meta,
              id: identitySource.id,
              requestId: a.requestId || b.requestId || seenItRequest?.id,
              posterPath: preferSeenItImagePath(meta.posterPath || live.posterPath, seenItRequest?.posterPath),
              backdropPath: preferSeenItImagePath(meta.backdropPath || live.backdropPath, seenItRequest?.backdropPath),
              movieTitle: meta.mediaType === 'movie'
                ? (seenItRequest?.movieTitle || seenItRequest?.title || meta.movieTitle || live.movieTitle)
                : meta.movieTitle,
              seriesTitle: meta.mediaType === 'tv'
                ? (seenItRequest?.seriesTitle || seenItRequest?.title || meta.seriesTitle || live.seriesTitle)
                : meta.seriesTitle,
              downloadId: strongIds[0] || getPhysicalDownloadId(live) || getPhysicalDownloadId(meta) || undefined,
              downloadIdAliases: aliases,
              transferPath: meta.transferPath || live.transferPath,
              addedAt: [a.addedAt, b.addedAt].filter(Boolean).length
                ? Math.min(...([a.addedAt, b.addedAt].filter(Boolean) as number[]))
                : undefined,
              releaseTitle: meta.releaseTitle || live.releaseTitle,
              quality: extractQualityFromTitle(meta.releaseTitle || live.releaseTitle, meta.quality || live.quality),
              size: liveWithBestProgress.size > 0 ? liveWithBestProgress.size : meta.size,
              sizeleft: completed ? 0 : cancelled ? cancelledSource.sizeleft : liveWithBestProgress.sizeleft,
              progress,
              speedBytesPerSec: completed || cancelled ? 0 : live.speedBytesPerSec,
              speedFormatted: completed || cancelled ? '' : live.speedFormatted,
              timeleft: completed || cancelled ? '' : live.timeleft,
              timeleftSeconds: completed || cancelled ? 0 : live.timeleftSeconds,
              status: cancelled ? 'cancelled' : completed ? 'completed' : hasError ? errorSource.status : live.status,
              statusText: cancelled ? 'Téléchargement annulé' : completed ? 'Téléchargement terminé 🍿' : hasError ? errorSource.statusText : live.statusText,
              errorMessage: cancelled || completed ? undefined : hasError ? errorSource.errorMessage : undefined,
              isOptimistic: Boolean(a.isOptimistic && b.isOptimistic),
              isRestored: false
            };
          };

          const finalItems: LiveDownloadItem[] = [];
          for (const item of [...serverItems, ...pendingOptimistic, ...preservedItems]) {
            if (removedSet.has(item.id)) continue;

            const existingIndex = finalItems.findIndex(existing => sameDownloadIdentity(existing, item));
            if (existingIndex >= 0) {
              finalItems[existingIndex] = mergeRepresentations(finalItems[existingIndex], item);
              continue;
            }
            finalItems.push(item);
          }

          const latestLocalMutations = (get().downloads || []).filter(item =>
            (localItemMutationRevision[item.id] || 0) > fetchStartedMutationRevision
          );
          const lateUnmatchedOptimistics = latestLocalMutations.filter(item =>
            item.isOptimistic
            && !removedSet.has(item.id)
            && !finalItems.some(existing => sameDownloadIdentity(existing, item))
          );
          const lateRemoteCandidates = finalItems.filter(item => !item.isOptimistic && !isTerminalDownload(item));
          const lateAttachments = findUniqueRecentOptimisticAttachments(
            lateUnmatchedOptimistics,
            lateRemoteCandidates,
            Date.now()
          );
          const lateAttachmentTargetByRequestId = new Map<string, string>(
            lateAttachments.map(attachment => [
              lateUnmatchedOptimistics[attachment.requestIndex].id,
              lateRemoteCandidates[attachment.remoteIndex].id
            ])
          );

          for (const latestLocal of latestLocalMutations) {
            if (isCancelledDownload(latestLocal)) {
              for (let index = finalItems.length - 1; index >= 0; index -= 1) {
                if (sameCancellationIdentity(latestLocal, finalItems[index])) {
                  finalItems.splice(index, 1);
                }
              }
              finalItems.unshift(latestLocal);
              continue;
            }

            if (removedSet.has(latestLocal.id)) continue;

            const existingIndex = finalItems.findIndex(existing => sameDownloadIdentity(existing, latestLocal));

            if (!latestLocal.isOptimistic) {
              if (existingIndex >= 0 && latestLocal.requestId) {
                finalItems[existingIndex] = mergeLateOptimisticMetadata(finalItems[existingIndex], latestLocal);
              }
              continue;
            }

            if (existingIndex < 0) {
              const targetId = lateAttachmentTargetByRequestId.get(latestLocal.id);
              const targetIndex = targetId
                ? finalItems.findIndex(existing => existing.id === targetId)
                : -1;
              if (targetIndex >= 0) {
                finalItems[targetIndex] = mergeLateOptimisticMetadata(finalItems[targetIndex], latestLocal);
                continue;
              }
              finalItems.unshift(latestLocal);
              continue;
            }

            const existing = finalItems[existingIndex];
            if (existing.isOptimistic) {
              finalItems[existingIndex] = {
                ...existing,
                ...latestLocal,
                id: existing.id,
                requestId: existing.requestId || latestLocal.requestId || latestLocal.id,
                downloadId: existing.downloadId || latestLocal.downloadId,
                downloadIdAliases: mergeDownloadIdAliases(existing, latestLocal),
                transferPath: existing.transferPath || latestLocal.transferPath,
                posterPath: latestLocal.posterPath || existing.posterPath,
                backdropPath: latestLocal.backdropPath || existing.backdropPath,
                movieTitle: latestLocal.mediaType === 'movie'
                  ? (latestLocal.movieTitle || latestLocal.title || existing.movieTitle)
                  : existing.movieTitle,
                seriesTitle: latestLocal.mediaType === 'tv'
                  ? (latestLocal.seriesTitle || latestLocal.title || existing.seriesTitle)
                  : existing.seriesTitle
              };
              continue;
            }

            finalItems[existingIndex] = mergeLateOptimisticMetadata(existing, latestLocal);
          }

          for (const finalItem of finalItems) {
            if (isCancelledDownload(finalItem)) {
              consumeCompletionNotificationEligibility(finalItem);
              continue;
            }
            if (!isTerminalDownload(finalItem)) continue;
            const previous = currentDownloads.find(oldItem => sameDownloadIdentity(oldItem, finalItem));
            if (previous && !isTerminalDownload(previous) && consumeCompletionNotificationEligibility(finalItem)) {
              sendLocalNotification(
                'Téléchargement terminé 🍿',
                `Le téléchargement de "${finalItem.movieTitle || finalItem.seriesTitle || finalItem.title}" est terminé !`,
                true,
                finalItem
              );
            }
          }

          if (!isCurrentScope()) return;
          set({
            downloads: finalItems,
            removedIds: prunedRemovedIds,
            isLoading: false,
            lastUpdated: Date.now(),
            error: null
          });
        } catch (error: any) {
          if (!isCurrentScope()) return;
          set({
            error: error?.message || 'Erreur réseau',
            isLoading: false
          });
        } finally {
          if (activeFetchPromise === currentFlight) activeFetchPromise = null;
          resolveFlight();
        }
      },

      startPolling: (intervalMs = 1000) => {
        pollingIntervalMs = Math.max(1000, Math.min(15_000, intervalMs));

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
            item.status !== 'completed'
            && item.status !== 'cancelled'
            && item.status !== 'error'
            && item.progress < 100
          );
          const hasError = Boolean(get().error);

          const delay = hasError
            ? 15_000
            : hasActive
              ? pollingIntervalMs
              : 30_000;

          pollingTimer = setTimeout(async () => {
            await get().fetchDownloads();
            scheduleNext();
          }, delay);
        };

        void get().fetchDownloads().finally(scheduleNext);
      },

      stopPolling: () => {
        clearPollingTimer();
        pollingIntervalMs = 1000;
        set({ isPolling: false });
      },

      removeDownload: async item => {
        const config = useDownloadConfigStore.getState();
        const status = String(item.status || '').toLowerCase();
        const shouldCancelRemote = !isTerminalDownload(item) && status !== 'error';

        if (!shouldCancelRemote) {
          const newRemovedIds = Array.from(new Set([...(get().removedIds || []), item.id]));
          set({
            removedIds: newRemovedIds,
            downloads: (get().downloads || []).filter(download => download.id !== item.id)
          });
          delete optimisticTimestamps[item.id];
          delete missingSince[item.id];
          void removeSharedDownloadRequest(item);
          return true;
        }

        const cancelledItem: LiveDownloadItem = {
          ...item,
          status: 'cancelled',
          statusText: 'Téléchargement annulé',
          errorMessage: undefined,
          speedBytesPerSec: 0,
          speedFormatted: '',
          timeleft: '',
          timeleftSeconds: 0,
          isOptimistic: false,
          isRestored: false
        };

        markLocalItemMutation(item.id);
        set(state => ({
          downloads: state.downloads.map(download =>
            download.id === item.id ? cancelledItem : download
          )
        }));
        delete optimisticTimestamps[item.id];
        delete missingSince[item.id];
        void removeSharedDownloadRequest(item);

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

          if (!result.success) {
            markLocalItemMutation(item.id);
            set(state => ({
              downloads: state.downloads.map(download =>
                download.id === item.id
                  ? {
                      ...download,
                      status: 'warning',
                      statusText: 'Annulation non confirmée • réessaie',
                      errorMessage: result.message || 'Le client distant n’a pas confirmé l’annulation.'
                    }
                  : download
              )
            }));
          }
          return result.success;
        } catch {
          markLocalItemMutation(item.id);
          set(state => ({
            downloads: state.downloads.map(download =>
              download.id === item.id
                ? {
                    ...download,
                    status: 'warning',
                    statusText: 'Annulation non confirmée • réessaie',
                    errorMessage: 'Le client distant n’a pas confirmé l’annulation.'
                  }
                : download
            )
          }));
          return false;
        }
      },

      clearAllDownloads: async (section = 'completed') => {
        const current = get().downloads || [];
        const completed = current.filter(item => isDownloadInHistorySection(item, section));
        if (!completed.length) return;
        const newRemovedIds = Array.from(new Set([
          ...(get().removedIds || []),
          ...completed.map(item => item.id)
        ]));

        set({
          removedIds: newRemovedIds,
          downloads: current.filter(item => !completed.includes(item))
        });

        for (const item of completed) {
          delete optimisticTimestamps[item.id];
          delete missingSince[item.id];
          void removeSharedDownloadRequest(item);
        }
      },

      getShowDownloads: (tmdbId, tvdbId, showTitle) => {
        return (get().downloads || []).filter(item =>
          matchShowDownload(item, tmdbId, tvdbId, showTitle)
        );
      },

      getMovieDownload: (tmdbId, movieTitle) => {
        const matches = (get().downloads || []).filter(item =>
          matchMovieDownload(item, tmdbId, movieTitle)
        );
        if (!matches.length) return null;

        const score = (item: LiveDownloadItem) => {
          const active = !isTerminalDownload(item) && item.status !== 'error';
          const exactTmdb = tmdbId && item.tmdbId && Number(tmdbId) === Number(item.tmdbId);
          return (active ? 10_000 : 0)
            + (exactTmdb ? 2_000 : 0)
            + (item.status === 'downloading' ? 500 : 0)
            + (item.status === 'warning' ? -200 : 0)
            + Math.min(100, Number(item.progress || 0));
        };

        return [...matches].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0] || null;
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
    })
);

interface PersistedLiveDownloads {
  downloads?: LiveDownloadItem[];
  removedIds?: string[];
}

function liveDownloadStorageKey(uid: string): string {
  return buildLiveDownloadStorageKey(uid);
}

function prepareDownloadsForStorage(downloads: LiveDownloadItem[]): LiveDownloadItem[] {
  return downloads.map(item => isTerminalDownload(item) || item.status === 'error'
    ? { ...item, isRestored: false }
    : {
        ...item,
        progress: 0,
        sizeleft: item.size > 0 ? item.size : 0,
        speedBytesPerSec: 0,
        speedFormatted: '',
        timeleft: '',
        timeleftSeconds: 0,
        status: 'searching',
        statusText: 'Synchronisation du téléchargement…',
        isOptimistic: false,
        isRestored: true
      });
}

function readScopedDownloads(uid: string): PersistedLiveDownloads {
  try {
    const raw = localStorage.getItem(liveDownloadStorageKey(uid));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedLiveDownloads;
    return {
      downloads: Array.isArray(parsed.downloads) ? parsed.downloads : [],
      removedIds: Array.isArray(parsed.removedIds) ? parsed.removedIds.map(String) : []
    };
  } catch {
    return {};
  }
}

function persistScopedDownloads(state: LiveDownloadState) {
  if (!activeDownloadStorageUid || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(liveDownloadStorageKey(activeDownloadStorageUid), JSON.stringify({
      downloads: prepareDownloadsForStorage(state.downloads || []),
      removedIds: state.removedIds || []
    } satisfies PersistedLiveDownloads));
  } catch {}
}

function forceStopGlobalPolling() {
  clearPollingTimer();
  pollingIntervalMs = 1000;
  useLiveDownloadStore.setState({ isPolling: false });
}

if (typeof window !== 'undefined') {
  useLiveDownloadStore.subscribe(persistScopedDownloads);

  onAuthStateChanged(auth, user => {
    downloadScopeEpoch += 1;
    activeFetchPromise = null;
    activeDownloadStorageUid = null;
    forceStopGlobalPolling();
    stopSharedDownloadRequestSync();

    Object.keys(optimisticTimestamps).forEach(key => delete optimisticTimestamps[key]);
    Object.keys(missingSince).forEach(key => delete missingSince[key]);
    completionNotificationEligibility.clear();

    const scoped = user ? readScopedDownloads(user.uid) : {};
    useLiveDownloadStore.setState({
      downloads: scoped.downloads || [],
      removedIds: scoped.removedIds || [],
      isLoading: false,
      error: null,
      lastUpdated: null,
      isPolling: false
    });

    localStorage.removeItem('seenit_live_downloads_v3');
    localStorage.removeItem('seenit_live_downloads_scope_v3');

    if (user) {
      activeDownloadStorageUid = user.uid;
      startSharedDownloadRequestSync(user.uid);
      useLiveDownloadStore.getState().startPolling(1000);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && auth.currentUser) {
      useLiveDownloadStore.getState().startPolling(1000);
    } else if (document.visibilityState === 'hidden') {
      useLiveDownloadStore.getState().stopPolling();
    }
  });
}

if (Capacitor.isNativePlatform()) {
  try {
    CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive && auth.currentUser) {
        useLiveDownloadStore.getState().startPolling(1000);
      } else if (!isActive) {
        useLiveDownloadStore.getState().stopPolling();
      }
    });
  } catch {}
}
