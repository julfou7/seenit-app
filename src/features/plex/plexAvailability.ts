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
import { buildPlexMediaUrl, replacePlexUserCache } from './plexAvailabilityCache';

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
        if (!info || info.plexUrl || !info.serverId || !info.ratingKey) return info;
        const plexUrl = buildPlexMediaUrl(info.serverId, info.ratingKey);
        return { ...info, plexUrl, watchUrl: info.watchUrl || plexUrl };
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

export async function checkPlexAvailability(params: {
  tmdbId?: number | string | null;
  imdbId?: string | null;
  title?: string;
  originalTitle?: string;
  year?: number | string;
  mediaType?: 'movie' | 'tv';
  forceRefresh?: boolean;
}): Promise<PlexMediaInfo> {
  const uid = auth.currentUser?.uid;
  if (!uid || !params.tmdbId) {
    return { available: false, lastChecked: Date.now() };
  }

  const requestKey = getPlexMediaKey(params.tmdbId, params.mediaType || 'movie', uid);
  const activeKey = `${requestKey}:${params.forceRefresh ? 'force' : 'cached'}`;
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
  imdbId?: string | null;
  title?: string;
  originalTitle?: string;
  year?: number | string;
  mediaType?: 'movie' | 'tv';
  forceRefresh?: boolean;
}, uid: string): Promise<PlexMediaInfo> {
  const { tmdbId, mediaType = 'movie', forceRefresh = false } = params;

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

  const plexToken = getStoredPlexToken(uid);
  if (!plexToken) {
    const notAvailable: PlexMediaInfo = { available: false, lastChecked: now };
    return notAvailable;
  }

  const clientId = getPlexClientId();
  const isNative = Capacitor.isNativePlatform();
  const urls = resolveSeenItApiCandidates('/api/plex/availability', isNative);
  const url = urls[0];

  try {
    let data: any = null;
    let isOk = false;
    const payload = {
      clientId,
      tmdbId: Number(tmdbId),
      mediaType
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
          connectTimeout: 5000,
          readTimeout: 5000
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
          signal: AbortSignal.timeout(5000)
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
      isOk = response.status >= 200 && response.status < 300;
      if (isOk) {
        data = response.data;
      }
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
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
        isOk = res.ok;
        if (isOk) {
          data = await res.json();
        }
      } finally {
        clearTimeout(timer);
      }
    }

    if (isOk && data?.available) {
      const info: PlexMediaInfo = {
        available: true,
        serverName: data.serverName,
        serverId: data.serverId,
        ratingKey: data.ratingKey,
        plexUrl: data.plexUrl,
        watchUrl: data.watchUrl || data.plexUrl,
        title: data.title,
        year: data.year,
        lastChecked: now
      };
      store.setMediaAvailability(key, info);
      return info;
    }
  } catch (error: any) {
    appLogger.warn('plex', `[Plex Availability] Backend unique indisponible : ${error?.message || error}`);
  }

  const newerCached = store.getMediaAvailability(key);
  if (newerCached?.available && newerCached.lastChecked > now) return newerCached;

  const fallbackInfo: PlexMediaInfo = { available: false, lastChecked: now };
  store.setMediaAvailability(key, fallbackInfo);
  return fallbackInfo;
}
