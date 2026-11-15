import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WATCH_PROVIDER_CACHE_MAX_ENTRIES,
  WATCH_PROVIDER_LIBRARY_CACHE_MAX_ENTRIES,
  WATCH_PROVIDER_CACHE_STALE_MAX_AGE_MS,
  WATCH_PROVIDER_CACHE_TTL_MS,
  getWatchProviderCacheKey,
  readWatchProviderCache,
  retainWatchProviderCacheEntry,
  writeWatchProviderCache,
  recordWatchProviderPayload,
  WATCH_PROVIDER_CACHE_STORAGE_KEY,
} from '../src/features/providers/watchProviderCache.ts';
import { readFileSync } from 'node:fs';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

test('SEENIT-PERF-001 persiste les diffuseurs par type et TMDB ID entre deux lectures', () => {
  const storage = new MemoryStorage();
  const now = 1_000_000;
  writeWatchProviderCache(42, 'movie', {
    results: {
      FR: { flatrate: [{ provider_name: 'Test' }] },
      US: { flatrate: [{ provider_name: 'Foreign' }] },
    },
  }, { storage, now });
  writeWatchProviderCache(42, 'tv', { results: { FR: { flatrate: [{ provider_name: 'TV' }] } } }, { storage, now });

  assert.equal(getWatchProviderCacheKey(42, 'movie'), 'movie:42');
  assert.equal(readWatchProviderCache(42, 'movie', { storage, now: now + 1 })?.data.results.FR.flatrate[0].provider_name, 'Test');
  assert.equal(readWatchProviderCache(42, 'movie', { storage, now: now + 1 })?.data.results.US, undefined,
    'le cache persistant ne doit pas payer le poids des pays inutilisés par SeenIt');
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

test('SEENIT-PERF-001 protège les diffuseurs suivis des évictions Explorer', () => {
  const storage = new MemoryStorage();
  const now = 4_000_000;
  for (let index = 0; index < WATCH_PROVIDER_LIBRARY_CACHE_MAX_ENTRIES; index += 1) {
    writeWatchProviderCache(index + 1, 'movie', { scope: 'library', index }, {
      storage,
      now: now + index,
      retention: 'library',
    });
  }
  for (let index = 0; index < WATCH_PROVIDER_CACHE_MAX_ENTRIES + 20; index += 1) {
    writeWatchProviderCache(index + 10_000, 'movie', { scope: 'discovery', index }, {
      storage,
      now: now + 1_000 + index,
    });
  }

  assert.ok(readWatchProviderCache(1, 'movie', { storage, now: now + 2_000, allowStale: true }));
  assert.equal(
    readWatchProviderCache(10_000, 'movie', { storage, now: now + 2_000, allowStale: true }),
    null,
    'Explorer doit continuer à évincer seulement ses entrées les plus anciennes',
  );

  const promotedAt = now + 3_000;
  writeWatchProviderCache(50_000, 'movie', { promoted: true }, { storage, now: promotedAt });
  assert.equal(retainWatchProviderCacheEntry(50_000, 'movie', { storage, now: promotedAt + 500 }), true);
  assert.equal(
    readWatchProviderCache(50_000, 'movie', {
      storage,
      now: promotedAt + WATCH_PROVIDER_CACHE_STALE_MAX_AGE_MS + 1,
      allowStale: true,
    }),
    null,
    'promouvoir une entrée ne doit jamais renouveler artificiellement son horodatage',
  );
});

test('#641 des pannes répétées ne rajeunissent pas une copie périmée ; elle expire à sept jours', () => {
  const storage = new MemoryStorage();
  const t0 = 10_000_000;
  const payload = { results: { FR: { flatrate: [{ provider_name: 'Ancien' }] } } };
  writeWatchProviderCache(7, 'movie', payload, { storage, now: t0, defer: false });
  // Même enchaînement que la façade tmdbCore (succès réseau absent → copie périmée) puis la carte (hook).
  const facadeAfterNetworkFailure = (now: number) => readWatchProviderCache(7, 'movie', { storage, now, allowStale: true })?.data ?? null;
  for (const day of [1, 3, 5, 6.9]) {
    const now = t0 + day * 86_400_000;
    const stale = facadeAfterNetworkFailure(now);
    assert.ok(stale, `jour ${day} : stale-if-error toujours servi`);
    recordWatchProviderPayload(7, 'movie', stale, { storage, now, defer: false, retention: 'library' });
    const entry = readWatchProviderCache(7, 'movie', { storage, now, allowStale: true });
    assert.equal(entry?.timestamp, t0, `jour ${day} : l’âge réel est conservé`);
    assert.equal(entry?.fresh, false, `jour ${day} : jamais redevenue fraîche`);
  }
  assert.equal(facadeAfterNetworkFailure(t0 + WATCH_PROVIDER_CACHE_STALE_MAX_AGE_MS), null, 'au-delà de sept jours : plus de copie servie');

  // Une copie absente reste enregistrée normalement, et la rétention bibliothèque est conservée.
  recordWatchProviderPayload(8, 'tv', payload, { storage, now: t0, defer: false, retention: 'library' });
  assert.equal(readWatchProviderCache(8, 'tv', { storage, now: t0 })?.timestamp, t0);
  const stored = JSON.parse(storage.getItem(WATCH_PROVIDER_CACHE_STORAGE_KEY) || '{}');
  assert.equal(stored[getWatchProviderCacheKey(7, 'movie')].retention, 'library', 'la carte bibliothèque garde sa rétention sans changer l’âge');

  // Câblage de production : la façade sert la copie périmée sur panne, la carte n'écrit plus directement.
  const core = readFileSync('src/features/shows/tmdbCore.ts', 'utf8');
  assert.match(core, /return stalePersistent \? ok\(stalePersistent\.data\) : result;/);
  const hook = readFileSync('src/hooks/usePassiveWatchProvider.ts', 'utf8');
  assert.match(hook, /recordWatchProviderPayload\(numericTmdbId, mediaType, res\.value, \{/);
  assert.doesNotMatch(hook, /writeWatchProviderCache\(/);
});
