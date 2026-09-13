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

import { getPlexBackendUrl } from './plexResolution';

export function getPlexClientIdentifier(): string {
  try {
    return getPlexClientId();
  } catch (e) {
    return '10000000-1000-4000-8000-100000000000';
  }
}

/**
 * Génère les en-têtes HTTP authentifiés officiels requis pour toutes les requêtes vers l'API Plex
 */
export function getPlexHeaders(): Record<string, string> {
  const token = getStoredPlexToken(auth.currentUser?.uid) || '';
  const headers: Record<string, string> = {
    'X-Plex-Product': 'SeenIt',
    'X-Plex-Version': CURRENT_APP_VERSION || '1.4.0',
    'X-Plex-Client-Identifier': getPlexClientIdentifier(),
    'Accept': 'application/json'
  };
  if (token) {
    headers['X-Plex-Token'] = token;
  }
  return headers;
}

/**
 * Résout la fiche Plex d'un média par ID TMDB officiel via matches Plex (sans redirection accueil si échec)
 */
export const openPlexWatchUrl = async (show: any) => {
  const tmdbId = show?.tmdbId;
  const title = show?.title || show?.name || '';
  const type = (show?.mediaType === 'tv' || show?.mediaType === 'show' || show?.type === 'show') ? 'show' : 'movie';
  const showId = show?.id;
  const userId = auth.currentUser?.uid;

  if (!tmdbId) {
    appLogger.warn('plex', `[Plex Official] Aucun identifiant TMDB disponible pour "${title || 'Média'}". Résolution annulée.`);
    return;
  }

  const expectedResolvedFrom = `tmdb:${tmdbId}`;

  const verifiedAvailability = userId
    ? usePlexAvailabilityStore.getState().getMediaAvailability(
        getPlexMediaKey(tmdbId, type === 'show' ? 'tv' : 'movie', userId)
      )
    : undefined;

  if (
    verifiedAvailability?.available &&
    verifiedAvailability.serverId &&
    verifiedAvailability.ratingKey &&
    verifiedAvailability.plexUrl
  ) {
    appLogger.info('plex', `[Plex Official] Ouverture de l'élément personnel vérifié (${verifiedAvailability.serverId}/${verifiedAvailability.ratingKey}).`);
    const opened = await openExternalUrl(verifiedAvailability.plexUrl);
    if (!opened) {
      useToastStore.getState().showToast(`Impossible d'ouvrir Plex sur cet appareil.`, 'error');
    }
    return;
  }

  if (
    show?.plexSlug &&
    show?.plexResolvedFrom === expectedResolvedFrom
  ) {
    appLogger.info('plex', `[Plex Official] Slug BDD validé : "${show.plexSlug}" (${show.plexResolvedFrom}) -> https://watch.plex.tv/${type}/${show.plexSlug}`);
    const opened = await openExternalUrl(`https://watch.plex.tv/${type}/${show.plexSlug}`);
    if (!opened) {
      useToastStore.getState().showToast(`Impossible d'ouvrir Plex sur cet appareil.`, 'error');
    }
    return;
  }

  appLogger.info('plex', `[Plex Official] Résolution du slug pour "${title || 'N/A'}" (TMDB: ${tmdbId}, ${type})...`);

  const isNative = Capacitor.isNativePlatform();
  const plexType = type === 'show' ? 2 : 1;
  const plexHeaders = getPlexHeaders();

  let resolvedSlug: string | null = null;
  let resolvedGuid: string | null = null;
  let resolvedFrom: string | null = null;

  // 1. TENTATIVE DIRECTE OFFICIELLE PLEX (TMDB guid)
  try {
    const matchesUrl = `https://metadata.provider.plex.tv/library/metadata/matches?guid=${encodeURIComponent(`tmdb://${tmdbId}`)}&type=${plexType}`;
    let data: any = null;

    if (isNative) {
      const nativeRes = await CapacitorHttp.get({
        url: matchesUrl,
        headers: plexHeaders,
        connectTimeout: 5000,
        readTimeout: 5000
      });
      if (nativeRes.status >= 200 && nativeRes.status < 300) {
        data = typeof nativeRes.data === 'string' ? JSON.parse(nativeRes.data) : nativeRes.data;
      }
    } else {
      const response = await fetch(matchesUrl, {
        headers: plexHeaders,
        signal: AbortSignal.timeout(5000)
      });
      if (response.ok) {
        data = await response.json();
      }
    }

    const results = data?.MediaContainer?.Metadata || data?.MediaContainer?.SearchResult;
    const match = Array.isArray(results)
      ? results.find((item: any) =>
          item?.slug && isStrictPlexIdentityMatch(item, { tmdbId, mediaType: type })
        )
      : null;

    if (match && match.slug) {
      resolvedSlug = match.slug;
      resolvedGuid = match.guid || null;
      resolvedFrom = expectedResolvedFrom;
      appLogger.info('plex', `[Plex Official] ✅ Slug résolu en direct Plex : "${resolvedSlug}" (TMDB: ${tmdbId})`);
    }
  } catch (err: any) {
    // En cas d'erreur réseau directe, tenter le backend
  }

  // 2. FALLBACK VIA BACKEND SI NÉCESSAIRE
  if (!resolvedSlug) {
    const resolveEndpoint = getPlexBackendUrl('/api/plex/resolve-slug');

    const clientId = getPlexClientIdentifier();
    const queryParams = new URLSearchParams();
    queryParams.set('tmdbId', String(tmdbId));
    queryParams.set('type', type);
    if (clientId) queryParams.set('clientId', clientId);

    try {
      let data: any = null;
      const fullUrl = `${resolveEndpoint}?${queryParams.toString()}`;

      if (isNative) {
        const nativeRes = await CapacitorHttp.get({
          url: fullUrl,
          headers: await getAuthenticatedHeaders(plexHeaders),
          connectTimeout: 8000,
          readTimeout: 8000
        });
        if (nativeRes.status >= 200 && nativeRes.status < 300) {
          data = typeof nativeRes.data === 'string' ? JSON.parse(nativeRes.data) : nativeRes.data;
        }
      } else {
        const response = await authenticatedFetch(fullUrl, {
          headers: plexHeaders
        });
        if (response.ok) {
          data = await response.json();
        }
      }

      if (data?.slug && data?.resolvedFrom === expectedResolvedFrom) {
        resolvedSlug = data.slug;
        resolvedGuid = data.plexGuid || data.guid || null;
        resolvedFrom = data.resolvedFrom;
      }
    } catch (error) {
      appLogger.warn('plex', `[Plex Official] Backend de résolution indisponible.`);
    }
  }

  if (resolvedSlug) {
    appLogger.info('plex', `[Plex Official] ✅ Slug résolu : "${resolvedSlug}". Sauvegarde en BDD et ouverture.`);
    // 3. Save to DB so we don't have to fetch again
    if (showId && userId) {
      try {
        const showRef = doc(db, `users/${userId}/shows`, showId);
        const updatePayload: Record<string, any> = {
          plexSlug: resolvedSlug,
          plexResolvedFrom: resolvedFrom || expectedResolvedFrom || null
        };
        if (resolvedGuid) {
          updatePayload.plexGuid = resolvedGuid;
        }
        await updateDoc(showRef, updatePayload);

        // Optimistically update the store
        const storeShows = useShowsStore.getState().shows;
        const idx = storeShows.findIndex(s => s.id === showId);
        if (idx >= 0) {
          const updated = [...storeShows];
          updated[idx] = {
            ...updated[idx],
            plexSlug: resolvedSlug,
            plexResolvedFrom: resolvedFrom || expectedResolvedFrom,
            ...(resolvedGuid ? { plexGuid: resolvedGuid } : {})
          };
          useShowsStore.getState().setShows(updated);
        }
      } catch (err) {
        console.warn('Failed to save plexSlug to DB', err);
      }
    }
    const opened = await openExternalUrl(`https://watch.plex.tv/${type}/${resolvedSlug}`);
    if (!opened) {
      useToastStore.getState().showToast(`Impossible d'ouvrir Plex sur cet appareil.`, 'error');
    }
    return;
  }

  // 4. En cas d'échec de résolution du slug : NE PAS rediriger vers l'accueil watch.plex.tv !
  appLogger.error('plex', `[Plex Official] ❌ Impossible de résoudre la fiche Plex pour "${title || 'Média'}" (TMDB: ${tmdbId || 'N/A'}). Redirection annulée pour éviter l'accueil.`);
  useToastStore.getState().showToast(
    `Impossible d'ouvrir ce média dans Plex : aucun identifiant Plex vérifié.`,
    'error'
  );
};

/**
 * Purge tous les slugs Plex en cache / en BDD pour éliminer les faux slugs passés
 */
export const purgeAllPlexSlugsInDb = async (): Promise<number> => {
  const userId = auth.currentUser?.uid;
  if (!userId) return 0;

  try {
    appLogger.info('plex', `[Plex Purge] Début de la purge des anciens slugs Plex...`);
    const showsSnapshot = await getDocs(collection(db, `users/${userId}/shows`));
    const batch = writeBatch(db);
    let count = 0;

    showsSnapshot.forEach((d) => {
      const data = d.data();
      if (data && (data.plexSlug || data.plexGuid || data.plexResolvedFrom)) {
        batch.update(d.ref, {
          plexSlug: deleteField(),
          plexGuid: deleteField(),
          plexResolvedFrom: deleteField()
        });
        count++;
      }
    });

    if (count > 0) {
      await batch.commit();
      appLogger.info('plex', `[Plex Purge] ✅ ${count} fiches Plex purgées avec succès en BDD Firestore.`);
    } else {
      appLogger.info('plex', `[Plex Purge] Aucun slug Plex à purger en BDD.`);
    }

    // Mise à jour de l'état local Zustand
    const currentShows = useShowsStore.getState().shows;
    const cleanedShows = currentShows.map(s => {
      if (s.plexSlug || (s as any).plexGuid || (s as any).plexResolvedFrom) {
        const copy = { ...s };
        delete copy.plexSlug;
        delete (copy as any).plexGuid;
        delete (copy as any).plexResolvedFrom;
        return copy;
      }
      return s;
    });
    useShowsStore.getState().setShows(cleanedShows);

    return count;
  } catch (err: any) {
    appLogger.error('plex', `[Plex Purge] Erreur lors de la purge des slugs Plex: ${err?.message || err}`);
    return 0;
  }
};

// Auto-purge unique pour nettoyer les anciens slugs corrompus des versions précédentes
if (typeof window !== 'undefined') {
  auth.onAuthStateChanged((user) => {
    if (!user?.uid) return;
    const purgeKey = getPlexUserStorageKey(user.uid, 'slugPurgeVersion');
    if (localStorage.getItem(purgeKey) !== '1.4.38') {
      purgeAllPlexSlugsInDb().then(() => {
        localStorage.setItem(purgeKey, '1.4.38');
      }).catch(() => {});
    }
  });
}
