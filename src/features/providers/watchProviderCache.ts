export const WATCH_PROVIDER_CACHE_STORAGE_KEY = 'seenit_watch_providers_v1';
export const WATCH_PROVIDER_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const WATCH_PROVIDER_CACHE_STALE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const WATCH_PROVIDER_CACHE_MAX_ENTRIES = 120;
export const WATCH_PROVIDER_CACHE_IDLE_TIMEOUT_MS = 2_000;

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

type PendingWrite = {
  cancel: () => void;
  now: number;
  store: StoredWatchProviderCache;
};

const parsedStores = new WeakMap<object, StoredWatchProviderCache>();
const pendingWrites = new Map<StorageLike, PendingWrite>();

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

function parseStore(storage: StorageLike): StoredWatchProviderCache {
  try {
    const raw = storage.getItem(WATCH_PROVIDER_CACHE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readStore(storage: StorageLike): StoredWatchProviderCache {
  const storageKey = storage as object;
  const parsed = parsedStores.get(storageKey);
  if (parsed) return parsed;

  const store = parseStore(storage);
  parsedStores.set(storageKey, store);
  return store;
}

function pruneStore(store: StoredWatchProviderCache, now: number): StoredWatchProviderCache {
  const kept = Object.entries(store)
    .filter(([, entry]) => entry && Number.isFinite(entry.timestamp) && now - entry.timestamp < WATCH_PROVIDER_CACHE_STALE_MAX_AGE_MS)
    .sort(([, left], [, right]) => right.timestamp - left.timestamp)
    .slice(0, WATCH_PROVIDER_CACHE_MAX_ENTRIES);
  return Object.fromEntries(kept);
}

function persistStore(storage: StorageLike, store: StoredWatchProviderCache, now: number): void {
  const pruned = pruneStore(store, now);

  for (const key of Object.keys(store)) {
    if (!(key in pruned)) delete store[key];
  }
  Object.assign(store, pruned);

  try {
    storage.setItem(WATCH_PROVIDER_CACHE_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Le cache est une optimisation : une WebView sans quota disponible ne doit jamais bloquer la fiche.
  }
}

function schedulePersist(storage: StorageLike, store: StoredWatchProviderCache, now: number): void {
  const existing = pendingWrites.get(storage);
  if (existing) {
    existing.now = Math.max(existing.now, now);
    return;
  }

  const flush = () => {
    const pending = pendingWrites.get(storage);
    if (!pending) return;
    pendingWrites.delete(storage);
    persistStore(storage, pending.store, pending.now);
  };

  if (typeof window !== 'undefined') {
    const idleWindow = window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (typeof idleWindow.requestIdleCallback === 'function') {
      const handle = idleWindow.requestIdleCallback(flush, { timeout: WATCH_PROVIDER_CACHE_IDLE_TIMEOUT_MS });
      pendingWrites.set(storage, {
        store,
        now,
        cancel: () => idleWindow.cancelIdleCallback?.(handle),
      });
      return;
    }
  }

  const handle = setTimeout(flush, WATCH_PROVIDER_CACHE_IDLE_TIMEOUT_MS);
  pendingWrites.set(storage, {
    store,
    now,
    cancel: () => clearTimeout(handle),
  });
}

export function flushWatchProviderCache(storage: StorageLike | null = getDefaultStorage()): void {
  if (!storage) return;
  const pending = pendingWrites.get(storage);
  if (!pending) return;
  pending.cancel();
  pendingWrites.delete(storage);
  persistStore(storage, pending.store, pending.now);
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
  options: { now?: number; storage?: StorageLike | null; defer?: boolean } = {}
): void {
  const storage = options.storage === undefined ? getDefaultStorage() : options.storage;
  if (!storage) return;
  const now = options.now ?? Date.now();
  const store = readStore(storage);
  store[getWatchProviderCacheKey(id, type)] = { data, timestamp: now };

  const defer = options.defer ?? options.storage === undefined;
  if (defer) schedulePersist(storage, store, now);
  else persistStore(storage, store, now);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => flushWatchProviderCache());
  window.addEventListener('storage', event => {
    if (event.key !== WATCH_PROVIDER_CACHE_STORAGE_KEY) return;
    const storage = getDefaultStorage();
    if (!storage) return;
    const pending = pendingWrites.get(storage);
    pending?.cancel();
    pendingWrites.delete(storage);
    parsedStores.delete(storage as object);
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushWatchProviderCache();
  });
}
