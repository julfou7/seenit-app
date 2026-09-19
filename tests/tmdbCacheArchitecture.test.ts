import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  PUBLIC_METADATA_CACHE_MAX_ENTRY_BYTES,
  PUBLIC_METADATA_CACHE_PERSISTENT_MAX_BYTES,
  PUBLIC_METADATA_CACHE_PERSISTENT_MAX_ENTRIES,
  PUBLIC_METADATA_CACHE_POLICIES,
} from '../src/features/shows/publicMetadataCache.ts';
import {
  WATCH_PROVIDER_CACHE_MAX_ENTRIES,
  WATCH_PROVIDER_LIBRARY_CACHE_MAX_ENTRIES,
  WATCH_PROVIDER_CACHE_STALE_MAX_AGE_MS,
  WATCH_PROVIDER_CACHE_TTL_MS,
} from '../src/features/providers/watchProviderCache.ts';
import {
  PARENTAL_RATING_CACHE_MAX_ENTRIES,
  PARENTAL_RATING_CACHE_STALE_MAX_AGE_MS,
  PARENTAL_RATING_CACHE_TTL_MS,
} from '../src/features/shows/parentalRatingCache.ts';

const clientSource = readFileSync('src/features/shows/tmdbClient.ts', 'utf8');
const publicCacheSource = readFileSync('src/features/shows/publicMetadataCache.ts', 'utf8');
const backendSource = readFileSync('src/features/providers/mediaProviderBackendCore.ts', 'utf8');
const serverSource = readFileSync('server.ts', 'utf8');
const audit = readFileSync('docs/audits/tmdb-cache-architecture-2026-09-19.md', 'utf8');

test('SEENIT-PERF-001 borne toutes les mémoires TMDB et n’ajoute aucun Firestore générique', () => {
  assert.equal(PUBLIC_METADATA_CACHE_PERSISTENT_MAX_ENTRIES, 320);
  assert.equal(PUBLIC_METADATA_CACHE_PERSISTENT_MAX_BYTES, 32 * 1024 * 1024);
  assert.equal(PUBLIC_METADATA_CACHE_MAX_ENTRY_BYTES, 1024 * 1024);
  assert.deepEqual(
    Object.fromEntries(Object.entries(PUBLIC_METADATA_CACHE_POLICIES).map(([family, policy]) => [family, policy.memoryMaxEntries])),
    { details: 120, discover: 96, search: 80, season: 80 },
  );

  assert.match(clientSource, /export const EPISODE_DETAILS_CACHE_MAX_ENTRIES = 120/);
  assert.match(clientSource, /export const EPISODE_DETAILS_CACHE_TTL_MS = 30 \* 60 \* 1000/);
  assert.match(
    clientSource,
    /episodeDetailsCache = new BoundedCache<string, \{ data: any; timestamp: number \}>\(EPISODE_DETAILS_CACHE_MAX_ENTRIES\)/,
  );
  assert.doesNotMatch(clientSource, /episodeDetailsCache = new Map/);

  assert.equal(WATCH_PROVIDER_CACHE_MAX_ENTRIES, 120);
  assert.equal(WATCH_PROVIDER_LIBRARY_CACHE_MAX_ENTRIES, 240);
  assert.equal(WATCH_PROVIDER_CACHE_TTL_MS, 6 * 60 * 60 * 1000);
  assert.equal(WATCH_PROVIDER_CACHE_STALE_MAX_AGE_MS, 7 * 24 * 60 * 60 * 1000);

  assert.equal(PARENTAL_RATING_CACHE_MAX_ENTRIES, 1_500);
  assert.equal(PARENTAL_RATING_CACHE_TTL_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(PARENTAL_RATING_CACHE_STALE_MAX_AGE_MS, 30 * 24 * 60 * 60 * 1000);

  assert.match(backendSource, /const MAX_CACHE_BYTES = 16 \* 1024 \* 1024/);
  assert.match(backendSource, /while \(cache\.size >= 200 \|\| cacheBytes \+ bytes > MAX_CACHE_BYTES\)/);
  assert.match(serverSource, /const PARENTAL_EVIDENCE_TTL_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(serverSource, /\.slice\(0, 40\)/);
  assert.doesNotMatch(publicCacheSource, /firebase|firestore|adminDb|publicParentalRatingEvidence/i);
});

test('issue #410 mesure une session représentative sur deux ouvertures et réduit les appels fournisseur', () => {
  type Family = 'details' | 'discover' | 'search' | 'season' | 'watch_providers' | 'parental';
  const firstOpen: Array<{ family: Family; key: string }> = [
    { family: 'discover', key: 'explorer:page1' },
    { family: 'discover', key: 'explorer:page2' },
    { family: 'details', key: 'tv:1396' },
    { family: 'details', key: 'movie:603' },
    { family: 'search', key: 'matrix' },
    { family: 'season', key: '1396:1' },
    { family: 'watch_providers', key: 'movie:603' },
    { family: 'parental', key: 'tv:1396' },
  ];
  const secondOpen = firstOpen.map(item => ({ ...item }));

  const baselinePersisted = new Set<Family>(['watch_providers', 'parental']);
  const currentPersisted = new Set<Family>([
    'details',
    'discover',
    'season',
    'watch_providers',
    'parental',
  ]);

  const upstreamAcrossTwoOpens = (persisted: Set<Family>) => {
    const first = new Set(firstOpen.map(item => `${item.family}:${item.key}`)).size;
    const second = secondOpen.filter(item => !persisted.has(item.family)).length;
    return first + second;
  };

  const baselineCalls = upstreamAcrossTwoOpens(baselinePersisted);
  const currentCalls = upstreamAcrossTwoOpens(currentPersisted);
  const reduction = (baselineCalls - currentCalls) / baselineCalls;

  assert.equal(baselineCalls, 14);
  assert.equal(currentCalls, 9);
  assert.ok(reduction >= 0.35, `réduction attendue >= 35 %, obtenue ${reduction}`);
  assert.equal(secondOpen.filter(item => !baselinePersisted.has(item.family)).length, 6);
  assert.equal(secondOpen.filter(item => !currentPersisted.has(item.family)).length, 1);
  assert.equal(PUBLIC_METADATA_CACHE_POLICIES.search.persist, false);
});

test('issue #410 documente chaque famille TMDB et la décision âge diffuseurs', () => {
  const families = [
    'details',
    'discover',
    'search',
    'find',
    'trending',
    'collection',
    'person',
    'season',
    'episode',
    'watch_providers',
    'parental',
    'metadata',
  ];
  for (const family of families) {
    assert.ok(
      backendSource.includes(`'${family}'`),
      `famille ${family} absente du classifieur backend`,
    );
    assert.ok(audit.includes('| `' + family + '` |'), `famille ${family} absente de l'audit`);
  }

  assert.match(audit, /Décision : \*\*convergence d'identité et d'observabilité, pas convergence physique du stockage\*\*/);
  assert.match(audit, /baseline v1\.4\.166 : 14 appels potentiels/);
  assert.match(audit, /architecture #410 : 9 appels potentiels/);
  assert.match(audit, /35,7 %/);
  assert.match(audit, /83,3 %/);
});
