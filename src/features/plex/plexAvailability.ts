import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getPlexClientId } from '../../services/plex';

import { appLogger } from '../../store/logStore';
import { authenticatedFetch, getAuthenticatedHeaders } from '../../lib/apiAuth';

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
  getMediaAvailability: (key: string) => PlexMediaInfo | undefined;
  clearCache: () => void;
}

export const usePlexAvailabilityStore = create<PlexAvailabilityState>()(
  persist(
    (set, get) => ({
      cache: {},
      setMediaAvailability: (key, info) =>
        set((state) => ({
          cache: { ...state.cache, [key]: info }
        })),
      getMediaAvailability: (key) => get().cache[key],
      clearCache: () => set({ cache: {} })
    }),
    {
      name: 'seenit_plex_availability_cache'
    }
  )
);

const normalizeTitle = (t?: string) => {
  if (!t) return '';
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export function getPlexMediaKey(tmdbId?: number | string | null, mediaType: 'movie' | 'tv' = 'movie'): string {
  if (tmdbId) return `v2:${mediaType}:${tmdbId}`;
  return `v2:${mediaType}:none`;
}

const PLEX_ENDPOINTS = [
  'https://seenit.ai.studio/api/plex/availability',
  'https://ais-pre-mooctibtw2amkshvkzlqij-700628279309.europe-west2.run.app/api/plex/availability',
  'https://ais-dev-mooctibtw2amkshvkzlqij-700628279309.europe-west2.run.app/api/plex/availability',
  '/api/plex/availability'
];

export async function checkPlexAvailability(params: {
  tmdbId?: number | string | null;
  imdbId?: string | null;
  title?: string;
  originalTitle?: string;
  year?: number | string;
  mediaType?: 'movie' | 'tv';
  forceRefresh?: boolean;
}): Promise<PlexMediaInfo> {
  const { tmdbId, title, originalTitle, mediaType = 'movie', forceRefresh = false } = params;

  if (!tmdbId) {
    return { available: false, lastChecked: Date.now() };
  }

  const key = getPlexMediaKey(tmdbId, mediaType);
  const store = usePlexAvailabilityStore.getState();
  const cached = store.getMediaAvailability(key);
  const now = Date.now();

  // Cache policy: Positive cache = 24h, Negative cache = 30s
  if (!forceRefresh && cached) {
    const isPositiveValid = cached.available && (now - cached.lastChecked < 24 * 60 * 60 * 1000);
    const isNegativeValid = !cached.available && (now - cached.lastChecked < 30 * 1000);
    if (isPositiveValid || isNegativeValid) {
      return cached;
    }
  }

  const plexToken = localStorage.getItem('plex_auth_token') || localStorage.getItem('plex_token');
  if (!plexToken) {
    const notAvailable: PlexMediaInfo = { available: false, lastChecked: now };
    return notAvailable;
  }

  const clientId = getPlexClientId();
  const isNative = Capacitor.isNativePlatform();
  const urlsToTry = isNative 
    ? ['https://ais-dev-mooctibtw2amkshvkzlqij-700628279309.europe-west2.run.app/api/plex/availability'] 
    : ['/api/plex/availability'];

  // 1. Try via Cloud / Express API proxy with fast 2.5s timeout
  for (const url of urlsToTry) {
    try {
      let data: any = null;
      let isOk = false;
      const payload = {
        token: plexToken,
        clientId,
        tmdbId: Number(tmdbId),
        title,
        originalTitle,
        mediaType
      };

      if (isNative) {
        const nativeRes = await CapacitorHttp.post({
          url,
          headers: await getAuthenticatedHeaders({ 'Content-Type': 'application/json', 'Accept': 'application/json' }),
          data: payload,
          connectTimeout: 2500,
          readTimeout: 2500
        });
        isOk = nativeRes.status >= 200 && nativeRes.status < 300;
        if (isOk) {
          data = typeof nativeRes.data === 'string' ? JSON.parse(nativeRes.data) : nativeRes.data;
        }
      } else {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2500);
        const res = await authenticatedFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        clearTimeout(timer);
        isOk = res.ok;
        if (isOk) {
          data = await res.json();
        }
      }

      if (isOk && data) {
        const isAvailable = !!data.available;
        if (isAvailable) {
          const info: PlexMediaInfo = {
            available: true,
            serverName: data.serverName,
            serverId: data.serverId,
            ratingKey: data.ratingKey,
            plexUrl: data.plexUrl,
            watchUrl: data.watchUrl || 'https://watch.plex.tv',
            title: data.title,
            year: data.year,
            lastChecked: now
          };

          store.setMediaAvailability(key, info);
          return info;
        }
      }
    } catch (e) {
      // Continue to next endpoint or direct client fallback
    }
  }

  // 2. Fallback: Direct client search from the user's device (phone or browser)
  try {
    const directResult = await checkPlexDirectFromDevice({
      token: plexToken,
      clientId,
      tmdbId: Number(tmdbId),
      title,
      originalTitle,
      mediaType
    });

    if (directResult && directResult.available) {
      store.setMediaAvailability(key, directResult);
      return directResult;
    }
  } catch (err) {
    // Ignore fallback errors
  }

  // 3. Negative cache
  const fallbackInfo: PlexMediaInfo = { available: false, lastChecked: now };
  store.setMediaAvailability(key, fallbackInfo);
  return fallbackInfo;
}

async function checkPlexDirectFromDevice(params: {
  token: string;
  clientId: string;
  tmdbId: number;
  title?: string;
  originalTitle?: string;
  mediaType?: 'movie' | 'tv';
}): Promise<PlexMediaInfo | null> {
  try {
    const { token, clientId, tmdbId, title, originalTitle, mediaType = 'movie' } = params;
    const resourcesRes = await fetch('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1', {
      headers: {
        'X-Plex-Token': token,
        'Accept': 'application/json',
        'X-Plex-Client-Identifier': clientId
      },
      signal: AbortSignal.timeout(3000)
    });

    if (!resourcesRes.ok) return null;
    const resources = await resourcesRes.json();
    if (!Array.isArray(resources)) return null;

    const servers = resources.filter((r: any) => r.provides && r.provides.includes('server'));
    if (servers.length === 0) return null;

    const extractTmdbId = (item: any): number | null => {
      if (!item) return null;
      if (Array.isArray(item.Guid)) {
        for (const g of item.Guid) {
          if (typeof g?.id === 'string') {
            const match = g.id.match(/^tmdb:\/\/(\d+)/i) || g.id.match(/^themoviedb:\/\/(\d+)/i);
            if (match) return Number(match[1]);
          }
        }
      }
      for (const field of [item.guid, item.grandparentGuid, item.parentGuid]) {
        if (typeof field === 'string') {
          const match = field.match(/themoviedb:\/\/(\d+)|tmdb:\/\/(\d+)|com\.plexapp\.agents\.themoviedb:\/\/(\d+)/i);
          if (match) return Number(match[1] || match[2] || match[3]);
        }
      }
      return null;
    };

    const isMatch = (item: any): boolean => {
      if (!item) return false;

      const itType = (item.type || '').toLowerCase();
      if (mediaType === 'movie') {
        if (itType && itType !== 'movie') return false;
      } else if (mediaType === 'tv') {
        if (itType && itType !== 'show' && itType !== 'series') return false;
      } else {
        if (itType === 'episode' || itType === 'season' || itType === 'track') return false;
      }

      const itTmdbId = extractTmdbId(item);
      return !!(tmdbId && itTmdbId && Number(itTmdbId) === Number(tmdbId));
    };

    const guidEndpoints: ((uri: string) => string)[] = [
      (uri: string) => `${uri}/library/all?guid=${encodeURIComponent(`tmdb://${tmdbId}`)}&includeGuids=1&X-Plex-Token=`,
      (uri: string) => `${uri}/hubs/search?query=${encodeURIComponent(`tmdb://${tmdbId}`)}&limit=5&includeGuids=1&X-Plex-Token=`,
      (uri: string) => `${uri}/library/all?guid=${encodeURIComponent(`com.plexapp.agents.themoviedb://${tmdbId}`)}&includeGuids=1&X-Plex-Token=`
    ];

    const searchPromises = servers.map(async (server: any) => {
      const serverName = server.name || 'Serveur Plex';
      const serverAccessToken = server.accessToken || token;
      const rawConnections = server.connections || [];
      
      const sortedConnections = [...rawConnections].sort((a: any, b: any) => {
        const aIsRemoteHttps = !a.local && (a.uri || '').startsWith('https://');
        const bIsRemoteHttps = !b.local && (b.uri || '').startsWith('https://');
        if (aIsRemoteHttps && !bIsRemoteHttps) return -1;
        if (!aIsRemoteHttps && bIsRemoteHttps) return 1;
        if (a.relay && !b.relay) return -1;
        if (!a.relay && b.relay) return 1;
        return 0;
      });

      for (const conn of sortedConnections) {
        const uri = conn.uri;
        if (!uri) continue;

        for (const getEp of guidEndpoints) {
          const ep = `${getEp(uri)}${serverAccessToken}`;
          try {
            const searchRes = await fetch(ep, {
              headers: { 'Accept': 'application/json', 'X-Plex-Token': serverAccessToken },
              signal: AbortSignal.timeout(1200)
            });
            if (searchRes.ok) {
              const searchData = await searchRes.json();
              let items: any[] = [];
              if (searchData.MediaContainer?.Hub) {
                for (const hub of searchData.MediaContainer.Hub) {
                  if (Array.isArray(hub.Metadata)) items.push(...hub.Metadata);
                }
              } else if (Array.isArray(searchData.MediaContainer?.Metadata)) {
                items = searchData.MediaContainer.Metadata;
              } else if (Array.isArray(searchData.Metadata)) {
                items = searchData.Metadata;
              }

              for (const it of items) {
                if (isMatch(it)) {
                  const directPlexUrl = (server.clientIdentifier && it.ratingKey)
                    ? `https://app.plex.tv/desktop/#!/server/${server.clientIdentifier}/details?key=${encodeURIComponent(`/library/metadata/${it.ratingKey}`)}`
                    : 'https://app.plex.tv/desktop';
                  return {
                    available: true,
                    serverName,
                    serverId: server.clientIdentifier,
                    title: it.title,
                    year: it.year,
                    ratingKey: it.ratingKey,
                    plexUrl: directPlexUrl,
                    lastChecked: Date.now()
                  };
                }
              }
            }
          } catch (e) {
            // try next endpoint
          }
        }
      }
      return null;
    });

    const results = await Promise.all(searchPromises);
    return results.find(r => r && r.available) || null;
  } catch (err) {
    return null;
  }
}
