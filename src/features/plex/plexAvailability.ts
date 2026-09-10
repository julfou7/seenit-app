import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getPlexClientId } from '../../services/plex';
import { auth } from '../../lib/firebase';

import { appLogger } from '../../store/logStore';
import { authenticatedFetch, getAuthenticatedHeaders } from '../../lib/apiAuth';
import { buildNativeBackendAttempts, executeBackendAttempts } from '../../lib/nativeBackendRetry';
import { resolveSeenItApiCandidates } from '../../lib/seenitApi';
import { getStoredPlexToken } from './plexStorage';
import { replacePlexUserCache } from './plexAvailabilityCache';
import {
  createAsyncRequestLimiter,
  isConfirmedPlexAvailabilityResponse,
  PLEX_AVAILABILITY_MAX_CONCURRENT,
  PLEX_AVAILABILITY_REQUEST_TIMEOUT_MS,
  shouldRunPlexAvailabilityNetwork,
  type PlexAvailabilityNetworkMode,
} from './plexAvailabilityRequestPolicy';

export interface PlexMediaInfo {
  available: boolean;
  serverName?: string;
  serverId?: string;
  ratingKey?: string;
  plexUrl?: string;
  watchUrl?: string;
  title?: string;
  year?: number;
  lastChecked: number;
}

/**
 * La disponibilité PMS et la navigation Plex sont deux contrats distincts.
 * Les locators serverId/ratingKey restent disponibles comme preuve technique,
 * tandis que les URL PMS éventuelles restent internes au cache et ne sont
 * jamais exposées au CTA. L'ouverture publique est résolue séparément par
 * TMDB -> slug Plex Discover dans openPlexWatchUrl().
 */
export function toPlexAvailabilityEvidence(info: PlexMediaInfo): PlexMediaInfo {
  const evidence = { ...info };
  delete evidence.plexUrl;
  delete evidence.watchUrl;
  return evidence;
}

interface PlexAvailabilityState {
  cache: Record<string, PlexMediaInfo>;
  setMediaAvailability: (key: string, info: PlexMediaInfo) => void;
  replaceUserCache: (uid: string, cache: Record<string, PlexMediaInfo>) => void;
  getMediaAvailability: (key: string) => PlexMediaInfo | undefined;
  clearCache: () => void;
  clearUserCache: (uid: string) => void;
}

export const usePlexAvailabilityStore = create<PlexAvailabilityState>()(
  persist(
    (set, get) => ({
      cache: {},
      setMediaAvailability: (key, info) =>
        set((state) => ({
          cache: { ...state.cache, [key]: info }
        })),
      replaceUserCache: (uid, cache) =>
        set((state) => ({
          cache: replacePlexUserCache(state.cache, uid, cache)
        })),
      getMediaAvailability: (key) => {
        const info = get().cache[key];
        return info ? toPlexAvailabilityEvidence(info) : undefined;
      },
      clearCache: () => set({ cache: {} }),
      clearUserCache: (uid) =>
        set((state) => ({
          cache: replacePlexUserCache(state.cache, uid, {})
        }))
    }),
    {
      name: 'seenit_plex_availability_cache'
    }
  )
);

export function getPlexMediaKey(
  tmdbId?: number | string | null,
  mediaType: 'movie' | 'tv' = 'movie',
  uid: string = auth.currentUser?.uid || 'anonymous'
): string {
  if (tmdbId) return `v3:${uid}:${mediaType}:${tmdbId}`;
  return `v3:${uid}:${mediaType}:none`;
}

const activeAvailabilityChecks = new Map<string, Promise<PlexMediaInfo>>();
const availabilityNetworkLimiter = createAsyncRequestLimiter(PLEX_AVAILABILITY_MAX_CONCURRENT);

export async function checkPlexAvailability(params: {
  tmdbId?: number | string | null;
  tvdbId?: number | string | null;
  imdbId?: string | null;
  title?: string;
  originalTitle?: string;
  year?: number | string;
  mediaType?: 'movie' | 'tv';
  forceRefresh?: boolean;
  refreshServers?: boolean;
  networkMode?: PlexAvailabilityNetworkMode;
}): Promise<PlexMediaInfo> {
  const uid = auth.currentUser?.uid;
  if (!uid || !params.tmdbId) {
    return { available: false, lastChecked: Date.now() };
  }

  const requestKey = getPlexMediaKey(params.tmdbId, params.mediaType || 'movie', uid);
  const activeKey = `${requestKey}:${params.forceRefresh ? 'force' : 'cached'}:${params.refreshServers ? 'servers-fresh' : 'servers-cached'}:${params.networkMode || 'cache-only'}`;
  const active = activeAvailabilityChecks.get(activeKey);
  if (active) return active;

  const promise = performPlexAvailabilityCheck(params, uid).finally(() => {
    activeAvailabilityChecks.delete(activeKey);
  });
  activeAvailabilityChecks.set(activeKey, promise);
  return promise;
}

async function performPlexAvailabilityCheck(params: {
  tmdbId?: number | string | null;
  tvdbId?: number | string | null;
  imdbId?: string | null;
  title?: string;
  originalTitle?: string;
  year?: number | string;
  mediaType?: 'movie' | 'tv';
  forceRefresh?: boolean;
  refreshServers?: boolean;
  networkMode?: PlexAvailabilityNetworkMode;
}, uid: string): Promise<PlexMediaInfo> {
  const {
    tmdbId,
    tvdbId,
    imdbId,
    mediaType = 'movie',
    forceRefresh = false,
    refreshServers = false,
    networkMode = 'cache-only'
  } = params;

  if (!tmdbId) {
    return { available: false, lastChecked: Date.now() };
  }

  const key = getPlexMediaKey(tmdbId, mediaType, uid);
  const store = usePlexAvailabilityStore.getState();
  const cached = store.getMediaAvailability(key);
  const now = Date.now();

  // Cache policy: Positive cache = 24h, Negative cache = 30s.
  // Un full scan reconstruit les entrées positives connues, donc une fiche peut
  // généralement répondre ici sans requête réseau supplémentaire.
  if (!forceRefresh && cached) {
    const isPositiveValid = cached.available && (now - cached.lastChecked < 24 * 60 * 60 * 1000);
    const isNegativeValid = !cached.available && (now - cached.lastChecked < 30 * 1000);
    if (isPositiveValid || isNegativeValid) {
      return cached;
    }
  }

  // Les cartes/grilles sont cache-only par défaut. Elles utilisent le cache
  // reconstruit par la synchro Plex et ne déclenchent jamais un scan partagé
  // coûteux simplement parce qu'elles entrent dans le viewport.
  if (!shouldRunPlexAvailabilityNetwork(networkMode)) {
    return cached || { available: false, lastChecked: now };
  }

  const plexToken = getStoredPlexToken(uid);
  if (!plexToken) {
    return cached || { available: false, lastChecked: now };
  }

  return availabilityNetworkLimiter.run(async () => {
    const clientId = getPlexClientId();
    const isNative = Capacitor.isNativePlatform();
    const urls = resolveSeenItApiCandidates('/api/plex/availability', isNative);
    const url = urls[0];

    try {
      let data: any = null;
      let status = 0;
      const normalizedImdbId = typeof imdbId === 'string' && /^tt\d{5,12}$/i.test(imdbId.trim())
        ? imdbId.trim().toLowerCase()
        : undefined;
      const parsedTvdbId = Number(tvdbId);
      const normalizedTvdbId = Number.isInteger(parsedTvdbId) && parsedTvdbId > 0
        ? parsedTvdbId
        : undefined;
      const payload = {
        clientId,
        tmdbId: Number(tmdbId),
        ...(normalizedImdbId ? { imdbId: normalizedImdbId } : {}),
        ...(normalizedTvdbId ? { tvdbId: normalizedTvdbId } : {}),
        mediaType,
        refreshServers
      };

      if (isNative) {
        const nativeRequest = async (requestUrl: string) => {
          const nativeRes = await CapacitorHttp.post({
            url: requestUrl,
            headers: await getAuthenticatedHeaders({
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'X-Plex-Token': plexToken
            }),
            data: payload,
            connectTimeout: PLEX_AVAILABILITY_REQUEST_TIMEOUT_MS,
            readTimeout: PLEX_AVAILABILITY_REQUEST_TIMEOUT_MS
          });
          return {
            status: nativeRes.status,
            data: typeof nativeRes.data === 'string' ? JSON.parse(nativeRes.data) : nativeRes.data
          };
        };
        const webViewRequest = async (requestUrl: string) => {
          const response = await authenticatedFetch(requestUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'X-Plex-Token': plexToken
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(PLEX_AVAILABILITY_REQUEST_TIMEOUT_MS)
          });
          const contentType = response.headers.get('content-type') || '';
          return {
            status: response.status,
            data: contentType.includes('application/json') ? await response.json() : null
          };
        };
        const response = await executeBackendAttempts({
          attempts: buildNativeBackendAttempts({ urls, nativeRequest, webViewRequest }),
          delaysMs: [200, 400, 800],
          onRetry: ({ nextTransport, nextEndpoint }) => {
            const nextOrigin = nextEndpoint ? new URL(nextEndpoint).hostname : 'origine SeenIt suivante';
            appLogger.warn('plex', `[Plex Availability] Réseau indisponible, nouvel essai via ${nextTransport} (${nextOrigin}).`);
          }
        });
        status = response.status;
        data = response.data;
      } else {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), PLEX_AVAILABILITY_REQUEST_TIMEOUT_MS);
        try {
          const res = await authenticatedFetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'X-Plex-Token': plexToken
            },
            body: JSON.stringify(payload),
            signal: controller.signal
          });
          status = res.status;
          const contentType = res.headers.get('content-type') || '';
          data = contentType.includes('application/json') ? await res.json() : null;
        } finally {
          clearTimeout(timer);
        }
      }

      if (isConfirmedPlexAvailabilityResponse(status, data)) {
        if (data.available) {
          const info: PlexMediaInfo = {
            available: true,
            serverName: typeof data.serverName === 'string' ? data.serverName : undefined,
            serverId: typeof data.serverId === 'string' ? data.serverId : undefined,
            ratingKey: typeof data.ratingKey === 'string' ? data.ratingKey : undefined,
            plexUrl: typeof data.plexUrl === 'string' ? data.plexUrl : undefined,
            watchUrl: typeof data.watchUrl === 'string'
              ? data.watchUrl
              : (typeof data.plexUrl === 'string' ? data.plexUrl : undefined),
            title: typeof data.title === 'string' ? data.title : undefined,
            year: typeof data.year === 'number' ? data.year : undefined,
            lastChecked: Date.now()
          };
          store.setMediaAvailability(key, info);
          return toPlexAvailabilityEvidence(info);
        }

        const confirmedUnavailable: PlexMediaInfo = {
          available: false,
          lastChecked: Date.now()
        };
        store.setMediaAvailability(key, confirmedUnavailable);
        return confirmedUnavailable;
      }

      if (status > 0) {
        appLogger.warn('plex', `[Plex Availability] Backend a répondu HTTP ${status}; le cache Plex n'est pas modifié.`);
      }
    } catch (error: any) {
      appLogger.warn('plex', `[Plex Availability] Backend unique indisponible : ${error?.message || error}`);
    }

    const newerCached = usePlexAvailabilityStore.getState().getMediaAvailability(key);
    if (newerCached) return newerCached;

    // Un timeout, une panne réseau ou une réponse HTTP fonctionnelle en erreur
    // ne prouve pas l'absence du média : ne jamais empoisonner le cache négatif.
    return { available: false, lastChecked: Date.now() };
  });
}
