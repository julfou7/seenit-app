import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WATCH_PROVIDER_CACHE_MAX_ENTRIES,
  WATCH_PROVIDER_CACHE_STALE_MAX_AGE_MS,
  WATCH_PROVIDER_CACHE_TTL_MS,
  getWatchProviderCacheKey,
  readWatchProviderCache,
  writeWatchProviderCache,
} from '../src/features/providers/watchProviderCache.ts';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

test('SEENIT-PERF-001 persiste les diffuseurs par type et TMDB ID entre deux lectures', () => {
  const storage = new MemoryStorage();
  const now = 1_000_000;
  writeWatchProviderCache(42, 'movie', { results: { FR: { flatrate: [{ provider_name: 'Test' }] } } }, { storage, now });
  writeWatchProviderCache(42, 'tv', { results: { FR: { flatrate: [{ provider_name: 'TV' }] } } }, { storage, now });

  assert.equal(getWatchProviderCacheKey(42, 'movie'), 'movie:42');
  assert.equal(readWatchProviderCache(42, 'movie', { storage, now: now + 1 })?.data.results.FR.flatrate[0].provider_name, 'Test');
  assert.equal(readWatchProviderCache(42, 'tv', { storage, now: now + 1 })?.data.results.FR.flatrate[0].provider_name, 'TV');
});

test('SEENIT-PERF-001 garde un diffuseur périmé uniquement en stale-if-error', () => {
  const storage = new MemoryStorage();
  const now = 2_000_000;
  writeWatchProviderCache(603, 'movie', { results: { FR: {} } }, { storage, now });

  assert.equal(
    readWatchProviderCache(603, 'movie', { storage, now: now + WATCH_PROVIDER_CACHE_TTL_MS + 1 }),
    null,
    'une entrée hors TTL ne doit pas masquer un rafraîchissement normal',
  );
  assert.ok(
    readWatchProviderCache(603, 'movie', {
      storage,
      now: now + WATCH_PROVIDER_CACHE_TTL_MS + 1,
      allowStale: true,
    }),
    'la dernière valeur reste disponible pour stale-if-error',
  );
  assert.equal(
    readWatchProviderCache(603, 'movie', {
      storage,
      now: now + WATCH_PROVIDER_CACHE_STALE_MAX_AGE_MS + 1,
      allowStale: true,
    }),
    null,
    'une donnée trop ancienne doit être abandonnée même en fallback',
  );
});

test('SEENIT-PERF-001 borne le cache persistant des diffuseurs', () => {
  const storage = new MemoryStorage();
  const now = 3_000_000;
  for (let index = 0; index < WATCH_PROVIDER_CACHE_MAX_ENTRIES + 10; index++) {
    writeWatchProviderCache(index + 1, 'movie', { index }, { storage, now: now + index });
  }

  let retained = 0;
  for (let index = 0; index < WATCH_PROVIDER_CACHE_MAX_ENTRIES + 10; index++) {
    if (readWatchProviderCache(index + 1, 'movie', { storage, now: now + 1000, allowStale: true })) retained++;
  }
  assert.equal(retained, WATCH_PROVIDER_CACHE_MAX_ENTRIES);
  assert.equal(readWatchProviderCache(1, 'movie', { storage, now: now + 1000, allowStale: true }), null);
});
