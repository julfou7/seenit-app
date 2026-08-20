import { Capacitor } from '@capacitor/core';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getPlexClientId } from '../../services/plex';

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
}): Promise<PlexMediaInfo> {
  const { tmdbId, title = '', originalTitle, year, mediaType = 'movie' } = params;
  const key = getPlexMediaKey(tmdbId, title, mediaType);
  const store = usePlexAvailabilityStore.getState();

  // Check store cache (valid for 6 hours)
  const cached = store.getMediaAvailability(key);
  const now = Date.now();
  if (cached && (now - cached.lastChecked < 6 * 60 * 60 * 1000)) {
    return cached;
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
        signal: AbortSignal.timeout(6000)
      });

      if (res.ok) {
        const data = await res.json();
        const info: PlexMediaInfo = {
          available: !!data.available,
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
    } catch (e) {
      // Continue to next endpoint
    }
  }

  // Fallback if network fails: retain previous cached or default to false
  const fallbackInfo: PlexMediaInfo = cached || { available: false, lastChecked: now };
  return fallbackInfo;
}
