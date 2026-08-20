import { Capacitor } from '@capacitor/core';
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
  'https://ais-pre-mooctibtw2amkshvkzlqij-700628279309.europe-west2.run.app/api/plex/availability',
  'https://ais-dev-mooctibtw2amkshvkzlqij-700628279309.europe-west2.run.app/api/plex/availability',
  '/api/plex/availability'
];

export async function checkPlexAvailability(params: {
  tmdbId?: number | string | null;
  title?: string;
  originalTitle?: string;
  year?: number | string;
  mediaType?: 'movie' | 'tv';
  forceRefresh?: boolean;
}): Promise<PlexMediaInfo> {
  const { tmdbId, title = '', originalTitle, year, mediaType = 'movie', forceRefresh = false } = params;

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

  for (const url of urlsToTry) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: plexToken,
          clientId,
          tmdbId: tmdbId ? Number(tmdbId) : undefined,
          title,
          originalTitle,
          year: year ? Number(year) : undefined,
          mediaType
        }),
        signal: AbortSignal.timeout(8000)
      });

      if (res.ok) {
        const data = await res.json();
        const isAvailable = !!data.available;
        const info: PlexMediaInfo = {
          available: isAvailable,
          serverName: data.serverName,
          serverId: data.serverId,
          plexUrl: data.plexUrl,
          title: data.title,
          year: data.year,
          lastChecked: now
        };

        store.setMediaAvailability(key, info);

        if (isAvailable) {
          appLogger.info('plex', `Média disponible sur Plex : « ${title || data.title} » (${data.serverName || 'Serveur'})`);
        }

        return info;
      }
    } catch (e) {
      // Continue to next endpoint
    }
  }

  // Fallback if network fails
  const fallbackInfo: PlexMediaInfo = { available: false, lastChecked: now };
  return fallbackInfo;
}
