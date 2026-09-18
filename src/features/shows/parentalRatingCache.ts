export const PARENTAL_RATING_CACHE_STORAGE_KEY = 'seenit_parental_rating_evidence_v1';
export const PARENTAL_RATING_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PARENTAL_RATING_CACHE_STALE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const PARENTAL_RATING_CACHE_MAX_ENTRIES = 1_500;
const PARENTAL_RATING_CACHE_IDLE_TIMEOUT_MS = 1_000;

type MediaType = 'movie' | 'tv';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type StoredParentalRatingEntry = { data: any; timestamp: number };
type StoredParentalRatingCache = Record<string, StoredParentalRatingEntry>;
type PendingWrite = { cancel: () => void; now: number; store: StoredParentalRatingCache };

export interface ParentalRatingCacheEntry {
  data: any;
  timestamp: number;
  fresh: boolean;
}

const parsedStores = new WeakMap<object, StoredParentalRatingCache>();
const pendingWrites = new Map<StorageLike, PendingWrite>();

function getDefaultStorage(): StorageLike | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; }
  catch { return null; }
}

function keyFor(id: number, type: MediaType): string {
  return `${type}:${Number(id)}`;
}

function compactDetails(id: number, type: MediaType, details: any): any {
  if (type === 'movie') {
    const raw = Array.isArray(details?.release_dates?.results)
      ? details.release_dates.results
      : Array.isArray(details?.results) ? details.results : [];
    const results = raw
      .filter((entry: any) => entry?.iso_3166_1 === 'US')
      .map((entry: any) => ({
        iso_3166_1: 'US',
        release_dates: Array.isArray(entry?.release_dates)
          ? entry.release_dates.map((release: any) => ({
              certification: String(release?.certification ?? '').trim(),
            }))
          : [],
      }));
    return { id: Number(id), media_type: type, release_dates: { results } };
  }

  const raw = Array.isArray(details?.content_ratings?.results)
    ? details.content_ratings.results
    : Array.isArray(details?.results) ? details.results : [];
  const results = raw
    .filter((entry: any) => entry?.iso_3166_1 === 'US')
    .map((entry: any) => ({
      iso_3166_1: 'US',
      rating: String(entry?.rating ?? '').trim(),
    }));
  return { id: Number(id), media_type: type, content_ratings: { results } };
}

function parseStore(storage: StorageLike): StoredParentalRatingCache {
  try {
    const raw = storage.getItem(PARENTAL_RATING_CACHE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function readStore(storage: StorageLike): StoredParentalRatingCache {
  const key = storage as object;
  const cached = parsedStores.get(key);
  if (cached) return cached;
  const store = parseStore(storage);
  parsedStores.set(key, store);
  return store;
}

function persistStore(storage: StorageLike, store: StoredParentalRatingCache, now: number): void {
  const entries = Object.entries(store)
    .filter(([, entry]) => entry && Number.isFinite(entry.timestamp) && now - entry.timestamp < PARENTAL_RATING_CACHE_STALE_MAX_AGE_MS)
    .sort(([, left], [, right]) => right.timestamp - left.timestamp)
    .slice(0, PARENTAL_RATING_CACHE_MAX_ENTRIES);
  const pruned = Object.fromEntries(entries);
  for (const key of Object.keys(store)) if (!(key in pruned)) delete store[key];
  Object.assign(store, pruned);
  try { storage.setItem(PARENTAL_RATING_CACHE_STORAGE_KEY, JSON.stringify(store)); }
  catch { /* Cache d'optimisation : un quota localStorage ne doit jamais bloquer SeenIt. */ }
}

function schedulePersist(storage: StorageLike, store: StoredParentalRatingCache, now: number): void {
  const pending = pendingWrites.get(storage);
  if (pending) { pending.now = Math.max(pending.now, now); return; }

  const flush = () => {
    const current = pendingWrites.get(storage);
    if (!current) return;
    pendingWrites.delete(storage);
    persistStore(storage, current.store, current.now);
  };

  if (typeof window !== 'undefined') {
    const idleWindow = window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (typeof idleWindow.requestIdleCallback === 'function') {
      const handle = idleWindow.requestIdleCallback(flush, { timeout: PARENTAL_RATING_CACHE_IDLE_TIMEOUT_MS });
      pendingWrites.set(storage, { store, now, cancel: () => idleWindow.cancelIdleCallback?.(handle) });
      return;
    }
  }

  const handle = setTimeout(flush, PARENTAL_RATING_CACHE_IDLE_TIMEOUT_MS);
  pendingWrites.set(storage, { store, now, cancel: () => clearTimeout(handle) });
}

export function flushParentalRatingCache(storage: StorageLike | null = getDefaultStorage()): void {
  if (!storage) return;
  const pending = pendingWrites.get(storage);
  if (!pending) return;
  pending.cancel();
  pendingWrites.delete(storage);
  persistStore(storage, pending.store, pending.now);
}

export function readParentalRatingCache(
  id: number,
  type: MediaType,
  options: { now?: number; allowStale?: boolean; storage?: StorageLike | null } = {},
): ParentalRatingCacheEntry | null {
  const storage = options.storage === undefined ? getDefaultStorage() : options.storage;
  if (!storage) return null;
  const now = options.now ?? Date.now();
  const entry = readStore(storage)[keyFor(id, type)];
  if (!entry || !Number.isFinite(entry.timestamp)) return null;
  const age = now - entry.timestamp;
  if (age >= PARENTAL_RATING_CACHE_STALE_MAX_AGE_MS) return null;
  const fresh = age < PARENTAL_RATING_CACHE_TTL_MS;
  if (!fresh && !options.allowStale) return null;
  return { data: entry.data, timestamp: entry.timestamp, fresh };
}

export function writeParentalRatingCache(
  id: number,
  type: MediaType,
  details: any,
  options: { now?: number; storage?: StorageLike | null; defer?: boolean } = {},
): void {
  const normalizedId = Number(id);
  if (!Number.isInteger(normalizedId) || normalizedId <= 0 || !details || typeof details !== 'object') return;
  const storage = options.storage === undefined ? getDefaultStorage() : options.storage;
  if (!storage) return;
  const now = options.now ?? Date.now();
  const store = readStore(storage);
  store[keyFor(normalizedId, type)] = { data: compactDetails(normalizedId, type, details), timestamp: now };
  const defer = options.defer ?? options.storage === undefined;
  if (defer) schedulePersist(storage, store, now);
  else persistStore(storage, store, now);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => flushParentalRatingCache());
  window.addEventListener('storage', event => {
    if (event.key !== PARENTAL_RATING_CACHE_STORAGE_KEY) return;
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
    if (document.visibilityState === 'hidden') flushParentalRatingCache();
  });
}
