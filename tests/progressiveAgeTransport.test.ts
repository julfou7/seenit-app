import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// TNR terrain #326 v1.4.158 : le scheduler unitaire ne doit plus produire une
// authentification + requête HTTP par média. Une vague est coalescée en un transport
// streamé, tandis que chaque ligne résolue reste publiable indépendamment.
test('issue #326 v1.4.158 coalesce la vague parentale dans un transport authentifié streamé', () => {
  const client = readFileSync('src/features/discover/progressiveAgeFilter.ts', 'utf8');
  const backend = readFileSync('src/features/providers/parentalRatingBatchBackend.ts', 'utf8');

  assert.match(client, /parentalTransportPending = new Map/);
  assert.match(client, /queueMicrotask\(\(\) => \{ void flushParentalTransport\(\); \}\)/);
  assert.match(client, /parental-ratings\?stream=1&items=/);
  assert.match(client, /response\.value\.body\.getReader\(\)/);
  assert.match(client, /pending\.deferred\.resolve\(/, 'une preuve reçue doit débloquer son média sans attendre la fin du stream');
  assert.match(client, /const PARENTAL_TRANSPORT_MAX_ITEMS = 40;/);
  assert.match(client, /const PARENTAL_PROGRESSIVE_MAX_CONCURRENT = PARENTAL_TRANSPORT_MAX_ITEMS;/);
  assert.match(client, /setTimeout\(flushPendingSnapshot, PROGRESSIVE_SNAPSHOT_BATCH_MS\)/);
  assert.match(client, /filterResolvedPrefixes<any, any \| null, any>\(\s*baseResult\.value\.results,\s*1,/);
  assert.match(client, /publishSnapshot\(\{ generation, page, partial: null \}\)/);

  assert.match(backend, /key !== 'items' && key !== 'stream'/);
  assert.match(backend, /application\/x-ndjson/);
  assert.match(backend, /res\.write\(`\$\{JSON\.stringify\(result\)\}\\n`\)/);
  assert.match(backend, /await Promise\.all\(items\.map\(async item => \{/);
  assert.match(backend, /const results = await Promise\.all\(items\.map\(resolveItem\)\)/, 'le contrat JSON historique reste disponible hors mode stream');
});


test('issue #326 propage l’annulation de génération jusqu’au transport parental', () => {
  const client = readFileSync('src/features/discover/progressiveAgeFilter.ts', 'utf8');
  const backend = readFileSync('src/features/providers/parentalRatingBatchBackend.ts', 'utf8');

  assert.match(client, /createSupersedingAbortController/);
  assert.match(client, /const requestSignal = requestController\.signal/);
  assert.match(client, /dependencies\.resolveBatch\(prefix, requestSignal\)/);
  assert.match(client, /authenticatedFetch\([^\n]+, \{ signal \}\)/);
  assert.match(client, /parentalTransportPending = new Map<AbortSignal \| undefined/);
  assert.match(client, /if \(signal\?\.aborted\) return Promise\.resolve\(null\)/);

  assert.match(backend, /res\.once\('close'/);
  assert.match(backend, /clientAbort\.abort\(\)/);
  assert.match(backend, /AbortSignal\.any\(\[AbortSignal\.timeout\(timeoutMs\), clientAbort\.signal\]\)/);
  assert.doesNotMatch(backend, /\(res as any\)\.flush\?\.\(\)/, 'le correctif AI Studio non prouvé ne doit pas survivre au nettoyage');
});
