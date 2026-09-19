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

test('SEENIT-PERF-001 persiste les saisons TMDB avec TTL court et single-flight commun', async () => {
  clearPublicMetadataMemoryCacheForTests();
  const key = '1396:2';
  writePublicMetadataCache('season', key, { id: 2, episodes: [{ id: 1 }] }, { now: 1_000 });

  const fresh = await readPublicMetadataCache<any>('season', key, {
    now: 1_000 + PUBLIC_METADATA_CACHE_POLICIES.season.freshMs - 1,
    allowStale: true,
  });
  assert.equal(fresh?.fresh, true);
  assert.equal(fresh?.data.episodes[0].id, 1);

  const stale = await readPublicMetadataCache<any>('season', key, {
    now: 1_000 + PUBLIC_METADATA_CACHE_POLICIES.season.freshMs + 1,
    allowStale: true,
  });
  assert.equal(stale?.fresh, false);
  assert.equal(PUBLIC_METADATA_CACHE_POLICIES.season.freshMs, 2 * 60 * 60 * 1000);
  assert.equal(PUBLIC_METADATA_CACHE_POLICIES.season.staleMs, 24 * 60 * 60 * 1000);
  assert.equal(PUBLIC_METADATA_CACHE_POLICIES.season.persist, true);

  const client = readFileSync('src/features/shows/tmdbClient.ts', 'utf8');
  const seasonMethod = client.slice(
    client.indexOf('async getSeasonDetails'),
    client.indexOf('async getEpisodeDetails'),
  );
  assert.match(seasonMethod, /readPublicMetadataCache<any>\('season', cacheKey/);
  assert.match(seasonMethod, /runPublicMetadataSingleFlight\('season', cacheKey/);
  assert.match(seasonMethod, /writePublicMetadataCache\('season', cacheKey, data\.value\)/);
  assert.match(seasonMethod, /isPublicMetadataFallbackStatus\(res\.value\.status\)/);
  assert.match(
    seasonMethod,
    /writePublicMetadataCache\('season', cacheKey, data\.value\);[\s\S]*data\.value = await decorateForEurope\(data\.value\)/,
    'le payload brut TMDB doit être persisté avant la décoration Europe',
  );
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
  assert.match(client, /async getCachedDiscoverResponse/);
  assert.match(client, /runPublicMetadataSingleFlight\('discover'/);
  assert.match(client, /writePublicMetadataCache\('discover'/);
  assert.match(core, /fetchCachedDiscoverPayload = async \(url: string\) => tmdbClient\.getCachedDiscoverResponse\(url\)/);
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
