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

export interface PlexSyncResult {
  success: boolean;
  syncedCount: number;
  moviesCount: number;
  episodesCount: number;
  syncedItems: Array<{ title: string; subtitle?: string; isWatchlist?: boolean; isWatchlistRemoval?: boolean; posterPath?: string | null; mediaType: 'tv' | 'movie'; show: Show }>;
  error?: string;
}

export interface PlexUnresolvedLogItem {
  label: string;
  source: string;
  reference: string;
}

export function getPlexGuid(rawItem: any): string | null {
  if (!rawItem) return null;
  const item = unwrapPlexMediaItem(rawItem);

  // 1. Direct string guid
  if (typeof item.guid === 'string' && item.guid.trim() !== '') {
    return item.guid.trim();
  }

  // 2. Direct string Guid
  if (typeof item.Guid === 'string' && item.Guid.trim() !== '') {
    return item.Guid.trim();
  }

  // 3. Guid array containing objects { id: 'plex://...' } or strings
  if (Array.isArray(item.Guid)) {
    const plexObj = item.Guid.find(
      (g: any) => typeof g?.id === 'string' && g.id.startsWith('plex://')
    );
    if (plexObj?.id) return plexObj.id.trim();

    const anyObj = item.Guid.find(
      (g: any) => typeof g?.id === 'string' && g.id.trim() !== ''
    );
    if (anyObj?.id) return anyObj.id.trim();

    const strObj = item.Guid.find(
      (g: any) => typeof g === 'string' && g.trim() !== ''
    );
    if (strObj) return strObj.trim();
  }

  // 4. guids array
  if (Array.isArray(item.guids)) {
    const plexObj = item.guids.find(
      (g: any) => typeof g?.id === 'string' && g.id.startsWith('plex://')
    );
    if (plexObj?.id) return plexObj.id.trim();

    const anyObj = item.guids.find(
      (g: any) => typeof g?.id === 'string' && g.id.trim() !== ''
    );
    if (anyObj?.id) return anyObj.id.trim();
  }

  // 5. grandparentGuid
  if (typeof item.grandparentGuid === 'string' && item.grandparentGuid.trim() !== '') {
    return item.grandparentGuid.trim();
  }

  // 6. parentGuid
  if (typeof item.parentGuid === 'string' && item.parentGuid.trim() !== '') {
    return item.parentGuid.trim();
  }

  // Un ratingKey/key PMS local n'est PAS un GUID provider global.
  // S'il n'existe aucun guid, la résolution serveur doit enrichir l'objet avant Discover.
  return null;
}

export const extractExternalIdsFromPlex = extractPlexExternalIds;

export const extractTmdbIdFromPlex = (item: any): number | null => {
  return extractExternalIdsFromPlex(item).tmdbId;
};

class RetryablePlexResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryablePlexResolutionError';
  }
}

function readTmdbResolutionResult<T>(result: any, context: string): T | null {
  if (result?.ok && result.value) return result.value as T;

  const errorMessage = result?.error?.message || String(result?.error || 'Erreur TMDB inconnue');
  const isPermanentMiss = isPermanentPlexResolutionMiss(errorMessage);
  if (isPermanentMiss) return null;

  throw new RetryablePlexResolutionError(`${context} : ${errorMessage}`);
}

function rethrowRetryablePlexResolution(error: unknown): never {
  if (error instanceof RetryablePlexResolutionError) throw error;
  const message = error instanceof Error ? error.message : String(error);
  throw new RetryablePlexResolutionError(`Accès aux métadonnées Plex : ${message}`);
}

export async function resolveMovieToTmdb(item: any, plexToken?: string) {
  const unwrapped = unwrapPlexMediaItem(item);
  const movieTitle = unwrapped.title || 'Film inconnu';
  const pGuid = getPlexGuid(unwrapped);
  const { tmdbId, imdbId, tvdbId, plexGuid } = extractExternalIdsFromPlex(unwrapped);

  appLogger.info('plex', `[Plex Resolve] Film Plex détecté : "${movieTitle}"`);
  appLogger.info('plex', `[Plex Resolve] plexGuid=${plexGuid || pGuid || 'aucun'}`);

  // 1. TMDB ID direct
  if (tmdbId) {
    appLogger.info('plex', `[Plex Resolve] Tentative TMDB ID direct (${tmdbId})...`);
    const detailsRes = await tmdb.getMediaDetails(tmdbId, 'movie');
    const details = readTmdbResolutionResult<any>(detailsRes, `TMDB film ${tmdbId}`);
    if (details) {
      appLogger.info('plex', `[Plex Resolve] TMDB ID=${details.id}`);
      appLogger.info('plex', `[Plex Resolve] ✅ Résolution film réussie : "${details.title}"`);
      return details;
    }
  }

  // 2. IMDb ID
  if (imdbId) {
    appLogger.info('plex', `[Plex Resolve] Tentative IMDb ID (${imdbId})...`);
    const findRes = await tmdb.findByExternalId(imdbId, 'imdb_id', 'movie');
    const match = readTmdbResolutionResult<any>(findRes, `IMDb film ${imdbId}`);
    if (match) {
      appLogger.info('plex', `[Plex Resolve] TMDB ID=${match.id}`);
      appLogger.info('plex', `[Plex Resolve] ✅ Résolution film réussie : "${match.title}"`);
      return match;
    }
  }

  // 3. TVDb ID
  if (tvdbId) {
    appLogger.info('plex', `[Plex Resolve] Tentative TVDb ID (${tvdbId})...`);
    const findRes = await tmdb.findByExternalId(String(tvdbId), 'tvdb_id', 'movie');
    const match = readTmdbResolutionResult<any>(findRes, `TVDB film ${tvdbId}`);
    if (match) {
      appLogger.info('plex', `[Plex Resolve] TMDB ID=${match.id}`);
      appLogger.info('plex', `[Plex Resolve] ✅ Résolution film réussie : "${match.title}"`);
      return match;
    }
  }

  // 4. Plex Discover API
  const cleanHash = plexGuid || (pGuid ? pGuid.replace(/^plex:\/\/(movie|show|season|episode)\//i, '').replace(/^\/library\/metadata\//i, '').trim() : null);
  if (cleanHash && plexToken) {
    try {
      appLogger.info('plex', `[Plex Resolve] Appel Plex Discover (${cleanHash})`);
      const plexMetaUrl = `https://discover.provider.plex.tv/library/metadata/${cleanHash}`;
      const res = await fetch(plexMetaUrl, { headers: { 'Accept': 'application/json', 'X-Plex-Token': plexToken } });
      if (!res.ok && res.status !== 404) {
        throw new RetryablePlexResolutionError(`Plex Discover film HTTP ${res.status}`);
      }
      if (res.ok) {
        const data = await res.json();
        const metaItem = data?.MediaContainer?.Metadata?.[0];
        if (metaItem) {
          const fetchedIds = extractExternalIdsFromPlex(metaItem);
          if (fetchedIds.tmdbId) {
            const detailsRes = await tmdb.getMediaDetails(fetchedIds.tmdbId, 'movie');
            const details = readTmdbResolutionResult<any>(detailsRes, `TMDB film Discover ${fetchedIds.tmdbId}`);
            if (details) {
              appLogger.info('plex', `[Plex Resolve] TMDB ID=${details.id}`);
              appLogger.info('plex', `[Plex Resolve] ✅ Résolution film réussie (via Plex Discover) : "${details.title}"`);
              return details;
            }
          }
          if (fetchedIds.imdbId) {
            const findRes = await tmdb.findByExternalId(fetchedIds.imdbId, 'imdb_id', 'movie');
            const match = readTmdbResolutionResult<any>(findRes, `IMDb film Discover ${fetchedIds.imdbId}`);
            if (match) {
              appLogger.info('plex', `[Plex Resolve] TMDB ID=${match.id}`);
              appLogger.info('plex', `[Plex Resolve] ✅ Résolution film réussie (via Discover IMDb) : "${match.title}"`);
              return match;
            }
          }
          if (fetchedIds.tvdbId) {
            const findRes = await tmdb.findByExternalId(String(fetchedIds.tvdbId), 'tvdb_id', 'movie');
            const match = readTmdbResolutionResult<any>(findRes, `TVDB film Discover ${fetchedIds.tvdbId}`);
            if (match) {
              appLogger.info('plex', `[Plex Resolve] TMDB ID=${match.id}`);
              appLogger.info('plex', `[Plex Resolve] ✅ Résolution film réussie (via Discover TVDb) : "${match.title}"`);
              return match;
            }
          }
        }
      }
    } catch (err: any) {
      rethrowRetryablePlexResolution(err);
    }
  }

  appLogger.warn('plex', `[Plex Resolve] Film ignoré pour "${movieTitle}" : aucune chaîne d'identifiants TMDB/IMDb/TVDB/Plex vérifiable.`);
  return null;
}

export async function resolveShowToTmdb(item: any, plexToken?: string) {
  const unwrapped = unwrapPlexMediaItem(item);
  const rawShowTitle = unwrapped.grandparentTitle || unwrapped.parentTitle || unwrapped.title || 'Série inconnue';
  const pGuid = getPlexGuid(unwrapped);
  const { tmdbId, imdbId, tvdbId } = extractExternalIdsFromPlex(unwrapped);

  // 1. TMDB ID direct
  if (tmdbId) {
    appLogger.info('plex', `[Plex Resolve] Tentative TMDB ID direct série (${tmdbId})...`);
    const detailsRes = await tmdb.getMediaDetails(tmdbId, 'tv');
    const details = readTmdbResolutionResult<any>(detailsRes, `TMDB série ${tmdbId}`);
    if (details) {
      appLogger.info('plex', `[Plex Resolve] ✅ TMDB ID série (${tmdbId}) trouvé : "${details.name}"`);
      return details;
    }
  }

  // 2. IMDb ID
  if (imdbId) {
    appLogger.info('plex', `[Plex Resolve] Tentative IMDb ID série (${imdbId})...`);
    const findRes = await tmdb.findByExternalId(imdbId, 'imdb_id', 'tv');
    const match = readTmdbResolutionResult<any>(findRes, `IMDb série ${imdbId}`);
    if (match) {
      appLogger.info('plex', `[Plex Resolve] ✅ IMDb ID série (${imdbId}) résolu -> TMDB ID ${match.id} ("${match.name}")`);
      return match;
    }
  }

  // 3. TVDb ID
  if (tvdbId) {
    appLogger.info('plex', `[Plex Resolve] Tentative TVDb ID série (${tvdbId})...`);
    const findRes = await tmdb.findByExternalId(String(tvdbId), 'tvdb_id', 'tv');
    const match = readTmdbResolutionResult<any>(findRes, `TVDB série ${tvdbId}`);
    if (match) {
      appLogger.info('plex', `[Plex Resolve] ✅ TVDb ID série (${tvdbId}) résolu -> TMDB ID ${match.id} ("${match.name}")`);
      return match;
    }
  }

  // 4. Plex Discover API
  const targetGuidStr = unwrapped.grandparentGuid || unwrapped.parentGuid || unwrapped.guid || pGuid;
  let cleanHash: string | null = null;
  if (targetGuidStr && typeof targetGuidStr === 'string') {
    const parsedTargetGuid = parsePlexGuid(targetGuidStr);
    if (parsedTargetGuid) {
      cleanHash = parsedTargetGuid.id;
    } else {
      cleanHash = targetGuidStr.replace(/^plex:\/\/(movie|show|season|episode)\//i, '').replace(/^\/library\/metadata\//i, '').trim();
    }
  }

  if (cleanHash && plexToken) {
    try {
      appLogger.info('plex', `[Plex Resolve] Appel Plex Discover série (${cleanHash})`);
      const plexMetaUrl = `https://discover.provider.plex.tv/library/metadata/${cleanHash}`;
      const res = await fetch(plexMetaUrl, { headers: { 'Accept': 'application/json', 'X-Plex-Token': plexToken } });
      if (!res.ok && res.status !== 404) {
        throw new RetryablePlexResolutionError(`Plex Discover série HTTP ${res.status}`);
      }
      if (res.ok) {
        const data = await res.json();
        const metaItem = data?.MediaContainer?.Metadata?.[0];
        if (metaItem) {
          let showMetaItem = metaItem;
          if (metaItem.type === 'episode' && metaItem.grandparentGuid) {
            const parsedGrandparentGuid = parsePlexGuid(metaItem.grandparentGuid);
            if (parsedGrandparentGuid?.type === 'show') {
              const gpHash = parsedGrandparentGuid.id;
              const gpRes = await fetch(`https://discover.provider.plex.tv/library/metadata/${gpHash}`, { headers: { 'Accept': 'application/json', 'X-Plex-Token': plexToken } });
              if (!gpRes.ok && gpRes.status !== 404) {
                throw new RetryablePlexResolutionError(`Plex Discover série parente HTTP ${gpRes.status}`);
              }
              if (gpRes.ok) {
                const gpData = await gpRes.json();
                if (gpData?.MediaContainer?.Metadata?.[0]) {
                  showMetaItem = gpData.MediaContainer.Metadata[0];
                }
              }
            }
          } else if (metaItem.type === 'season' && metaItem.parentGuid) {
            const parsedParentGuid = parsePlexGuid(metaItem.parentGuid);
            if (parsedParentGuid?.type === 'show') {
              const parentHash = parsedParentGuid.id;
              const parentRes = await fetch(`https://discover.provider.plex.tv/library/metadata/${parentHash}`, { headers: { 'Accept': 'application/json', 'X-Plex-Token': plexToken } });
              if (!parentRes.ok && parentRes.status !== 404) {
                throw new RetryablePlexResolutionError(`Plex Discover saison parente HTTP ${parentRes.status}`);
              }
              if (parentRes.ok) {
                const parentData = await parentRes.json();
                if (parentData?.MediaContainer?.Metadata?.[0]) {
                  showMetaItem = parentData.MediaContainer.Metadata[0];
                }
              }
            }
          }

          const fetchedIds = extractExternalIdsFromPlex(showMetaItem);
          if (fetchedIds.tmdbId) {
            const detailsRes = await tmdb.getMediaDetails(fetchedIds.tmdbId, 'tv');
            const details = readTmdbResolutionResult<any>(detailsRes, `TMDB série Discover ${fetchedIds.tmdbId}`);
            if (details) {
              appLogger.info('plex', `[Plex Resolve] ✅ Discover Plex série -> TMDB ID ${fetchedIds.tmdbId} ("${details.name}")`);
              return details;
            }
          }
          if (fetchedIds.imdbId) {
            const findRes = await tmdb.findByExternalId(fetchedIds.imdbId, 'imdb_id', 'tv');
            const match = readTmdbResolutionResult<any>(findRes, `IMDb série Discover ${fetchedIds.imdbId}`);
            if (match) {
              appLogger.info('plex', `[Plex Resolve] ✅ Discover Plex série -> IMDb (${fetchedIds.imdbId}) -> TMDB ID ${match.id}`);
              return match;
            }
          }
          if (fetchedIds.tvdbId) {
            const findRes = await tmdb.findByExternalId(String(fetchedIds.tvdbId), 'tvdb_id', 'tv');
            const match = readTmdbResolutionResult<any>(findRes, `TVDB série Discover ${fetchedIds.tvdbId}`);
            if (match) {
              appLogger.info('plex', `[Plex Resolve] ✅ Discover Plex série -> TVDb (${fetchedIds.tvdbId}) -> TMDB ID ${match.id}`);
              return match;
            }
          }
        }
      }
    } catch (err: any) {
      rethrowRetryablePlexResolution(err);
    }
  }

  appLogger.warn('plex', `[Plex Resolve] Série ignorée pour "${rawShowTitle}" : aucune chaîne d'identifiants TMDB/IMDb/TVDB/Plex vérifiable.`);
  return null;
}

export async function resolveSeasonShowToTmdb(item: any, plexToken?: string) {
  const unwrapped = unwrapPlexMediaItem(item);
  const showItem = buildPlexParentShowIdentityItem(unwrapped);
  return resolveShowToTmdb(showItem, plexToken);
}

export async function resolveEpisodeShowToTmdb(item: any, plexToken?: string) {
  const unwrapped = unwrapPlexMediaItem(item);

  // IMPORTANT: Toujours utiliser grandparentTitle / parentTitle pour la série parent, JAMAIS le titre de l'épisode !
  const parentShowTitle = unwrapped.grandparentTitle || unwrapped.parentTitle || (unwrapped.type !== 'episode' ? unwrapped.title : 'Série inconnue');
  const seasonNum = unwrapped.parentIndex !== undefined ? Number(unwrapped.parentIndex) : 1;
  const episodeNum = unwrapped.index !== undefined ? Number(unwrapped.index) : 1;

  const parentIdentity = buildPlexParentShowIdentityItem(unwrapped);
  const { plexGuid } = extractExternalIdsFromPlex(parentIdentity);

  appLogger.info('plex', `[Plex Resolve] Episode Plex détecté`);
  appLogger.info('plex', `[Plex Resolve] plexGuid parent=${plexGuid || parentIdentity.guid || 'aucun'}`);
  appLogger.info('plex', `[Plex Resolve] Série parent="${parentShowTitle}"`);
  appLogger.info('plex', `[Plex Resolve] Saison=${seasonNum}`);
  appLogger.info('plex', `[Plex Resolve] Épisode=${episodeNum}`);

  const showItem = {
    ...parentIdentity,
    title: parentShowTitle,
    grandparentTitle: parentShowTitle,
    type: 'show'
  };

  const tmdbShowData = await resolveShowToTmdb(showItem, plexToken);

  if (tmdbShowData && tmdbShowData.id) {
    appLogger.info('plex', `[Plex Resolve] TMDB show ID=${tmdbShowData.id}`);
    appLogger.info('plex', `[Plex Resolve] TMDB episode ID=N/A`);
    appLogger.info('plex', `[Plex Resolve] ✅ Résolution épisode réussie : "${parentShowTitle}" S${seasonNum}E${episodeNum}`);
    return tmdbShowData;
  }

  appLogger.warn('plex', `[Plex Resolve] Épisode ignoré pour "${parentShowTitle}" S${seasonNum}E${episodeNum} : série parente non résolue.`);
  return null;
}

export async function resolvePlexItem(item: any, plexToken?: string) {
  if (!item) return null;
  const unwrapped = unwrapPlexMediaItem(item);
  const type = unwrapped.type;
  const pGuidStr = getPlexGuid(unwrapped) || '';

  // 4. Ignorer explicitement les saisons
  if (type === 'season' || pGuidStr.includes('/season/')) {
    appLogger.info(
      'plex',
      `[Plex Resolve] Saison Plex détectée (${unwrapped.title || 'Saison'}) - ignorée pour la synchronisation des contenus vus.`
    );
    return null;
  }

  if (type === 'movie' || (!type && !unwrapped.grandparentTitle && !unwrapped.parentTitle && !pGuidStr.includes('/show/') && !pGuidStr.includes('/episode/'))) {
    return resolveMovieToTmdb(unwrapped, plexToken);
  }

  if (type === 'episode' || unwrapped.grandparentTitle || unwrapped.parentTitle || pGuidStr.includes('/episode/')) {
    return resolveEpisodeShowToTmdb(unwrapped, plexToken);
  }

  if (type === 'show' || pGuidStr.includes('/show/')) {
    return resolveShowToTmdb(unwrapped, plexToken);
  }

  return resolveShowToTmdb(unwrapped, plexToken);
}

// Helper to sanitize show object for Firestore (strip undefined, internal norm fields)
export function cleanShowForFirestore(show: any, userId: string): Record<string, any> {
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(show)) {
    if (v === undefined || k === 'normTitle' || k === 'normOriginalTitle') {
      continue;
    }
    clean[k] = v;
  }
  clean.userId = userId;
  clean.updatedAt = clean.updatedAt || Date.now();
  return clean;
}

export const buildPlexResolutionCacheKey = (
  mediaType: 'tv' | 'movie',
  item: any
): string | null => {
  const sourceIdentity = getStrongPlexSourceIdentity(item);
  return sourceIdentity ? `${mediaType}:${sourceIdentity}` : null;
};

export async function runPlexTasksWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  const results = await Promise.allSettled(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];
      await worker(item);
    }
  }));
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failure) throw failure.reason;
}

export const findShowInLocalLibrary = (
  showsList: Show[],
  tmdbId: number | null,
  mediaType: 'tv' | 'movie'
): Show | undefined => {
  if (!tmdbId) return undefined;

  const isCorrectMediaType = (show: Show): boolean => {
    if (mediaType === 'tv') {
      return show.mediaType === 'tv' || !show.mediaType;
    }
    return show.mediaType === 'movie';
  };

  return showsList.find(
    s => isCorrectMediaType(s) && Number(s.tmdbId) === Number(tmdbId)
  );
};

export function getPlexBackendUrl(pathname: string): string {
  return resolveSeenItApiUrl(pathname);
}

export async function fetchPlexHistoryData(token: string, clientId: string, delta: boolean, since?: number) {
  const isNative = Capacitor.isNativePlatform();
  const urls = resolveSeenItApiCandidates('/api/plex/history', isNative);
  const url = urls[0];
  const timeoutMs = delta ? 45000 : 120000;

  appLogger.info('plex', `Début requête Plex (${isNative ? 'APK Natif' : 'PWA Web'}, Mode: ${delta ? 'Rapide' : 'Complet'})`);

  try {
    appLogger.info('plex', `Interrogation du backend Plex unique : ${url}`);
    let isOk = false;
    let status = 0;
    let data: any = null;

    if (isNative) {
      const payload = { clientId, delta, since };
      const nativeRequest = async (requestUrl: string) => {
        const nativeRes = await CapacitorHttp.post({
          url: requestUrl,
          headers: await getAuthenticatedHeaders({
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Plex-Token': token
          }),
          data: payload,
          connectTimeout: Math.min(timeoutMs, 15000),
          readTimeout: timeoutMs
        });
        return {
          status: nativeRes.status,
          data: typeof nativeRes.data === 'string' ? JSON.parse(nativeRes.data) : nativeRes.data
        };
      };
      const webViewRequest = async (requestUrl: string) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await authenticatedFetch(requestUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'X-Plex-Token': token
            },
            body: JSON.stringify(payload),
            signal: controller.signal
          });
          const contentType = response.headers.get('content-type') || '';
          return {
            status: response.status,
            data: contentType.includes('application/json') ? await response.json() : null
          };
        } finally {
          clearTimeout(timer);
        }
      };

      const nativeResult = await executeBackendAttempts({
        attempts: buildNativeBackendAttempts({ urls, nativeRequest, webViewRequest }),
        delaysMs: [250, 500, 1000],
        onRetry: ({ failedTransport, nextTransport, nextEndpoint, attempt, error }) => {
          const nextOrigin = nextEndpoint ? new URL(nextEndpoint).hostname : 'origine SeenIt suivante';
          appLogger.warn(
            'plex',
            `[Plex Réseau] ${failedTransport} indisponible (${error instanceof Error ? error.message : String(error)}). ` +
            `Nouvelle tentative ${attempt + 1}/${urls.length * 2} via ${nextTransport} (${nextOrigin}).`
          );
        }
      });
      status = nativeResult.status;
      isOk = status >= 200 && status < 300;
      if (isOk) {
        data = nativeResult.data;
      }
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await authenticatedFetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Plex-Token': token
          },
          body: JSON.stringify({ clientId, delta, since }),
          signal: controller.signal
        });
        status = res.status;
        isOk = res.ok;
        const contentType = res.headers.get('content-type') || '';
        if (isOk && contentType.includes('application/json')) {
          data = await res.json();
        }
      } finally {
        clearTimeout(timer);
      }
    }

    if (isOk && data && (Array.isArray(data.history) || Array.isArray(data.watchlist))) {
      const histLen = Array.isArray(data.history) ? data.history.length : 0;
      const watchLen = Array.isArray(data.watchlist) ? data.watchlist.length : 0;
      appLogger.success('plex', `Données Plex reçues : ${histLen} visionnage(s), ${watchLen} watchlist`);
      if (data.stats) {
        appLogger.info('plex',
          `[Plex Sync] Sources : bibliothèque=${data.stats.libraryWatchedItems || 0} vu(s) / ${data.stats.libraryInventoryItems || 0} indexé(s), ` +
          `compte Plex=${data.stats.plexAccountHistoryItems || 0} (retenus=${data.stats.plexAccountHistoryRetained || 0}), ` +
          `historique PMS=${data.stats.pmsHistoryItems || 0}, cloud=${data.stats.cloudItems || 0}.`
        );
      }
      return data;
    }
    throw new Error(`Backend Plex indisponible (HTTP ${status})`);
  } catch (error: any) {
    appLogger.error('plex', `Échec du backend Plex unique : ${error?.message || error}`);
    throw error;
  }
}
