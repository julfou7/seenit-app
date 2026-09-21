export type PublicMetadataFamily = 'detail_render' | 'details' | 'discover' | 'search' | 'season';

export interface PublicMetadataPolicy {
  freshMs: number;
  staleMs: number;
  memoryMaxEntries: number;
  persist: boolean;
}

import { recordClientOperationalSignal } from '../logging/clientOperationalDiagnostics.ts';

export const PUBLIC_METADATA_CACHE_SCHEMA_VERSION = 1;
export const PUBLIC_METADATA_CACHE_DB_NAME = 'seenit-public-metadata-v1';
export const PUBLIC_METADATA_CACHE_STORE_NAME = 'entries';
export const PUBLIC_METADATA_CACHE_PERSISTENT_MAX_ENTRIES = 320;
export const PUBLIC_METADATA_CACHE_PERSISTENT_MAX_BYTES = 32 * 1024 * 1024;
export const PUBLIC_METADATA_CACHE_MAX_ENTRY_BYTES = 1024 * 1024;

export const PUBLIC_METADATA_CACHE_POLICIES: Record<PublicMetadataFamily, PublicMetadataPolicy> = {
  detail_render: {
    freshMs: 24 * 60 * 60 * 1000,
    staleMs: 30 * 24 * 60 * 60 * 1000,
    memoryMaxEntries: 80,
    persist: true,
  },
  details: {
    freshMs: 24 * 60 * 60 * 1000,
    staleMs: 30 * 24 * 60 * 60 * 1000,
    memoryMaxEntries: 120,
    persist: true,
  },
  discover: {
    freshMs: 2 * 60 * 1000,
    staleMs: 30 * 60 * 1000,
    memoryMaxEntries: 96,
    persist: true,
  },
  search: {
    freshMs: 5 * 60 * 1000,
    staleMs: 30 * 60 * 1000,
    memoryMaxEntries: 80,
    // Une recherche contient du texte saisi par l'utilisateur : on mutualise
    // en mémoire mais on ne la persiste pas dans le cache public.
    persist: false,
  },
  season: {
    // Les épisodes d'une saison en cours peuvent encore évoluer : TTL plus court
    // que la fiche principale, mais assez long pour supprimer les réouvertures
    // répétées observées dans #410.
    freshMs: 2 * 60 * 60 * 1000,
    staleMs: 24 * 60 * 60 * 1000,
    memoryMaxEntries: 80,
    persist: true,
  },
};

export interface PublicMetadataCacheEntry<T> {
  data: T;
  storedAt: number;
  fresh: boolean;
  source: 'memory' | 'indexeddb';
}

interface StoredPublicMetadataEntry {
  key: string;
  family: PublicMetadataFamily;
  storedAt: number;
  schemaVersion: number;
  data: unknown;
  bytes: number;
}

interface PublicMetadataFamilyStats {
  memoryHits: number;
  persistentHits: number;
  staleHits: number;
  misses: number;
  writes: number;
  networkLoads: number;
  singleFlightHits: number;
  readErrors: number;
  writeErrors: number;
  oversizedSkips: number;
}

export interface PublicMetadataCacheStatsSnapshot {
  schemaVersion: number;
  inFlight: number;
  memoryEntries: Record<PublicMetadataFamily, number>;
  families: Record<PublicMetadataFamily, PublicMetadataFamilyStats>;
}

const createStats = (): Record<PublicMetadataFamily, PublicMetadataFamilyStats> => ({
  detail_render: { memoryHits: 0, persistentHits: 0, staleHits: 0, misses: 0, writes: 0, networkLoads: 0, singleFlightHits: 0, readErrors: 0, writeErrors: 0, oversizedSkips: 0 },
  details: { memoryHits: 0, persistentHits: 0, staleHits: 0, misses: 0, writes: 0, networkLoads: 0, singleFlightHits: 0, readErrors: 0, writeErrors: 0, oversizedSkips: 0 },
  discover: { memoryHits: 0, persistentHits: 0, staleHits: 0, misses: 0, writes: 0, networkLoads: 0, singleFlightHits: 0, readErrors: 0, writeErrors: 0, oversizedSkips: 0 },
  search: { memoryHits: 0, persistentHits: 0, staleHits: 0, misses: 0, writes: 0, networkLoads: 0, singleFlightHits: 0, readErrors: 0, writeErrors: 0, oversizedSkips: 0 },
  season: { memoryHits: 0, persistentHits: 0, staleHits: 0, misses: 0, writes: 0, networkLoads: 0, singleFlightHits: 0, readErrors: 0, writeErrors: 0, oversizedSkips: 0 },
});

let stats = createStats();
const memoryCaches: Record<PublicMetadataFamily, Map<string, StoredPublicMetadataEntry>> = {
  detail_render: new Map(),
  details: new Map(),
  discover: new Map(),
  search: new Map(),
  season: new Map(),
};
const inFlight = new Map<string, Promise<unknown>>();
let databasePromise: Promise<IDBDatabase | null> | null = null;
let persistentWritesSincePrune = 0;

function cloneJson<T>(value: T): T {
  if (typeof globalThis.structuredClone === 'function') {
    try { return globalThis.structuredClone(value); } catch { /* JSON fallback below. */ }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function compositeKey(family: PublicMetadataFamily, key: string): string {
  return `${family}:${key}`;
}

function jsonByteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return PUBLIC_METADATA_CACHE_MAX_ENTRY_BYTES + 1;
  }
}

function touchMemory(family: PublicMetadataFamily, key: string, entry: StoredPublicMetadataEntry): void {
  const cache = memoryCaches[family];
  cache.delete(key);
  cache.set(key, entry);
  const maximum = PUBLIC_METADATA_CACHE_POLICIES[family].memoryMaxEntries;
  while (cache.size > maximum) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('INDEXEDDB_REQUEST_FAILED'));
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('INDEXEDDB_TRANSACTION_ABORTED'));
    transaction.onerror = () => reject(transaction.error || new Error('INDEXEDDB_TRANSACTION_FAILED'));
  });
}

function openPublicMetadataDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (databasePromise) return databasePromise;

  databasePromise = new Promise<IDBDatabase | null>(resolve => {
    try {
      const request = indexedDB.open(PUBLIC_METADATA_CACHE_DB_NAME, PUBLIC_METADATA_CACHE_SCHEMA_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(PUBLIC_METADATA_CACHE_STORE_NAME)) {
          const store = database.createObjectStore(PUBLIC_METADATA_CACHE_STORE_NAME, { keyPath: 'key' });
          store.createIndex('storedAt', 'storedAt');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return databasePromise;
}

async function readPersistedEntry(key: string): Promise<StoredPublicMetadataEntry | null> {
  const database = await openPublicMetadataDatabase();
  if (!database) return null;
  try {
    const transaction = database.transaction(PUBLIC_METADATA_CACHE_STORE_NAME, 'readonly');
    const result = await requestToPromise(
      transaction.objectStore(PUBLIC_METADATA_CACHE_STORE_NAME).get(key) as IDBRequest<StoredPublicMetadataEntry | undefined>,
    );
    return result && result.schemaVersion === PUBLIC_METADATA_CACHE_SCHEMA_VERSION ? result : null;
  } catch {
    return null;
  }
}

async function deletePersistedEntry(key: string): Promise<void> {
  const database = await openPublicMetadataDatabase();
  if (!database) return;
  try {
    const transaction = database.transaction(PUBLIC_METADATA_CACHE_STORE_NAME, 'readwrite');
    const completion = transactionToPromise(transaction);
    transaction.objectStore(PUBLIC_METADATA_CACHE_STORE_NAME).delete(key);
    await completion;
  } catch {
    // Cache d'optimisation : une suppression ratée ne doit jamais bloquer SeenIt.
  }
}

async function prunePersistentCache(database: IDBDatabase): Promise<void> {
  const transaction = database.transaction(PUBLIC_METADATA_CACHE_STORE_NAME, 'readwrite');
  const completion = transactionToPromise(transaction);
  const store = transaction.objectStore(PUBLIC_METADATA_CACHE_STORE_NAME);
  const cursorRequest = store.index('storedAt').openCursor();

  await new Promise<void>((resolve, reject) => {
    const entries: Array<{ key: IDBValidKey; bytes: number }> = [];
    cursorRequest.onerror = () => reject(cursorRequest.error || new Error('INDEXEDDB_CURSOR_FAILED'));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor) {
        const value = cursor.value as StoredPublicMetadataEntry;
        entries.push({
          key: cursor.primaryKey,
          bytes: Number.isFinite(value?.bytes) ? Math.max(0, Number(value.bytes)) : jsonByteLength(value?.data),
        });
        cursor.continue();
        return;
      }

      let remainingEntries = entries.length;
      let remainingBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
      for (const entry of entries) {
        if (
          remainingEntries <= PUBLIC_METADATA_CACHE_PERSISTENT_MAX_ENTRIES
          && remainingBytes <= PUBLIC_METADATA_CACHE_PERSISTENT_MAX_BYTES
        ) break;
        store.delete(entry.key);
        remainingEntries -= 1;
        remainingBytes = Math.max(0, remainingBytes - entry.bytes);
      }
      resolve();
    };
  });
  await completion;
}

async function persistEntry(entry: StoredPublicMetadataEntry): Promise<void> {
  const policy = PUBLIC_METADATA_CACHE_POLICIES[entry.family];
  if (!policy.persist) return;
  if (entry.bytes > PUBLIC_METADATA_CACHE_MAX_ENTRY_BYTES) {
    stats[entry.family].oversizedSkips += 1;
    return;
  }
  const database = await openPublicMetadataDatabase();
  if (!database) return;
  try {
    const transaction = database.transaction(PUBLIC_METADATA_CACHE_STORE_NAME, 'readwrite');
    const completion = transactionToPromise(transaction);
    transaction.objectStore(PUBLIC_METADATA_CACHE_STORE_NAME).put(cloneJson(entry));
    await completion;
    persistentWritesSincePrune += 1;
    if (persistentWritesSincePrune >= 40) {
      persistentWritesSincePrune = 0;
      await prunePersistentCache(database);
    }
  } catch {
    stats[entry.family].writeErrors += 1;
    recordClientOperationalSignal('CACHE_CLIENT_STORAGE_FAILED');
  }
}

export function isPublicMetadataFallbackStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function normalizePublicMetadataRequestKey(input: string | URL): string {
  const raw = input instanceof URL ? input.toString() : input;
  const url = new URL(raw, 'https://seenit.local');
  url.searchParams.sort();
  const query = url.searchParams.toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
}

export async function readPublicMetadataCache<T>(
  family: PublicMetadataFamily,
  key: string,
  options: { now?: number; allowStale?: boolean } = {},
): Promise<PublicMetadataCacheEntry<T> | null> {
  const policy = PUBLIC_METADATA_CACHE_POLICIES[family];
  const now = options.now ?? Date.now();
  const allowStale = options.allowStale ?? false;
  const memory = memoryCaches[family].get(key);

  const evaluate = (entry: StoredPublicMetadataEntry, source: 'memory' | 'indexeddb'): PublicMetadataCacheEntry<T> | null => {
    const age = Math.max(0, now - entry.storedAt);
    if (age >= policy.staleMs) {
      memoryCaches[family].delete(key);
      if (source === 'indexeddb') void deletePersistedEntry(entry.key);
      return null;
    }
    const fresh = age < policy.freshMs;
    if (!fresh && !allowStale) return null;
    if (source === 'memory') stats[family].memoryHits += 1;
    else stats[family].persistentHits += 1;
    if (!fresh) stats[family].staleHits += 1;
    touchMemory(family, key, entry);
    return { data: cloneJson(entry.data as T), storedAt: entry.storedAt, fresh, source };
  };

  if (memory) {
    const result = evaluate(memory, 'memory');
    if (result) return result;
  }

  if (policy.persist) {
    try {
      const persisted = await readPersistedEntry(compositeKey(family, key));
      if (persisted) {
        const result = evaluate(persisted, 'indexeddb');
        if (result) return result;
      }
    } catch {
      stats[family].readErrors += 1;
      recordClientOperationalSignal('CACHE_CLIENT_STORAGE_FAILED');
    }
  }

  stats[family].misses += 1;
  return null;
}

export function writePublicMetadataCache<T>(
  family: PublicMetadataFamily,
  key: string,
  data: T,
  options: { now?: number } = {},
): void {
  if (data === undefined) return;
  const storedAt = options.now ?? Date.now();
  const clonedData = cloneJson(data);
  const entry: StoredPublicMetadataEntry = {
    key: compositeKey(family, key),
    family,
    storedAt,
    schemaVersion: PUBLIC_METADATA_CACHE_SCHEMA_VERSION,
    data: clonedData,
    bytes: jsonByteLength(clonedData),
  };
  touchMemory(family, key, entry);
  stats[family].writes += 1;
  void persistEntry(entry);
}

export function runPublicMetadataSingleFlight<T>(
  family: PublicMetadataFamily,
  key: string,
  loader: () => Promise<T>,
): Promise<T> {
  const keyWithFamily = compositeKey(family, key);
  const existing = inFlight.get(keyWithFamily) as Promise<T> | undefined;
  if (existing) {
    stats[family].singleFlightHits += 1;
    return existing;
  }

  stats[family].networkLoads += 1;
  const request = Promise.resolve().then(loader);
  inFlight.set(keyWithFamily, request);
  void request.finally(() => {
    if (inFlight.get(keyWithFamily) === request) inFlight.delete(keyWithFamily);
  }).catch(() => undefined);
  return request;
}

export function getPublicMetadataCacheStats(): PublicMetadataCacheStatsSnapshot {
  return {
    schemaVersion: PUBLIC_METADATA_CACHE_SCHEMA_VERSION,
    inFlight: inFlight.size,
    memoryEntries: {
      detail_render: memoryCaches.detail_render.size,
      details: memoryCaches.details.size,
      discover: memoryCaches.discover.size,
      search: memoryCaches.search.size,
      season: memoryCaches.season.size,
    },
    families: cloneJson(stats),
  };
}

export function clearPublicMetadataMemoryCacheForTests(): void {
  memoryCaches.detail_render.clear();
  memoryCaches.details.clear();
  memoryCaches.discover.clear();
  memoryCaches.search.clear();
  memoryCaches.season.clear();
  inFlight.clear();
  stats = createStats();
}

declare global {
  interface Window {
    __SEENIT_TMDB_CACHE_STATS__?: () => PublicMetadataCacheStatsSnapshot;
  }
}

if (typeof window !== 'undefined') {
  window.__SEENIT_TMDB_CACHE_STATS__ = () => getPublicMetadataCacheStats();
}
