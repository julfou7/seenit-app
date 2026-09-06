import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BoundedCache,
  getManifestRelationSnapshot,
} from '../src/features/shows/mediaRelations.ts';

const tmdbClientSource = readFileSync(new URL('../src/features/shows/tmdbClient.ts', import.meta.url), 'utf8');
const detailSource = readFileSync(new URL('../src/screens/ShowDetailScreen.tsx', import.meta.url), 'utf8');

test('SEENIT-PERF-001 réutilise les détails et relations sans nouveau chargement', () => {
  const startedAt = performance.now();
  const first = getManifestRelationSnapshot('tv:1396');
  const second = getManifestRelationSnapshot('movie:559969');
  assert.deepEqual(first?.universe, second?.universe);
  assert.ok(performance.now() - startedAt < 150);
  assert.match(tmdbClientSource, /detailsCache = new BoundedCache<string, any>\(80\)/);
  assert.match(tmdbClientSource, /detailsInFlight\.get\(cacheKey\)/);
  assert.match(tmdbClientSource, /if \(existingRequest\) return existingRequest/);
  assert.match(tmdbClientSource, /peekMediaDetails/);
  assert.match(tmdbClientSource, /peekUniverseAndCollection/);
});

test('SEENIT-PERF-001 sépare les caches movie et tv et borne leur taille', () => {
  const cache = new BoundedCache<string, string>(2);
  cache.set('movie:42', 'film');
  cache.set('tv:42', 'série');
  assert.equal(cache.get('movie:42'), 'film');
  assert.equal(cache.get('tv:42'), 'série');

  cache.set('movie:43', 'autre film');
  assert.equal(cache.size, 2);
  assert.equal(cache.get('movie:42'), undefined);
  assert.equal(cache.get('tv:42'), 'série');
});

test('SEENIT-PERF-001 réserve les skeletons au chargement réellement froid', () => {
  assert.match(detailSource, /peekMediaDetails/);
  assert.match(detailSource, /peekUniverseAndCollection/);
  assert.match(detailSource, /setCollectionLoading\(!cachedRelations\)/);
  assert.match(detailSource, /loading="eager" decoding="async"[\s\S]{0,120}fetchPriority="high"/);
});
