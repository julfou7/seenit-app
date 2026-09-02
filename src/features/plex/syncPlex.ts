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
import { executeBackendAttempts } from '../../lib/nativeBackendRetry';
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
import { mergeAdditivePlexProgress } from './plexAdditiveSync';

export interface PlexSyncResult {
  success: boolean;
  syncedCount: number;
  moviesCount: number;
  episodesCount: number;
  syncedItems: Array<{ title: string; subtitle?: string; isWatchlist?: boolean; posterPath?: string | null; mediaType: 'tv' | 'movie'; show: Show }>;
  error?: string;
}

interface PlexUnresolvedLogItem {
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

const extractTmdbIdFromPlex = (item: any): number | null => {
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
function cleanShowForFirestore(show: any, userId: string): Record<string, any> {
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

const buildPlexResolutionCacheKey = (
  mediaType: 'tv' | 'movie',
  item: any
): string | null => {
  const sourceIdentity = getStrongPlexSourceIdentity(item);
  return sourceIdentity ? `${mediaType}:${sourceIdentity}` : null;
};

async function runPlexTasksWithConcurrency<T>(
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

const findShowInLocalLibrary = (
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

const PLEX_PRODUCTION_ORIGIN = 'https://seenit.ai.studio';

function getPlexBackendUrl(pathname: string): string {
  return Capacitor.isNativePlatform() ? `${PLEX_PRODUCTION_ORIGIN}${pathname}` : pathname;
}

async function fetchPlexHistoryData(token: string, clientId: string, delta: boolean, since?: number) {
  const isNative = Capacitor.isNativePlatform();
  const url = getPlexBackendUrl('/api/plex/history');
  const timeoutMs = delta ? 45000 : 120000;

  appLogger.info('plex', `Début requête Plex (${isNative ? 'APK Natif' : 'PWA Web'}, Mode: ${delta ? 'Rapide' : 'Complet'})`);

  try {
    appLogger.info('plex', `Interrogation du backend Plex unique : ${url}`);
    let isOk = false;
    let status = 0;
    let data: any = null;

    if (isNative) {
      const payload = { clientId, delta, since };
      const nativeRequest = async () => {
        const nativeRes = await CapacitorHttp.post({
          url,
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
      const webViewRequest = async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await authenticatedFetch(url, {
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
        attempts: [
          { transport: 'natif Android', request: nativeRequest },
          { transport: 'WebView', request: webViewRequest },
          { transport: 'natif Android', request: nativeRequest }
        ],
        delaysMs: [400, 1200],
        onRetry: ({ failedTransport, nextTransport, attempt, error }) => {
          appLogger.warn(
            'plex',
            `[Plex Réseau] ${failedTransport} indisponible (${error instanceof Error ? error.message : String(error)}). ` +
            `Nouvelle tentative ${attempt + 1}/3 via ${nextTransport}.`
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
      const { history = [], watchlist = [], libraryAvailability = [], visitedSources = [] } = plexData || {};
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

      if (!hasHistory && !hasWatchlist) {
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

      const totalItemsCount = (history?.length || 0) + (watchlist?.length || 0);
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
      const syncedItems: PlexSyncResult['syncedItems'] = [];
      const unresolvedItems: PlexUnresolvedLogItem[] = [];
      const syncedIdentityKeys = new Set<string>();

      const mutatedShows: Record<string, Show> = {};

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
                ...(episodeRecords[epKey] || {})
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
              episodeRecords: { [epKey]: { watchedAt: viewedTimestamp, episodeTitle: item.title || null } },
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
                ...(episodeRecords['movie'] || {})
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
              episodeRecords: { movie: { watchedAt: viewedTimestamp } },
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

      // Process Plex Watchlist items (auto-import to "À Voir" / "Ma Liste")
      if (hasWatchlist) {
        for (const rawWlItem of watchlist) {
          const wlItem = unwrapPlexMediaItem(rawWlItem);
          const mediaType: 'tv' | 'movie' = wlItem.type === 'show' || wlItem.type === 'series' || wlItem.type === 'tv' ? 'tv' : 'movie';
          const rawTitle = wlItem.title || wlItem.grandparentTitle || 'Média inconnu';

          const cleanTitle = rawTitle.replace(/\(\d{4}\)/g, '').trim();
          const guidTmdbId = extractTmdbIdFromPlex(wlItem);
          const cacheKey = buildPlexResolutionCacheKey(mediaType, wlItem);

          // 1. Check if already in user's local library by TMDB ID
          let matchedShow = findShowInLocalLibrary(showsList, guidTmdbId, mediaType);
          if (matchedShow) {
            continue;
          }

          // 2. Check resolution cache
          let tmdbData: any = null;
          if (cacheKey && resolutionCache[cacheKey]) {
            tmdbData = resolutionCache[cacheKey];
            matchedShow = showsList.find(
              (s) => Number(s.tmdbId) === Number(tmdbData.id) && (s.mediaType === mediaType || (mediaType === 'tv' && !s.mediaType))
            );
            if (matchedShow) continue;
          }

          // 3. Resolve TMDB data for Watchlist item
          if (!tmdbData) {
            tmdbData = await resolveAndCachePlexItem(cacheKey, wlItem);

            if (!tmdbData) {
              unresolvedCount++;
              recordUnresolvedItem(wlItem, 'watchlist');
              appLogger.info('plex', `[Plex Sync] Item Watchlist "${cleanTitle}" ignoré (impossible de résoudre l'ID TMDB).`);
              continue;
            }

            matchedShow = showsList.find(
              (s) => Number(s.tmdbId) === Number(tmdbData.id) && (s.mediaType === mediaType || (mediaType === 'tv' && !s.mediaType))
            );
            if (matchedShow) continue;
          }

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
              isArchived: false
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

      if (cacheModified) {
        setPlexResolutionCache(user.uid, resolutionCache);
        await persistPlexCloudState(user.uid, {
          resolutionCache: compactPlexResolutionCache(resolutionCache)
        });
      }

      if (syncCount > 0 || Object.keys(mutatedShows).length > 0) {
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
              const additiveData = mergeAdditivePlexProgress(currentSeenItState, data);
              const cleanData = cleanShowForFirestore(additiveData, user.uid);
              transaction.set(ref, cleanData, { merge: true });
            }
          });
        }

        // 3. Relire le serveur après les commits : le même UID obtient ainsi le
        // même état final sur PWA et APK, sans fusion locale implicite.
        await useShowsStore.getState().fetchShows();

        // Queue sequential toasts for each synced item (5s each)
        syncedItems.forEach((item) => {
          const actionText = item.isWatchlist
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

        clearPlexSyncStatusDelayed(`Synchro terminée (${syncCount} nouveau(x))`, 3500);
      } else {
        // // appLogger.info('plex', 'Synchronisation terminée : 0 nouveau média (votre bibliothèque est déjà à jour)');
        clearPlexSyncStatusDelayed('Sync Plex terminée (à jour)', 3500);
      }

      appLogger.success(
        'plex',
        `[Plex Sync] Bilan : ${syncCount} nouveau(x), ${alreadyWatchedCount} déjà vu(s) ignoré(s), ${unresolvedCount} non résolu(s), ${repairedCount} index vu(s) réparé(s) sans notification.`
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
      const errorMsg = err?.message || String(err);
      appLogger.error('plex', 'Exception lors de la synchronisation Plex', { error: errorMsg });
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
