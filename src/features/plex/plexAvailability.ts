import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getPlexClientId } from '../../services/plex';

import { appLogger } from '../../store/logStore';

export interface PlexMediaInfo {
  available: boolean;
  serverName?: string;
  serverId?: string;
  plexUrl?: string;
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

export function getPlexMediaKey(tmdbId?: number | string | null, title?: string, mediaType: 'movie' | 'tv' = 'movie'): string {
  if (tmdbId) return `${mediaType}:${tmdbId}`;
  return `${mediaType}:${normalizeTitle(title)}`;
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
  const { tmdbId, imdbId, title = '', originalTitle, year, mediaType = 'movie', forceRefresh = false } = params;

  // Don't query or cache empty placeholders
  if (!tmdbId && (!title || title.trim() === '' || title === 'Chargement...')) {
    return { available: false, lastChecked: Date.now() };
  }

  const key = getPlexMediaKey(tmdbId, title, mediaType);
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
    ? [...PLEX_ENDPOINTS] 
    : ['/api/plex/availability', ...PLEX_ENDPOINTS];

  // 1. Try via Cloud / Express API proxy
  for (const url of urlsToTry) {
    if (isNative && url === '/api/plex/availability') continue;
    try {
      let data: any = null;
      let isOk = false;
      const payload = {
        token: plexToken,
        clientId,
        tmdbId: tmdbId ? Number(tmdbId) : undefined,
        imdbId,
        title,
        originalTitle,
        year: year ? Number(year) : undefined,
        mediaType
      };

      if (isNative) {
        const nativeRes = await CapacitorHttp.post({
          url,
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          data: payload,
          connectTimeout: 8000,
          readTimeout: 8000
        });
        isOk = nativeRes.status >= 200 && nativeRes.status < 300;
        if (isOk) {
          data = typeof nativeRes.data === 'string' ? JSON.parse(nativeRes.data) : nativeRes.data;
        }
      } else {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(url, {
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
            plexUrl: data.plexUrl,
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
      tmdbId,
      imdbId,
      title,
      originalTitle,
      year,
      mediaType
    });

    if (directResult && directResult.available) {
      store.setMediaAvailability(key, directResult);
      // appLogger.info('plex', `Média trouvé via connexion directe Plex : « ${title || directResult.title} » (${directResult.serverName || 'Serveur'})`);
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
  tmdbId?: number | string | null;
  imdbId?: string | null;
  title?: string;
  originalTitle?: string;
  year?: number | string;
  mediaType?: 'movie' | 'tv';
}): Promise<PlexMediaInfo | null> {
  try {
    const { token, clientId, tmdbId, imdbId, title = '', originalTitle, year } = params;
    const resourcesRes = await fetch('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1', {
      headers: {
        'X-Plex-Token': token,
        'Accept': 'application/json',
        'X-Plex-Client-Identifier': clientId
      },
      signal: AbortSignal.timeout(5000)
    });

    if (!resourcesRes.ok) return null;
    const resources = await resourcesRes.json();
    if (!Array.isArray(resources)) return null;

    const servers = resources.filter((r: any) => r.provides && r.provides.includes('server'));
    if (servers.length === 0) return null;

    const normalizeStr = (s?: string) => 
      (s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const STOP_WORDS = new Set(['de', 'des', 'du', 'la', 'le', 'les', 'un', 'une', 'et', 'en', 'a', 'au', 'aux', 'the', 'of', 'in', 'and', 'for', 'to', 'a', 'an']);
    const getSignificantWords = (s?: string) => normalizeStr(s).split(' ').filter(w => w.length >= 3 && !STOP_WORDS.has(w));

    const normTitle = normalizeStr(title);
    const normOriginal = originalTitle ? normalizeStr(originalTitle) : '';
    const targetWords = Array.from(new Set([...getSignificantWords(title), ...getSignificantWords(originalTitle)]));

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

    const extractImdbId = (item: any): string | null => {
      if (!item) return null;
      if (Array.isArray(item.Guid)) {
        for (const g of item.Guid) {
          if (typeof g?.id === 'string') {
            const match = g.id.match(/^imdb:\/\/(tt\d+)/i);
            if (match) return match[1].toLowerCase();
          }
        }
      }
      for (const field of [item.guid, item.grandparentGuid, item.parentGuid]) {
        if (typeof field === 'string') {
          const match = field.match(/imdb:\/\/(tt\d+)|com\.plexapp\.agents\.imdb:\/\/(tt\d+)/i);
          if (match) return (match[1] || match[2]).toLowerCase();
        }
      }
      return null;
    };

    const isMatch = (item: any): boolean => {
      if (!item) return false;

      // 0. Vérification stricte du type de média (Film vs Série)
      const itType = (item.type || '').toLowerCase();
      if (params.mediaType === 'movie') {
        // Pour un film, ignorer absolument les épisodes, séries, saisons
        if (itType && itType !== 'movie') return false;
      } else if (params.mediaType === 'tv') {
        // Pour une série, accepter uniquement 'show' ou 'series'
        if (itType && itType !== 'show' && itType !== 'series') return false;
      } else {
        // Si mediaType non spécifié, ignorer au moins les épisodes et saisons
        if (itType === 'episode' || itType === 'season' || itType === 'track') return false;
      }

      // 1. Match direct par TMDB ID
      const itTmdbId = extractTmdbId(item);
      if (tmdbId && itTmdbId && Number(itTmdbId) === Number(tmdbId)) return true;

      // 2. Match direct par IMDB ID
      const itImdbId = extractImdbId(item);
      if (imdbId && itImdbId && itImdbId === String(imdbId).toLowerCase()) return true;

      // Helper pour vérifier la concordance de l'année
      const isYearCompatible = (): boolean => {
        if (!year || !item.year) return true;
        return Math.abs(Number(year) - Number(item.year)) <= 1;
      };

      // 3. Match de titre (Uniquement le titre du média, pas grandparentTitle)
      const itTitle = normalizeStr(item.title);
      const itOriginal = normalizeStr(item.originalTitle);

      // Titre exact ou titre original exact
      if (normTitle && (itTitle === normTitle || itOriginal === normTitle)) {
        if (!isYearCompatible()) return false;
        return true;
      }
      if (normOriginal && (itTitle === normOriginal || itOriginal === normOriginal)) {
        if (!isYearCompatible()) return false;
        return true;
      }

      // Sous-chaîne pour titres plus longs (minimum 4 caractères)
      if (normTitle.length >= 4 && (itTitle === normTitle || itOriginal === normTitle || itTitle.includes(normTitle) || normTitle.includes(itTitle))) {
        if (!isYearCompatible()) return false;
        return true;
      }

      // 4. Overlap des mots significatifs
      if (targetWords.length > 0) {
        const itemWords = new Set([...itTitle.split(' '), ...itOriginal.split(' ')]);
        const allFound = targetWords.every(tw => itemWords.has(tw) || Array.from(itemWords).some(iw => iw.includes(tw) || tw.includes(iw)));
        if (allFound) {
          if (!isYearCompatible()) return false;
          return true;
        }
      }

      return false;
    };

    const searchQueries = new Set<string>();
    if (title && title.trim()) searchQueries.add(title.trim());
    if (originalTitle && originalTitle.trim() && originalTitle !== title) searchQueries.add(originalTitle.trim());
    if (normTitle && normTitle.length >= 3 && normTitle !== title) searchQueries.add(normTitle);
    if (targetWords.length > 0 && targetWords[0].length >= 4) searchQueries.add(targetWords[0]);
    const queriesArray = Array.from(searchQueries);

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

        const searchTasks = queriesArray.map(async (q) => {
          const ep = `${uri}/hubs/search?query=${encodeURIComponent(q)}&limit=20&X-Plex-Token=${serverAccessToken}`;
          try {
            const searchRes = await fetch(ep, {
              headers: { 'Accept': 'application/json', 'X-Plex-Token': serverAccessToken },
              signal: AbortSignal.timeout(2500)
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
            // try next
          }
          return null;
        });

        const queryResults = await Promise.all(searchTasks);
        const match = queryResults.find(r => r && r.available);
        if (match) return match;
      }
      return null;
    });

    const results = await Promise.all(searchPromises);
    return results.find(r => r && r.available) || null;
  } catch (err) {
    return null;
  }
}
