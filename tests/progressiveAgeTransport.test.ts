import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// TNR terrain #326 v1.4.158 : le scheduler unitaire ne doit plus produire une
// authentification + requête HTTP par média. Une vague est coalescée en un transport
// streamé, tandis que chaque ligne résolue reste publiable indépendamment.
test('issue #326 v1.4.158 coalesce la vague parentale dans un transport authentifié streamé', () => {
  const client = readFileSync('src/features/discover/progressiveAgeFilter.ts', 'utf8');
  const backend = readFileSync('src/features/providers/parentalRatingBatchBackend.ts', 'utf8');
  const apiAuth = readFileSync('src/lib/apiAuth.ts', 'utf8');

  assert.match(client, /parentalTransportPending = new Map/);
  assert.match(apiAuth, /auth_headers_ready/);
  assert.match(apiAuth, /http_response_headers/);
  assert.match(apiAuth, /X-SeenIt-Age-Trace/);
  assert.match(client, /queueMicrotask\(\(\) => \{ void flushParentalTransport\(\); \}\)/);
  assert.match(client, /parental-ratings\?stream=1&items=/);
  assert.match(client, /X-SeenIt-Age-Trace/);
  assert.match(client, /transport_request_start/);
  assert.match(client, /transport_response_headers/);
  assert.match(client, /transport_stream_item/);
  assert.match(client, /discover_complete/);
  assert.match(client, /response\.value\.body\.getReader\(\)/);
  assert.match(client, /pending\.deferred\.resolve\(/, 'une preuve reçue doit débloquer son média sans attendre la fin du stream');
  assert.match(client, /const PARENTAL_TRANSPORT_MAX_ITEMS = 40;/);
  assert.match(client, /const PARENTAL_PROGRESSIVE_MAX_CONCURRENT = PARENTAL_TRANSPORT_MAX_ITEMS;/);
  assert.match(client, /setTimeout\(flushPendingSnapshot, PROGRESSIVE_SNAPSHOT_BATCH_MS\)/);
  assert.match(client, /filterResolvedPrefixes<any, any \| null, any>\(\s*baseResult\.value\.results,\s*1,/);
  assert.match(client, /publishSnapshot\(\{ generation, page, partial: null \}\)/);

  assert.match(backend, /key !== 'items' && key !== 'stream'/);
  assert.match(backend, /AGE_FILTER_REQUEST_TRACE/);
  assert.match(backend, /provider_start/);
  assert.match(backend, /provider_done/);
  assert.match(backend, /stream_first_write/);
  assert.match(backend, /request_complete/);
  assert.match(backend, /ordinal/);
  assert.match(backend, /maxActive/);
  assert.match(backend, /maxQueued/);
  assert.match(backend, /burstGrants/);
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
  assert.match(client, /dependencies\.resolveBatch\(prefix, requestSignal, trace\)/);
  assert.match(client, /authenticatedFetch\([\s\S]*?\{ signal, headers: traceHeaders \}[\s\S]*?\)/);
  assert.match(client, /parentalTransportPending = new Map<AbortSignal \| undefined/);
  assert.match(client, /if \(signal\?\.aborted\) return Promise\.resolve\(null\)/);

  assert.match(backend, /res\.once\('close'/);
  assert.match(backend, /clientAbort\.abort\(\)/);
  assert.match(backend, /AbortSignal\.any\(\[AbortSignal\.timeout\(timeoutMs\), clientAbort\.signal\]\)/);
  assert.doesNotMatch(backend, /\(res as any\)\.flush\?\.\(\)/, 'le correctif AI Studio non prouvé ne doit pas survivre au nettoyage');
});
