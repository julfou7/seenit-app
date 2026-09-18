import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  PUBLIC_METADATA_CACHE_MAX_ENTRY_BYTES,
  PUBLIC_METADATA_CACHE_PERSISTENT_MAX_BYTES,
  PUBLIC_METADATA_CACHE_PERSISTENT_MAX_ENTRIES,
  PUBLIC_METADATA_CACHE_POLICIES,
  isPublicMetadataFallbackStatus,
  clearPublicMetadataMemoryCacheForTests,
  getPublicMetadataCacheStats,
  normalizePublicMetadataRequestKey,
  readPublicMetadataCache,
  runPublicMetadataSingleFlight,
  writePublicMetadataCache,
} from '../src/features/shows/publicMetadataCache.ts';

test('SEENIT-PERF-001 mutualise les métadonnées publiques avec TTL par famille et single-flight', async () => {
  clearPublicMetadataMemoryCacheForTests();
  const key = '/movie/42?language=fr-FR';
  writePublicMetadataCache('details', key, { id: 42, title: 'Test' }, { now: 1_000 });

  const fresh = await readPublicMetadataCache<{ id: number }>('details', key, { now: 2_000, allowStale: true });
  assert.equal(fresh?.fresh, true);
  assert.equal(fresh?.data.id, 42);

  const stale = await readPublicMetadataCache<{ id: number }>('details', key, {
    now: 1_000 + PUBLIC_METADATA_CACHE_POLICIES.details.freshMs + 1,
    allowStale: true,
  });
  assert.equal(stale?.fresh, false, 'un détail expiré reste disponible uniquement comme fallback stale');

  let loads = 0;
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const first = runPublicMetadataSingleFlight('details', 'movie_99', async () => {
    loads += 1;
    await blocked;
    return { id: 99 };
  });
  const second = runPublicMetadataSingleFlight('details', 'movie_99', async () => {
    loads += 1;
    return { id: 99 };
  });
  assert.equal(first, second, 'deux consommateurs de la même ressource partagent exactement la Promise en vol');
  release();
  assert.deepEqual(await Promise.all([first, second]), [{ id: 99 }, { id: 99 }]);
  assert.equal(loads, 1);
  assert.equal(getPublicMetadataCacheStats().families.details.singleFlightHits, 1);
});

test('SEENIT-PERF-001 normalise les requêtes et ne persiste pas le texte de recherche', () => {
  const left = normalizePublicMetadataRequestKey('/api/media/tmdb/discover/movie?page=2&language=fr-FR&sort_by=popularity.desc');
  const right = normalizePublicMetadataRequestKey('/api/media/tmdb/discover/movie?sort_by=popularity.desc&language=fr-FR&page=2');
  assert.equal(left, right, 'l’ordre des paramètres ne doit pas créer deux entrées pour la même requête');
  assert.equal(PUBLIC_METADATA_CACHE_POLICIES.details.persist, true);
  assert.equal(PUBLIC_METADATA_CACHE_POLICIES.discover.persist, true);
  assert.equal(PUBLIC_METADATA_CACHE_POLICIES.search.persist, false, 'le texte recherché ne doit pas entrer dans IndexedDB');
  assert.equal(PUBLIC_METADATA_CACHE_PERSISTENT_MAX_ENTRIES, 320, 'le working set public reste volontairement borné');
  assert.equal(PUBLIC_METADATA_CACHE_PERSISTENT_MAX_BYTES, 32 * 1024 * 1024);
  assert.equal(PUBLIC_METADATA_CACHE_MAX_ENTRY_BYTES, 1024 * 1024, 'un seul payload TMDB ne peut pas monopoliser IndexedDB');
  assert.equal(isPublicMetadataFallbackStatus(429), true);
  assert.equal(isPublicMetadataFallbackStatus(503), true);
  assert.equal(isPublicMetadataFallbackStatus(401), false, 'un cache stale ne doit jamais masquer une authentification invalide');
  assert.equal(isPublicMetadataFallbackStatus(403), false);
  assert.equal(isPublicMetadataFallbackStatus(404), false);
});

test('issue #410 branche détails Discover et recherche sur le cache commun', () => {
  const client = readFileSync('src/features/shows/tmdbClient.ts', 'utf8');
  const core = readFileSync('src/features/shows/tmdbCore.ts', 'utf8');
  const backend = readFileSync('src/features/providers/mediaProviderBackendCore.ts', 'utf8');
  const cache = readFileSync('src/features/shows/publicMetadataCache.ts', 'utf8');

  assert.match(client, /readPublicMetadataCache<any>\('details'/);
  assert.match(client, /runPublicMetadataSingleFlight\('details'/);
  assert.match(client, /writePublicMetadataCache\('details'/);
  assert.match(client, /getCachedSearchResponse/);
  assert.match(client, /runPublicMetadataSingleFlight\('search'/);
  assert.match(core, /fetchCachedDiscoverPayload/);
  assert.match(core, /runPublicMetadataSingleFlight\('discover'/);
  assert.match(core, /writePublicMetadataCache\('discover'/);
  assert.match(cache, /indexedDB\.open\(PUBLIC_METADATA_CACHE_DB_NAME/);
  assert.match(cache, /PUBLIC_METADATA_CACHE_PERSISTENT_MAX_ENTRIES = 320/);
  assert.match(cache, /PUBLIC_METADATA_CACHE_PERSISTENT_MAX_BYTES = 32 \* 1024 \* 1024/);
  assert.match(cache, /PUBLIC_METADATA_CACHE_MAX_ENTRY_BYTES = 1024 \* 1024/);
  assert.match(cache, /__SEENIT_TMDB_CACHE_STATS__/);
  assert.match(backend, /TMDB_REQUEST_CACHE_SUMMARY/);
  assert.match(backend, /classifyTmdbMetricFamily/);
  const metricLogger = backend.slice(
    backend.indexOf('const recordTmdbCacheMetric'),
    backend.indexOf('const takeQuota'),
  );
  assert.ok(metricLogger.length > 0);
  assert.doesNotMatch(metricLogger, /uid|api_key|credential|target\.search|req\.query/i);
  assert.match(metricLogger, /upstreamBytes/);
});
