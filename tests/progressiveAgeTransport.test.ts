import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('issue #326 v1.4.158 coalesce la vague parentale dans un transport authentifié streamé', () => {
  const client = readFileSync('src/features/discover/progressiveAgeFilter.ts', 'utf8');
  const backend = readFileSync('src/features/providers/parentalRatingBatchBackend.ts', 'utf8');
  assert.match(client, /parentalTransportPending = new Map/);
  assert.match(client, /queueMicrotask\(\(\) => \{ void flushParentalTransport\(\); \}\)/);
  assert.match(client, /parental-ratings\?stream=1&items=/);
  assert.match(client, /response\.value\.body\.getReader\(\)/);
  assert.match(client, /pending\.deferred\.resolve\(/);
  assert.match(client, /const PARENTAL_TRANSPORT_MAX_ITEMS = 40;/);
  assert.match(client, /const PARENTAL_PROGRESSIVE_MAX_CONCURRENT = PARENTAL_TRANSPORT_MAX_ITEMS;/);
  assert.match(client, /setTimeout\(flushPendingSnapshot, PROGRESSIVE_SNAPSHOT_BATCH_MS\)/);
  assert.match(backend, /application\/x-ndjson/);
  assert.match(backend, /JSON\.stringify\(result\)/);
  assert.match(backend, /const results = await Promise\.all\(items\.map\(item => resolveItem\(item\)\)\)/);
});

test('issue #326 retire les traces temporaires du filtre âge sans retirer le transport groupé', () => {
  const client = readFileSync('src/features/discover/progressiveAgeFilter.ts', 'utf8');
  const backend = readFileSync('src/features/providers/parentalRatingBatchBackend.ts', 'utf8');
  const apiAuth = readFileSync('src/lib/apiAuth.ts', 'utf8');
  assert.equal(existsSync('src/lib/ageFilterTrace.ts'), false);
  for (const source of [client, backend, apiAuth]) assert.doesNotMatch(source, /AgeFilterTrace|AGE_FILTER_REQUEST_TRACE|age_filter_diagnostic|X-SeenIt-Age/);
  assert.match(client, /parental-ratings\?stream=1&items=/);
  assert.match(backend, /PARENTAL_BATCH_MAX_CONCURRENT = 24/);
});

test('issue #326 propage l’annulation de génération jusqu’au transport parental', () => {
  const client = readFileSync('src/features/discover/progressiveAgeFilter.ts', 'utf8');
  const backend = readFileSync('src/features/providers/parentalRatingBatchBackend.ts', 'utf8');
  assert.match(client, /createSupersedingAbortController/);
  assert.match(client, /dependencies\.resolveBatch\(prefix, requestSignal\)/);
  assert.match(client, /authenticatedFetch\([\s\S]*?\{ signal \}[\s\S]*?\)/);
  assert.match(backend, /res\.once\('close'/);
  assert.match(backend, /clientAbort\.abort\(\)/);
  assert.match(backend, /AbortSignal\.any/);
});


test('issue #326 réutilise l’index parental et préfiltre uniquement les films à la source', () => {
  const client = readFileSync('src/features/discover/progressiveAgeFilter.ts', 'utf8');
  const tmdbClient = readFileSync('src/features/shows/tmdbClient.ts', 'utf8');
  const core = readFileSync('src/features/shows/tmdbCore.ts', 'utf8');
  const server = readFileSync('server.ts', 'utf8');

  assert.match(client, /readParentalRatingCache\(identity\.id, identity\.mediaType\)/);
  assert.match(client, /readPersistentBatchDetails\(identity\)/);
  assert.match(client, /writeParentalRatingCache\(id, mediaType, details\)/);
  assert.match(tmdbClient, /readParentalRatingCache\(normalizedId, type\)/);
  assert.match(tmdbClient, /writeParentalRatingCache\(normalizedId, type, details\)/);
  assert.match(client, /parentalPrefilterMaxAge: maxAge/);
  assert.match(core, /mediaType === 'movie'[\s\S]*?buildMovieCertificationPrefilter/);
  assert.match(core, /params\.set\('certification_country', prefilter\.country\)/);
  assert.match(core, /params\.set\('certification\.lte', prefilter\.lte\)/);
  assert.doesNotMatch(core, /mediaType === 'tv'[\s\S]{0,300}certification_country/);
  assert.match(server, /publicParentalRatingEvidence/);
  assert.match(server, /parentalEvidence:[\s\S]*?read: readPersistedParentalEvidence/);
});
