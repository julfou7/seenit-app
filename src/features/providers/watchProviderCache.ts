export const WATCH_PROVIDER_CACHE_STORAGE_KEY = 'seenit_watch_providers_v1';
export const WATCH_PROVIDER_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const WATCH_PROVIDER_CACHE_STALE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const WATCH_PROVIDER_CACHE_MAX_ENTRIES = 120;

export interface WatchProviderCacheEntry {
  data: any;
  timestamp: number;
  fresh: boolean;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type StoredWatchProviderEntry = {
  data: any;
  timestamp: number;
};

type StoredWatchProviderCache = Record<string, StoredWatchProviderEntry>;

function getDefaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function getWatchProviderCacheKey(id: number, type: 'tv' | 'movie'): string {
  return `${type}:${Number(id)}`;
}

function readStore(storage: StorageLike): StoredWatchProviderCache {
  try {
    const raw = storage.getItem(WATCH_PROVIDER_CACHE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function pruneStore(store: StoredWatchProviderCache, now: number): StoredWatchProviderCache {
  const kept = Object.entries(store)
    .filter(([, entry]) => entry && Number.isFinite(entry.timestamp) && now - entry.timestamp < WATCH_PROVIDER_CACHE_STALE_MAX_AGE_MS)
    .sort(([, left], [, right]) => right.timestamp - left.timestamp)
    .slice(0, WATCH_PROVIDER_CACHE_MAX_ENTRIES);
  return Object.fromEntries(kept);
}

export function readWatchProviderCache(
  id: number,
  type: 'tv' | 'movie',
  options: { now?: number; allowStale?: boolean; storage?: StorageLike | null } = {}
): WatchProviderCacheEntry | null {
  const storage = options.storage === undefined ? getDefaultStorage() : options.storage;
  if (!storage) return null;
  const now = options.now ?? Date.now();
  const store = readStore(storage);
  const entry = store[getWatchProviderCacheKey(id, type)];
  if (!entry || !Number.isFinite(entry.timestamp)) return null;
  const age = now - entry.timestamp;
  if (age >= WATCH_PROVIDER_CACHE_STALE_MAX_AGE_MS) return null;
  const fresh = age < WATCH_PROVIDER_CACHE_TTL_MS;
  if (!fresh && !options.allowStale) return null;
  return { data: entry.data, timestamp: entry.timestamp, fresh };
}

export function writeWatchProviderCache(
  id: number,
  type: 'tv' | 'movie',
  data: any,
  options: { now?: number; storage?: StorageLike | null } = {}
): void {
  const storage = options.storage === undefined ? getDefaultStorage() : options.storage;
  if (!storage) return;
  const now = options.now ?? Date.now();
  const store = readStore(storage);
  store[getWatchProviderCacheKey(id, type)] = { data, timestamp: now };
  try {
    storage.setItem(WATCH_PROVIDER_CACHE_STORAGE_KEY, JSON.stringify(pruneStore(store, now)));
  } catch {
    // Le cache est une optimisation : une WebView sans quota disponible ne doit jamais bloquer la fiche.
  }
}
