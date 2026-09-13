import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { db, auth } from '../../lib/firebase';
import { collection, doc, writeBatch, getDocs, getDocFromServer, runTransaction, setDoc, updateDoc, deleteField } from 'firebase/firestore';
import { tmdb } from '../shows/tmdb';
import { fetchAuthoritativeShowsForUser, useShowsStore } from '../../store/showsStore';
import { useSyncStore } from '../../store/syncStore';
import { useToastStore } from '../../store/toastStore';
import { openExternalUrl } from '../../lib/utils';
import { appLogger } from '../../store/logStore';
import { getPlexClientId } from '../../services/plex';
import { Show } from '../../types';
import { CURRENT_APP_VERSION } from '../../store/updateStore';
import { authenticatedFetch, getAuthenticatedHeaders } from '../../lib/apiAuth';
import {
  buildNativeBackendAttempts,
  describeBackendNetworkFailure,
  executeBackendAttempts
} from '../../lib/nativeBackendRetry';
import { resolveSeenItApiCandidates, resolveSeenItApiUrl } from '../../lib/seenitApi';
import {
  buildPlexParentShowIdentityItem,
  buildResolvedPlexIdentity,
  extractPlexExternalIds,
  getPlexMetadataLookupKey,
  getStrongPlexSourceIdentity,
  isPlexEpisodeAlreadyWatched,
  isPlexMovieAlreadyWatched,
  isStrictPlexIdentityMatch,
  parsePlexGuid,
  unwrapPlexMediaItem
} from './plexIdentity';
import {
  getPlexLastSyncTimestamp,
  getPlexResolutionCache,
  getStoredPlexToken,
  getStoredPlexUsername,
  getPlexUserStorageKey,
  compactPlexResolutionCache,
  mergePlexResolutionCaches,
  storePlexCredentials,
  setPlexLastSyncTimestamp,
  setPlexResolutionCache
} from './plexStorage';
import { getPlexMediaKey, usePlexAvailabilityStore } from './plexAvailability';
import type { PlexMediaInfo } from './plexAvailability';
import {
  describeIncompletePlexSync,
  describePlexServerSync,
  getPlexServerSyncCounts,
  isPermanentPlexResolutionMiss,
  shouldCommitPlexCursor,
  shouldReplacePlexAvailabilityCache
} from './plexSyncIntegrity';
import { buildLibraryStateSignature } from '../../lib/userIsolation';
import { applyPlexLibraryWatchState, mergePlexProgressMutation } from './plexProgressMerge';
import type { PlexLibraryWatchState } from './plexLibraryWatchState';
import {
  buildPlexWatchlistTrackingProvenance,
  getPlexWatchlistMediaIdentity,
  selectPlexWatchlistTrackingRemovals
} from './plexWatchlistTracking';

import {
  type PlexSyncResult,
  type PlexUnresolvedLogItem,
  buildPlexResolutionCacheKey,
  cleanShowForFirestore,
  extractTmdbIdFromPlex,
  fetchPlexHistoryData,
  findShowInLocalLibrary,
  getPlexGuid,
  resolvePlexItem,
  runPlexTasksWithConcurrency,
} from './plexResolution';

const activePlexSyncPromises = new Map<string, Promise<PlexSyncResult>>();

async function loadPlexCloudState(userId: string): Promise<Record<string, any>> {
  const snapshot = await getDocFromServer(doc(db, 'users', userId, 'settings', 'plex'));
  return snapshot.exists() ? snapshot.data() : {};
}

async function persistPlexCloudState(
  userId: string,
  values: { lastSyncTimestamp?: number; resolutionCache?: Record<string, any> }
): Promise<void> {
  const plexRef = doc(db, 'users', userId, 'settings', 'plex');
  await runTransaction(db, async (transaction) => {
    const currentSnapshot = await transaction.get(plexRef);
    const current = currentSnapshot.exists() ? currentSnapshot.data() : {};
    const next: Record<string, any> = {};

    if (values.lastSyncTimestamp !== undefined) {
      next.lastSyncTimestamp = Math.max(
        Number(current.lastSyncTimestamp) || 0,
        values.lastSyncTimestamp
      );
    }
    if (values.resolutionCache) {
      next.resolutionCache = mergePlexResolutionCaches(
        current.resolutionCache || {},
        values.resolutionCache
      );
    }

    transaction.set(plexRef, next, { merge: true });
  });
}

export async function performPlexSync(options: { delta?: boolean; silent?: boolean; ignoreCooldown?: boolean } = {}): Promise<PlexSyncResult> {
  const { delta = true, silent = false, ignoreCooldown = false } = options;
  const requestedUser = auth.currentUser;

  const syncExecution = async (): Promise<PlexSyncResult> => {
    const user = requestedUser;
    if (!user) {
      appLogger.warn('plex', 'Synchronisation annulée : utilisateur non connecté');
      return { success: false, syncedCount: 0, moviesCount: 0, episodesCount: 0, syncedItems: [], error: 'Utilisateur non connecté' };
    }

    let cloudPlexState: Record<string, any>;
    try {
      cloudPlexState = await loadPlexCloudState(user.uid);
    } catch (error: any) {
      const message = `Impossible de charger l’état Plex autoritatif du compte : ${error?.message || error}`;
      appLogger.error('plex', message);
      if (!silent) useToastStore.getState().showToast(message, 'error');
      return { success: false, syncedCount: 0, moviesCount: 0, episodesCount: 0, syncedItems: [], error: message };
    }
    if (auth.currentUser?.uid !== user.uid) {
      return { success: false, syncedCount: 0, moviesCount: 0, episodesCount: 0, syncedItems: [], error: 'Compte SeenIt modifié pendant la synchronisation' };
    }
    const plexToken = getStoredPlexToken(user.uid) || cloudPlexState.authToken || null;
    if (plexToken && !getStoredPlexToken(user.uid)) {
      storePlexCredentials(user.uid, plexToken, cloudPlexState.username || '');
    }
    if (plexToken && !cloudPlexState.authToken) {
      try {
        await setDoc(doc(db, 'users', user.uid, 'settings', 'plex'), {
          authToken: plexToken,
          username: getStoredPlexUsername(user.uid) || cloudPlexState.username || ''
        }, { merge: true });
      } catch (error: any) {
        const message = `Impossible de sécuriser les réglages Plex du compte : ${error?.message || error}`;
        appLogger.error('plex', message);
        return { success: false, syncedCount: 0, moviesCount: 0, episodesCount: 0, syncedItems: [], error: message };
      }
    }
    const clientId = getPlexClientId();
    const localLastSyncTimestamp = getPlexLastSyncTimestamp(user.uid);
    const cloudLastSyncTimestamp = Number(cloudPlexState.lastSyncTimestamp);
    const lastSyncTimestamp = Math.max(
      localLastSyncTimestamp || 0,
      Number.isFinite(cloudLastSyncTimestamp) ? cloudLastSyncTimestamp : 0
    ) || undefined;
    const sharedResolutionCache = mergePlexResolutionCaches(
      getPlexResolutionCache(user.uid),
      cloudPlexState.resolutionCache || {}
    );
    setPlexResolutionCache(user.uid, sharedResolutionCache);

    if (!plexToken) {
      if (!silent) {
        // // appLogger.info('plex', 'Aucun compte Plex associé');
      }
      return { success: false, syncedCount: 0, moviesCount: 0, episodesCount: 0, syncedItems: [], error: 'Aucun compte Plex associé' };
    }

    // Cooldown check (30 min) pour les synchronisations automatiques
    if (!ignoreCooldown && lastSyncTimestamp && !isNaN(lastSyncTimestamp)) {
      const elapsedMinutes = (Date.now() - lastSyncTimestamp) / (1000 * 60);
      if (elapsedMinutes < 30) {
        // // appLogger.info('plex', `Synchronisation automatique Plex ignorée : dernière synchronisation il y a ${Math.round(elapsedMinutes)} min (< 30 min)`);
        return { success: true, syncedCount: 0, moviesCount: 0, episodesCount: 0, syncedItems: [] };
      }
    }

    // // appLogger.info('plex', `Démarrage de la synchronisation Plex (${delta ? 'Mode Delta / Rapide' : 'Mode Complet'})...`);
    if (!silent) {
      useSyncStore.getState().setPlexSyncStatus({
        message: delta
          ? 'Vérification rapide des visionnages récents...'
          : 'Scan complet : Interrogation de vos serveurs Plex...'
      });
    }

    const clearPlexSyncStatusDelayed = (message?: string, delayMs: number = 3000) => {
      if (message && !silent) {
        useSyncStore.getState().setPlexSyncStatus({ message });
      }
      setTimeout(() => {
        // Only clear if the status hasn't been changed by a new sync
        const currentStatus = useSyncStore.getState().plexSyncStatus;
        if (currentStatus && (!message || currentStatus.message === message)) {
          useSyncStore.getState().setPlexSyncStatus(null);
        }
      }, delayMs);
    };

    try {
      const plexData = await fetchPlexHistoryData(plexToken, clientId, delta, delta ? lastSyncTimestamp : undefined);
      if (auth.currentUser?.uid !== user.uid) {
        throw new Error('Compte SeenIt modifié pendant la synchronisation Plex');
      }
      const { history = [], watchlist = [], libraryAvailability = [], libraryWatchStates = [], visitedSources = [] } = plexData || {};
      const nextSyncCursor = Number(plexData?.cursor) || Date.now();
      const serverSyncSummary = describePlexServerSync(plexData?.integrity);
      const serverSyncCounts = getPlexServerSyncCounts(plexData?.integrity);
      const completedServerStatus = serverSyncCounts.synced > 0 || serverSyncCounts.skipped > 0
        ? `Sync Plex terminée • ${serverSyncCounts.synced} serveur(s), ${serverSyncCounts.skipped} ignoré(s)`
        : 'Sync Plex terminée';

      if (shouldReplacePlexAvailabilityCache(delta, plexData?.integrity)) {
        const availabilityStore = usePlexAvailabilityStore.getState();
        const replacementCache: Record<string, PlexMediaInfo> = {};
        const cacheTimestamp = Date.now();

        for (const entry of libraryAvailability) {
          const tmdbId = Number(entry?.tmdbId);
          const mediaType: 'movie' | 'tv' | null = entry?.mediaType === 'tv' ? 'tv' : entry?.mediaType === 'movie' ? 'movie' : null;
          if (!Number.isFinite(tmdbId) || !mediaType || !entry?.serverId || !entry?.ratingKey) continue;

          const key = getPlexMediaKey(tmdbId, mediaType, user.uid);
          if (replacementCache[key]) continue;
          replacementCache[key] = {
            available: true,
            serverName: entry.serverName,
            serverId: entry.serverId,
            ratingKey: String(entry.ratingKey),
            lastChecked: cacheTimestamp
          };
        }

        availabilityStore.replaceUserCache(user.uid, replacementCache);
        appLogger.info('plex', `[Plex Availability] Cache reconstruit en une écriture atomique : ${Object.keys(replacementCache).length} média(s) disponible(s).`);
      }
      const hasHistory = Array.isArray(history) && history.length > 0;
      const hasWatchlist = Array.isArray(watchlist) && watchlist.length > 0;
      const hasLibraryWatchStates = Array.isArray(libraryWatchStates) && libraryWatchStates.length > 0;
      const watchlistSnapshotComplete = plexData?.integrity?.watchlistCollectionComplete === true;

      if (!hasHistory && !hasWatchlist && !hasLibraryWatchStates && !watchlistSnapshotComplete) {
        const sourcesMsg = visitedSources && visitedSources.length > 0 ? ` (${visitedSources.join(', ')})` : '';
        // // appLogger.info('plex', `Plex vérifié : aucun nouveau média ni watchlist${sourcesMsg}`);
        const canCommitCursor = shouldCommitPlexCursor({
          collectionComplete: plexData?.integrity?.collectionComplete,
          retryableUnresolvedCount: 0,
          firestoreCommitted: true
        });
        if (!canCommitCursor) {
          const reason = describeIncompletePlexSync(plexData?.integrity);
          appLogger.warn('plex', `[Plex Sync] Curseur conservé : ${reason}.`);
          clearPlexSyncStatusDelayed('Sync Plex incomplète — nouvel essai requis', 5000);
          if (!silent) {
            useToastStore.getState().showToast(`Synchronisation Plex incomplète : ${reason}. Rien n'a été perdu, un nouvel essai sera effectué.`, 'info');
          }
          return { success: false, syncedCount: 0, moviesCount: 0, episodesCount: 0, syncedItems: [], error: reason };
        }
        setPlexLastSyncTimestamp(user.uid, nextSyncCursor);
        await persistPlexCloudState(user.uid, {
          lastSyncTimestamp: nextSyncCursor,
          resolutionCache: compactPlexResolutionCache(sharedResolutionCache)
        });
        clearPlexSyncStatusDelayed(`${completedServerStatus} • à jour`, 5000);
        if (!silent && serverSyncSummary) {
          useToastStore.getState().showToast(
            `Synchronisation Plex terminée • ${serverSyncSummary}`,
            'success',
            undefined,
            undefined,
            7000
          );
        }
        return { success: true, syncedCount: 0, moviesCount: 0, episodesCount: 0, syncedItems: [] };
      }

      const totalItemsCount = (history?.length || 0) + (watchlist?.length || 0) + (libraryWatchStates?.length || 0);
      const sourcesSummary = visitedSources && visitedSources.length > 0 ? ` [Sources: ${visitedSources.join(', ')}]` : '';
      // // appLogger.info('plex', `${history?.length || 0} historique(s) + ${watchlist?.length || 0} watchlist(s) récupéré(s) depuis Plex${sourcesSummary}`, { sample: (history || []).slice(0, 5) });
      if (!silent) {
        useSyncStore.getState().setPlexSyncStatus({
          message: `Analyse Plex (${totalItemsCount} élément(s)...)`
        });
      }

      // Firestore est l'unique source de décision. Le store Zustand et le cache
      // WebView/PWA ne doivent jamais faire varier le bilan entre deux appareils.
      const authoritativeShows = await fetchAuthoritativeShowsForUser(user.uid);
      if (auth.currentUser?.uid !== user.uid) {
        throw new Error('Compte SeenIt modifié pendant le chargement de la bibliothèque');
      }
      const authoritySignature = buildLibraryStateSignature(authoritativeShows as Array<Record<string, any>>);
      appLogger.info(
        'plex',
        `[Plex Sync] Bibliothèque Firestore autoritative : ${authoritativeShows.length} média(s), empreinte ${authoritySignature}.`
      );
      useShowsStore.getState().setShows(authoritativeShows);
      const showsList: Show[] = authoritativeShows.map((show) => ({ ...show }));
      const baselineShowsById = new Map(authoritativeShows.map((show) => [show.id, { ...show, seenEpisodes: [...(show.seenEpisodes || [])], episodeRecords: { ...(show.episodeRecords || {}) } } as Show]));

      const resolutionCache = sharedResolutionCache;
      let cacheModified = false;
      const sessionResolutionPromises = new Map<string, Promise<any>>();

      const resolveAndCachePlexItem = async (
        cacheKey: string | null,
        item: any
      ): Promise<any> => {
        if (cacheKey && resolutionCache[cacheKey]) return resolutionCache[cacheKey];
        if (cacheKey && sessionResolutionPromises.has(cacheKey)) {
          return sessionResolutionPromises.get(cacheKey)!;
        }

        const resolutionPromise = resolvePlexItem(item, plexToken).then((resolved) => {
          if (cacheKey && resolved) {
            resolutionCache[cacheKey] = resolved;
            cacheModified = true;
          }
          return resolved;
        });
        if (cacheKey) sessionResolutionPromises.set(cacheKey, resolutionPromise);
        return resolutionPromise;
      };

      // Le premier full scan peut contenir des milliers d'événements mais beaucoup
      // moins d'identités uniques. On préchauffe uniquement ces identités, avec une
      // concurrence bornée pour accélérer sans saturer TMDB ni Plex.
      const resolutionCandidates = new Map<string, { cacheKey: string; item: any }>();
      for (const rawItem of history) {
        const item = unwrapPlexMediaItem(rawItem);
        const isEpisode = item?.type === 'episode' || !!item?.grandparentTitle || !!item?.parentTitle;
        if (item?.type === 'season') continue;
        if (!isEpisode && item?.type !== 'movie') continue;
        if (isEpisode && (!Number.isFinite(Number(item.parentIndex)) || !Number.isFinite(Number(item.index)))) continue;

        const identityItem = isEpisode ? buildPlexParentShowIdentityItem(item) : item;
        const mediaType: 'tv' | 'movie' = isEpisode ? 'tv' : 'movie';
        const directTmdbId = extractTmdbIdFromPlex(identityItem);
        if (findShowInLocalLibrary(showsList, directTmdbId, mediaType)) continue;
        const cacheKey = buildPlexResolutionCacheKey(mediaType, identityItem);
        if (cacheKey && !resolutionCache[cacheKey]) {
          resolutionCandidates.set(cacheKey, { cacheKey, item });
        }
      }
      for (const rawItem of watchlist) {
        const item = unwrapPlexMediaItem(rawItem);
        const mediaType: 'tv' | 'movie' = ['show', 'series', 'tv'].includes(String(item?.type || '').toLowerCase()) ? 'tv' : 'movie';
        const directTmdbId = extractTmdbIdFromPlex(item);
        if (findShowInLocalLibrary(showsList, directTmdbId, mediaType)) continue;
        const cacheKey = buildPlexResolutionCacheKey(mediaType, item);
        if (cacheKey && !resolutionCache[cacheKey]) {
          resolutionCandidates.set(cacheKey, { cacheKey, item });
        }
      }
      if (resolutionCandidates.size > 0) {
        if (!silent) {
          useSyncStore.getState().setPlexSyncStatus({
            message: `Résolution Plex (${resolutionCandidates.size} identité(s) uniques...)`
          });
        }
        await runPlexTasksWithConcurrency(
          [...resolutionCandidates.values()],
          4,
          async ({ cacheKey, item }) => { await resolveAndCachePlexItem(cacheKey, item); }
        );
      }

      let syncCount = 0;
      let moviesCount = 0;
      let episodesCount = 0;
      let alreadyWatchedCount = 0;
      let unresolvedCount = 0;
      let retryableUnresolvedCount = 0;
      let repairedCount = 0;
      let unwatchedCount = 0;
      let watchlistUnresolvedItemCount = 0;
      const syncedItems: PlexSyncResult['syncedItems'] = [];
      const unresolvedItems: PlexUnresolvedLogItem[] = [];
      const syncedIdentityKeys = new Set<string>();

      const mutatedShows: Record<string, Show> = {};
      const currentWatchlistIdentities = new Set<string>();

      const queueSyncedItem = (
        identity: string,
        syncedItem: PlexSyncResult['syncedItems'][number]
      ) => {
        if (syncedIdentityKeys.has(identity)) return;
        syncedIdentityKeys.add(identity);
        syncedItems.push(syncedItem);
      };

      const recordUnresolvedItem = (item: any, mediaType: 'movie' | 'episode' | 'watchlist') => {
        const seasonNumber = item.parentIndex !== undefined ? Number(item.parentIndex) : undefined;
        const episodeNumber = item.index !== undefined ? Number(item.index) : undefined;
        const title = mediaType === 'episode'
          ? item.grandparentTitle || item.parentTitle || item.title || 'Série inconnue'
          : item.title || item.grandparentTitle || 'Média inconnu';
        const episodeSuffix = mediaType === 'episode' && seasonNumber !== undefined && episodeNumber !== undefined
          ? ` S${seasonNumber}E${episodeNumber}`
          : '';
        const yearSuffix = item.year ? ` (${item.year})` : '';
        const typeLabel = mediaType === 'movie' ? 'Film' : mediaType === 'episode' ? 'Épisode' : 'Watchlist';
        const ids = extractPlexExternalIds(item);
        const lookupKey = getPlexMetadataLookupKey(item);
        const historyKey = typeof item.historyKey === 'string' ? item.historyKey.trim() : '';
        const reference = item.sourceIdentity ||
          (ids.tmdbId ? `tmdb:${ids.tmdbId}` : null) ||
          (ids.imdbId ? `imdb:${ids.imdbId}` : null) ||
          (ids.tvdbId ? `tvdb:${ids.tvdbId}` : null) ||
          (ids.plexGuid ? `plex:${ids.plexGuid}` : null) ||
          (lookupKey ? `metadata:${lookupKey}` : null) ||
          (historyKey ? `history:${historyKey}` : null) ||
          'aucune';

        unresolvedItems.push({
          label: `${typeLabel} « ${title}${episodeSuffix}${yearSuffix} »`,
          source: item.source || 'source inconnue',
          reference
        });
      };

      const skipAlreadyWatchedEpisode = (
        candidate: Show | undefined,
        seasonNumber: number,
        episodeNumber: number
      ): boolean => {
        if (!candidate) return false;

        const current = mutatedShows[candidate.id] || candidate;
        if (!isPlexEpisodeAlreadyWatched(current, seasonNumber, episodeNumber)) return false;

        alreadyWatchedCount++;
        const canonicalKey = `${seasonNumber}x${episodeNumber}`;
        if (!current.seenEpisodes?.includes(canonicalKey)) {
          const repairedShow: Show = mutatedShows[candidate.id] || { ...current };
          repairedShow.seenEpisodes = [...new Set([...(repairedShow.seenEpisodes || []), canonicalKey])];
          repairedShow.updatedAt = Date.now();
          mutatedShows[candidate.id] = repairedShow;
          repairedCount++;
        }
        return true;
      };

      const skipAlreadyWatchedMovie = (candidate: Show | undefined): boolean => {
        if (!candidate) return false;

        const current = mutatedShows[candidate.id] || candidate;
        if (!isPlexMovieAlreadyWatched(current)) return false;

        alreadyWatchedCount++;
        if (!current.seenEpisodes?.includes('movie')) {
          const repairedMovie: Show = mutatedShows[candidate.id] || { ...current };
          repairedMovie.seenEpisodes = [...new Set([...(repairedMovie.seenEpisodes || []), 'movie'])];
          repairedMovie.updatedAt = Date.now();
          mutatedShows[candidate.id] = repairedMovie;
          repairedCount++;
        }
        return true;
      };

      const totalItems = history.length;
      let processedCount = 0;

      for (const rawItem of history) {
        const item = unwrapPlexMediaItem(rawItem);
        processedCount++;
        if (!silent && processedCount % 15 === 0 && processedCount < totalItems) {
          useSyncStore.getState().setPlexSyncStatus({
            message: `Analyse Plex (${processedCount}/${totalItems})...`
          });
        }

        const type = item.type;
        const pGuidStr = getPlexGuid(item) || '';
        const rawViewed = item.viewedAt;
        const viewedTimestamp = rawViewed ? (Number(rawViewed) < 10000000000 ? Number(rawViewed) * 1000 : Number(rawViewed)) : Date.now();
        const isEpisode = type === 'episode' || !!item.grandparentTitle || !!item.parentTitle || pGuidStr.includes('/episode/');
        const resolutionIdentityItem = isEpisode ? buildPlexParentShowIdentityItem(item) : item;
        const guidTmdbId = extractTmdbIdFromPlex(resolutionIdentityItem);

        // 4. Ignorer explicitement les objets de type saison
        if (type === 'season' || pGuidStr.includes('/season/')) {
          appLogger.info('plex', `[Plex Sync] Saison "${item.title || 'Saison'}" ignorée (conteneur uniquement).`);
          continue;
        }

        if (isEpisode) {
          const seasonNum = item.parentIndex !== undefined ? Number(item.parentIndex) : NaN;
          const episodeNum = item.index !== undefined ? Number(item.index) : NaN;
          if (!Number.isFinite(seasonNum) || !Number.isFinite(episodeNum)) {
            unresolvedCount++;
            if (getStrongPlexSourceIdentity(item)) retryableUnresolvedCount++;
            recordUnresolvedItem(item, 'episode');
            appLogger.warn('plex', '[Plex Sync] Épisode ignoré : coordonnées saison/épisode absentes, aucun S1E1 inventé.');
            continue;
          }
          const showTitle = item.grandparentTitle || item.parentTitle || item.title || 'Série inconnue';

          const epKey = `${seasonNum}x${episodeNum}`;
          const cleanShowTitle = showTitle.replace(/\(\d{4}\)/g, '').trim();
          const cacheKey = buildPlexResolutionCacheKey('tv', resolutionIdentityItem);

          // 1. Check in local library by TMDB ID
          let matchedShow = findShowInLocalLibrary(showsList, guidTmdbId, 'tv');

          // Fast skip check: if already in library and episode is already seen, skip immediately
          if (skipAlreadyWatchedEpisode(matchedShow, seasonNum, episodeNum)) {
            continue; // Déjà vu dans seenEpisodes ou episodeRecords : aucune notification.
          }

          // 2. If not found locally, check resolution cache
          let tmdbData: any = null;
          if (!matchedShow && cacheKey && resolutionCache[cacheKey]) {
            tmdbData = resolutionCache[cacheKey];
            matchedShow = showsList.find(
              (s) => Number(s.tmdbId) === Number(tmdbData.id) && (s.mediaType === 'tv' || !s.mediaType)
            );
            if (skipAlreadyWatchedEpisode(matchedShow, seasonNum, episodeNum)) {
              continue;
            }
          }

          // 3. If still not resolved, query TMDB via helper
          if (!matchedShow && !tmdbData) {
            tmdbData = await resolveAndCachePlexItem(cacheKey, item);

            if (!tmdbData) {
              unresolvedCount++;
              recordUnresolvedItem(item, 'episode');
              appLogger.info('plex', `[Plex Sync] Fiche "${cleanShowTitle}" ignorée (impossible de résoudre l'ID TMDB).`);
              continue;
            }

            // Déduplication uniquement après obtention du TMDB ID vérifié.
            matchedShow = showsList.find(
              (s) => Number(s.tmdbId) === Number(tmdbData.id) && (s.mediaType === 'tv' || !s.mediaType)
            );
            if (skipAlreadyWatchedEpisode(matchedShow, seasonNum, episodeNum)) {
              continue;
            }
          }

          if (matchedShow) {
            const showId = matchedShow.id;
            if (!mutatedShows[showId]) {
              mutatedShows[showId] = { ...matchedShow };
            }
            const showData = mutatedShows[showId];
            const seenEpisodes = [...(showData.seenEpisodes || [])];

            // Check if already seen
            if (!isPlexEpisodeAlreadyWatched(showData, seasonNum, episodeNum)) {
              seenEpisodes.push(epKey);
              const episodeRecords = { ...(showData.episodeRecords || {}) };
              episodeRecords[epKey] = {
                watchedAt: viewedTimestamp,
                episodeTitle: item.title || null,
                ...(episodeRecords[epKey] || {}),
                plexImported: true
              };

              showData.seenEpisodes = seenEpisodes;
              showData.episodeRecords = episodeRecords;
              showData.lastWatchedAt = viewedTimestamp;
              showData.updatedAt = Date.now();
              showData.status = showData.status === 'plan_to_watch' ? 'watching' : showData.status;

              syncCount++;
              episodesCount++;

              const sPad = String(seasonNum).padStart(2, '0');
              const ePad = String(episodeNum).padStart(2, '0');
              const subtitle = `S${sPad} | E${ePad}`;

              queueSyncedItem(buildResolvedPlexIdentity('tv', showData.tmdbId, seasonNum, episodeNum), {
                title: showData.title || showTitle,
                subtitle,
                posterPath: showData.posterPath,
                mediaType: 'tv',
                show: showData
              });
            }
          } else if (tmdbData && tmdbData.id) {
            // Genuinely new show discovered from Plex!
            const newShowRef = doc(collection(db, `users/${user.uid}/shows`));
            const showId = newShowRef.id;

            const newShowData: Show = {
              id: showId,
              userId: user.uid,
              tmdbId: tmdbData.id,
              title: tmdbData.name || showTitle,
              originalTitle: tmdbData.original_name || showTitle,
              mediaType: 'tv',
              status: 'watching',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              lastWatchedAt: viewedTimestamp,
              posterPath: tmdbData.poster_path
                ? tmdbData.poster_path.startsWith('http')
                  ? tmdbData.poster_path
                  : `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}`
                : null,
              backdropPath: tmdbData.backdrop_path
                ? tmdbData.backdrop_path.startsWith('http')
                  ? tmdbData.backdrop_path
                  : `https://image.tmdb.org/t/p/w1280${tmdbData.backdrop_path}`
                : null,
              firstAirDate: tmdbData.first_air_date || '',
              networks: [],
              seenEpisodes: [epKey],
              episodeRecords: { [epKey]: { watchedAt: viewedTimestamp, episodeTitle: item.title || null, plexImported: true } },
              isArchived: false
            };

            mutatedShows[showId] = newShowData;
            showsList.push(newShowData);

            syncCount++;
            episodesCount++;

            const sPad = String(seasonNum).padStart(2, '0');
            const ePad = String(episodeNum).padStart(2, '0');
            const subtitle = `S${sPad} | E${ePad}`;

            queueSyncedItem(buildResolvedPlexIdentity('tv', newShowData.tmdbId, seasonNum, episodeNum), {
              title: newShowData.title,
              subtitle,
              posterPath: newShowData.posterPath,
              mediaType: 'tv',
              show: newShowData
            });
          }
        } else if (type === 'movie') {
          const movieTitle = item.title || 'Film inconnu';

          const cleanMovieTitle = movieTitle.replace(/\(\d{4}\)/g, '').trim();
          const cacheKey = buildPlexResolutionCacheKey('movie', item);

          // 1. Check in local library by TMDB ID
          let matchedMovie = findShowInLocalLibrary(showsList, guidTmdbId, 'movie');

          // Fast skip check: if already in library and movie is already marked as seen, skip immediately
          if (skipAlreadyWatchedMovie(matchedMovie)) {
            continue;
          }

          // 2. If not found locally, check resolution cache
          let tmdbData: any = null;
          if (!matchedMovie && cacheKey && resolutionCache[cacheKey]) {
            tmdbData = resolutionCache[cacheKey];
            matchedMovie = showsList.find(
              (s) => Number(s.tmdbId) === Number(tmdbData.id) && s.mediaType === 'movie'
            );
            if (skipAlreadyWatchedMovie(matchedMovie)) {
              continue;
            }
          }

          // 3. If still not resolved, query TMDB via helper
          if (!matchedMovie && !tmdbData) {
            tmdbData = await resolveAndCachePlexItem(cacheKey, item);

            if (!tmdbData) {
              unresolvedCount++;
              recordUnresolvedItem(item, 'movie');
              appLogger.info('plex', `[Plex Sync] Fiche film "${cleanMovieTitle}" ignorée (impossible de résoudre l'ID TMDB).`);
              continue;
            }

            // Déduplication uniquement après obtention du TMDB ID vérifié.
            matchedMovie = showsList.find(
              (s) => Number(s.tmdbId) === Number(tmdbData.id) && s.mediaType === 'movie'
            );
            if (skipAlreadyWatchedMovie(matchedMovie)) {
              continue;
            }
          }

          if (matchedMovie) {
            const showId = matchedMovie.id;
            if (!mutatedShows[showId]) {
              mutatedShows[showId] = { ...matchedMovie };
            }
            const showData = mutatedShows[showId];
            const seenEpisodes = [...(showData.seenEpisodes || [])];

            // Check if already seen
            if (!isPlexMovieAlreadyWatched(showData)) {
              seenEpisodes.push('movie');
              const episodeRecords = { ...(showData.episodeRecords || {}) };
              episodeRecords['movie'] = {
                watchedAt: viewedTimestamp,
                ...(episodeRecords['movie'] || {}),
                plexImported: true
              };

              showData.seenEpisodes = seenEpisodes;
              showData.episodeRecords = episodeRecords;
              showData.lastWatchedAt = viewedTimestamp;
              showData.status = 'completed';
              showData.updatedAt = Date.now();

              syncCount++;
              moviesCount++;

              queueSyncedItem(buildResolvedPlexIdentity('movie', showData.tmdbId), {
                title: showData.title || movieTitle,
                subtitle: 'Film',
                posterPath: showData.posterPath,
                mediaType: 'movie',
                show: showData
              });
            }
          } else if (tmdbData && tmdbData.id) {
            // Genuinely new movie discovered from Plex!
            const newShowRef = doc(collection(db, `users/${user.uid}/shows`));
            const showId = newShowRef.id;

            const newShowData: Show = {
              id: showId,
              userId: user.uid,
              tmdbId: tmdbData.id,
              title: tmdbData.title || movieTitle,
              originalTitle: tmdbData.original_title || movieTitle,
              mediaType: 'movie',
              status: 'completed',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              lastWatchedAt: viewedTimestamp,
              posterPath: tmdbData.poster_path
                ? tmdbData.poster_path.startsWith('http')
                  ? tmdbData.poster_path
                  : `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}`
                : null,
              backdropPath: tmdbData.backdrop_path
                ? tmdbData.backdrop_path.startsWith('http')
                  ? tmdbData.backdrop_path
                  : `https://image.tmdb.org/t/p/w1280${tmdbData.backdrop_path}`
                : null,
              firstAirDate: tmdbData.release_date || '',
              networks: [],
              seenEpisodes: ['movie'],
              episodeRecords: { movie: { watchedAt: viewedTimestamp, plexImported: true } },
              isArchived: false
            };

            mutatedShows[showId] = newShowData;
            showsList.push(newShowData);

            syncCount++;
            moviesCount++;

            queueSyncedItem(buildResolvedPlexIdentity('movie', newShowData.tmdbId), {
              title: newShowData.title,
              subtitle: 'Film',
              posterPath: newShowData.posterPath,
              mediaType: 'movie',
              show: newShowData
            });
          }
        }
      }


      // Un FULL Plex contient l'état courant explicite viewCount de la bibliothèque.
      // On applique les non-vu APRÈS les ajouts d'historique afin qu'un viewCount=0
      // courant gagne sur un événement historique plus ancien. Une absence seule ne
      // vaut jamais dé-vu : seuls les états reçus ici peuvent supprimer une progression.
      if (hasLibraryWatchStates) {
        for (const state of libraryWatchStates as PlexLibraryWatchState[]) {
          if (!state || state.watched !== false) continue;
          const mediaType = state.mediaType === 'movie' ? 'movie' : 'tv';
          const matched = showsList.find(show => Number(show.tmdbId) === Number(state.tmdbId) && show.mediaType === mediaType);
          if (!matched) continue;

          const current = mutatedShows[matched.id] || matched;
          const result = applyPlexLibraryWatchState(current, state);
          if (!result.changed) continue;

          // Le miroir technique plexWatchState peut évoluer sans modifier la progression.
          // On le persiste, mais seul un retrait réellement possédé par Plex est un dé-vu métier.
          mutatedShows[matched.id] = result.show;
          const listIndex = showsList.findIndex(show => show.id === matched.id);
          if (listIndex >= 0) showsList[listIndex] = result.show;
          if (!result.unwatchApplied) continue;

          unwatchedCount++;
          syncCount++;
          if (mediaType === 'movie') moviesCount++;
          else episodesCount++;

          const identity = state.mediaType === 'movie'
            ? `unwatch:movie:${state.tmdbId}`
            : `unwatch:tv:${state.tmdbId}:${state.seasonNumber}:${state.episodeNumber}`;
          queueSyncedItem(identity, {
            title: result.show.title,
            subtitle: state.mediaType === 'movie'
              ? 'Dé-vu sur Plex'
              : `S${state.seasonNumber} | E${state.episodeNumber} • Dé-vu sur Plex`,
            posterPath: result.show.posterPath,
            mediaType,
            show: result.show
          });
        }
      }

      // Process Plex Watchlist items (auto-import to "À Voir" / "Ma Liste")
      if (hasWatchlist) {
        for (const rawWlItem of watchlist) {
          const wlItem = unwrapPlexMediaItem(rawWlItem);
          const mediaType: 'tv' | 'movie' = wlItem.type === 'show' || wlItem.type === 'series' || wlItem.type === 'tv' ? 'tv' : 'movie';
          const rawTitle = wlItem.title || wlItem.grandparentTitle || 'Média inconnu';

          const cleanTitle = rawTitle.replace(/\(\d{4}\)/g, '').trim();
          const guidTmdbId = extractTmdbIdFromPlex(wlItem);
          const cacheKey = buildPlexResolutionCacheKey(mediaType, wlItem);
          const directIdentity = getPlexWatchlistMediaIdentity(mediaType, guidTmdbId);
          if (directIdentity) currentWatchlistIdentities.add(directIdentity);

          // 1. Check if already in user's local library by TMDB ID
          let matchedShow = findShowInLocalLibrary(showsList, guidTmdbId, mediaType);
          if (matchedShow) {
            const matchedIdentity = getPlexWatchlistMediaIdentity(mediaType, matchedShow.tmdbId);
            if (matchedIdentity) currentWatchlistIdentities.add(matchedIdentity);
            continue;
          }

          // 2. Check resolution cache
          let tmdbData: any = null;
          if (cacheKey && resolutionCache[cacheKey]) {
            tmdbData = resolutionCache[cacheKey];
            const cachedIdentity = getPlexWatchlistMediaIdentity(mediaType, tmdbData.id);
            if (cachedIdentity) {
              currentWatchlistIdentities.add(cachedIdentity);
              matchedShow = showsList.find(
                (s) => Number(s.tmdbId) === Number(tmdbData.id) && (s.mediaType === mediaType || (mediaType === 'tv' && !s.mediaType))
              );
              if (matchedShow) continue;
            } else {
              delete resolutionCache[cacheKey];
              cacheModified = true;
              tmdbData = null;
            }
          }

          // 3. Resolve TMDB data for Watchlist item
          if (!tmdbData) {
            tmdbData = await resolveAndCachePlexItem(cacheKey, wlItem);
          }

          const resolvedIdentity = getPlexWatchlistMediaIdentity(mediaType, tmdbData?.id);
          if (!resolvedIdentity) {
            unresolvedCount++;
            watchlistUnresolvedItemCount++;
            recordUnresolvedItem(wlItem, 'watchlist');
            appLogger.info('plex', `[Plex Sync] Item Watchlist "${cleanTitle}" ignoré (impossible de résoudre l'ID TMDB).`);
            continue;
          }
          currentWatchlistIdentities.add(resolvedIdentity);
          matchedShow = showsList.find(
            (s) => Number(s.tmdbId) === Number(tmdbData.id) && (s.mediaType === mediaType || (mediaType === 'tv' && !s.mediaType))
          );
          if (matchedShow) continue;

          // 4. Create new show in 'plan_to_watch' status ("À Voir" / "Ma Liste")
          if (tmdbData && tmdbData.id) {
            const newShowRef = doc(collection(db, `users/${user.uid}/shows`));
            const showId = newShowRef.id;

            const newShowData: Show = {
              id: showId,
              userId: user.uid,
              tmdbId: tmdbData.id,
              title: tmdbData.title || tmdbData.name || cleanTitle,
              originalTitle: tmdbData.original_title || tmdbData.original_name || cleanTitle,
              mediaType,
              status: 'plan_to_watch',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              posterPath: tmdbData.poster_path
                ? tmdbData.poster_path.startsWith('http')
                  ? tmdbData.poster_path
                  : `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}`
                : null,
              backdropPath: tmdbData.backdrop_path
                ? tmdbData.backdrop_path.startsWith('http')
                  ? tmdbData.backdrop_path
                  : `https://image.tmdb.org/t/p/w1280${tmdbData.backdrop_path}`
                : null,
              firstAirDate: tmdbData.first_air_date || tmdbData.release_date || '',
              networks: [],
              seenEpisodes: [],
              episodeRecords: {},
              isArchived: false,
              trackingProvenance: buildPlexWatchlistTrackingProvenance(mediaType, tmdbData.id)
            };

            mutatedShows[showId] = newShowData;
            showsList.push(newShowData);

            syncCount++;
            if (mediaType === 'movie') moviesCount++;

            queueSyncedItem(`watchlist:${buildResolvedPlexIdentity(mediaType, newShowData.tmdbId)}`, {
              title: newShowData.title,
              subtitle: mediaType === 'movie' ? 'Film' : 'Série',
              isWatchlist: true,
              posterPath: newShowData.posterPath,
              mediaType,
              show: newShowData
            });
          }
        }
      }

      const watchlistRemovalSnapshot = {
        mode: delta ? 'delta' as const : 'full' as const,
        complete: watchlistSnapshotComplete,
        unresolvedItemCount: watchlistUnresolvedItemCount,
        mediaIdentities: currentWatchlistIdentities
      };
      const watchlistRemovalCandidates = selectPlexWatchlistTrackingRemovals(
        showsList,
        watchlistRemovalSnapshot
      );
      if (!watchlistSnapshotComplete) {
        appLogger.info('plex', '[Plex Watchlist] Retraits ignorés : snapshot non exhaustif ou indisponible.');
      } else if (watchlistUnresolvedItemCount > 0) {
        appLogger.warn('plex', `[Plex Watchlist] Retraits différés : ${watchlistUnresolvedItemCount} identité(s) non résolue(s).`);
      }

      if (unwatchedCount > 0) {
        appLogger.info('plex', `[Plex Sync] ${unwatchedCount} dé-vu explicite(s) réconcilié(s) depuis l’inventaire courant.`);
      }

      if (cacheModified) {
        setPlexResolutionCache(user.uid, resolutionCache);
        await persistPlexCloudState(user.uid, {
          resolutionCache: compactPlexResolutionCache(resolutionCache)
        });
      }

      if (syncCount > 0 || Object.keys(mutatedShows).length > 0 || watchlistRemovalCandidates.length > 0) {
        // 2. Save all mutated and new shows to Firestore in safe chunks of 250
        const showEntries = Object.entries(mutatedShows);
        const BATCH_SIZE = 250;
        for (let i = 0; i < showEntries.length; i += BATCH_SIZE) {
          const chunk = showEntries.slice(i, i + BATCH_SIZE);
          await runTransaction(db, async (transaction) => {
            const refs = chunk.map(([id, data]) => ({
              id,
              data,
              ref: doc(db, `users/${user.uid}/shows`, id)
            }));
            const currentSnapshots = await Promise.all(
              refs.map(({ ref }) => transaction.get(ref))
            );

            for (let index = 0; index < refs.length; index++) {
              const { data, ref } = refs[index];
              const snapshot = currentSnapshots[index];
              const currentSeenItState = snapshot.exists() ? snapshot.data() : null;
              const baseline = baselineShowsById.get(data.id) || null;
              const reconciledData = mergePlexProgressMutation(currentSeenItState, baseline, data);
              const cleanData = cleanShowForFirestore(reconciledData, user.uid);
              // Remplacement complet : nécessaire pour que les clés episodeRecords supprimées
              // par un dé-vu disparaissent réellement de Firestore.
              transaction.set(ref, cleanData);
            }
          });
        }

        // Le snapshot de départ ne suffit pas pour une suppression : la transaction
        // relit chaque document et laisse gagner toute intention SeenIt concurrente.
        const removedWatchlistShows: Show[] = [];
        for (let i = 0; i < watchlistRemovalCandidates.length; i += BATCH_SIZE) {
          const chunk = watchlistRemovalCandidates.slice(i, i + BATCH_SIZE);
          const removedChunk = await runTransaction(db, async (transaction) => {
            const refs = chunk.map(show => ({
              show,
              ref: doc(db, `users/${user.uid}/shows`, show.id)
            }));
            const currentSnapshots = await Promise.all(refs.map(({ ref }) => transaction.get(ref)));
            const removed: Show[] = [];

            for (let index = 0; index < refs.length; index++) {
              const { ref, show } = refs[index];
              const currentSnapshot = currentSnapshots[index];
              if (!currentSnapshot.exists()) continue;
              const currentShow = { ...currentSnapshot.data(), id: show.id } as Show;
              const [eligible] = selectPlexWatchlistTrackingRemovals(
                [currentShow],
                watchlistRemovalSnapshot
              );
              if (!eligible) continue;
              transaction.delete(ref);
              removed.push(currentShow);
            }

            return removed;
          });
          removedWatchlistShows.push(...removedChunk);
        }

        for (const removedShow of removedWatchlistShows) {
          syncCount++;
          if (removedShow.mediaType === 'movie') moviesCount++;
          queueSyncedItem(`watchlist-removal:${getPlexWatchlistMediaIdentity(removedShow.mediaType, removedShow.tmdbId)}`, {
            title: removedShow.title,
            subtitle: removedShow.mediaType === 'movie' ? 'Film' : 'Série',
            isWatchlistRemoval: true,
            posterPath: removedShow.posterPath,
            mediaType: removedShow.mediaType,
            show: removedShow
          });
        }

        // 3. Relire le serveur après les commits : le même UID obtient ainsi le
        // même état final sur PWA et APK, sans fusion locale implicite.
        await useShowsStore.getState().fetchShows();

        // Queue sequential toasts for each synced item (5s each)
        syncedItems.forEach((item) => {
          const actionText = item.isWatchlistRemoval
            ? 'Watchlist Plex • Retiré du suivi'
            : item.isWatchlist
              ? 'Watchlist Plex • Ajouté à voir'
              : 'Vu sur Plex • Synchronisé';

          useToastStore.getState().showToast(
            {
              title: item.title,
              subtitle: item.subtitle,
              action: actionText,
              posterPath: item.posterPath
            },
            'success',
            item.show,
            undefined,
            5000
          );
        });

        clearPlexSyncStatusDelayed(`Synchro terminée (${syncCount} changement(s))`, 3500);
      } else {
        // // appLogger.info('plex', 'Synchronisation terminée : 0 nouveau média (votre bibliothèque est déjà à jour)');
        clearPlexSyncStatusDelayed('Sync Plex terminée (à jour)', 3500);
      }

      appLogger.success(
        'plex',
        `[Plex Sync] Bilan : ${syncCount} changement(s), ${alreadyWatchedCount} déjà vu(s) ignoré(s), ${unresolvedCount} non résolu(s), ${repairedCount} index vu(s) réparé(s) sans notification.`
      );
      if (unresolvedItems.length > 0) {
        appLogger.warn(
          'plex',
          `[Plex Sync] Liste des ${unresolvedItems.length} non résolu(s) — ajout manuel possible dans SeenIt, aucune correspondance automatique par titre.`
        );
        unresolvedItems.forEach((unresolvedItem, index) => {
          appLogger.warn(
            'plex',
            `[Plex Sync] Non résolu ${index + 1}/${unresolvedItems.length} • ${unresolvedItem.label} • source=${unresolvedItem.source} • référence=${unresolvedItem.reference}`
          );
        });
      }

      const canCommitCursor = shouldCommitPlexCursor({
        collectionComplete: plexData?.integrity?.collectionComplete,
        retryableUnresolvedCount,
        firestoreCommitted: true
      });
      if (canCommitCursor) {
        setPlexLastSyncTimestamp(user.uid, nextSyncCursor);
        await persistPlexCloudState(user.uid, {
          lastSyncTimestamp: nextSyncCursor,
          resolutionCache: compactPlexResolutionCache(resolutionCache)
        });
        clearPlexSyncStatusDelayed(completedServerStatus, 5000);
        if (!silent && serverSyncSummary) {
          useToastStore.getState().showToast(
            `Synchronisation Plex terminée • ${serverSyncSummary}`,
            'success',
            undefined,
            undefined,
            7000
          );
        }
      } else {
        const reason = describeIncompletePlexSync(plexData?.integrity, retryableUnresolvedCount);
        appLogger.warn('plex', `[Plex Sync] Curseur conservé pour permettre un nouvel essai : ${reason}.`);
        if (!silent) {
          useToastStore.getState().showToast(`Plex sera retenté automatiquement : ${reason}.`, 'info');
        }
      }

      return {
        success: canCommitCursor,
        syncedCount: syncCount,
        moviesCount,
        episodesCount,
        syncedItems,
        ...(canCommitCursor ? {} : { error: describeIncompletePlexSync(plexData?.integrity, retryableUnresolvedCount) })
      };
    } catch (err: any) {
      const technicalErrorMsg = err?.message || String(err);
      const errorMsg = describeBackendNetworkFailure(err);
      appLogger.error('plex', 'Exception lors de la synchronisation Plex', { error: technicalErrorMsg });
      clearPlexSyncStatusDelayed(`Erreur Plex : ${errorMsg}`, 4000);
      if (!silent) {
        useToastStore.getState().showToast(`Erreur de synchronisation Plex : ${errorMsg}`, 'error');
      }
      return { success: false, syncedCount: 0, moviesCount: 0, episodesCount: 0, syncedItems: [], error: errorMsg };
    }
  };

  const currentUserId = requestedUser?.uid;
  if (!currentUserId) {
    return syncExecution();
  }
  const active = activePlexSyncPromises.get(currentUserId);
  if (active) return active;

  const promise = syncExecution().finally(() => {
    activePlexSyncPromises.delete(currentUserId);
  });
  activePlexSyncPromises.set(currentUserId, promise);
  return promise;
}

/**
 * Génère et stocke un X-Plex-Client-Identifier (UUIDv4) persistant dans le LocalStorage
 */
