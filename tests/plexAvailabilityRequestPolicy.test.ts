import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  createAsyncRequestLimiter,
  isConfirmedPlexAvailabilityResponse,
  PLEX_AVAILABILITY_MAX_CONCURRENT,
  PLEX_AVAILABILITY_REQUEST_TIMEOUT_MS,
  shouldRunPlexAvailabilityNetwork,
} from '../src/features/plex/plexAvailabilityRequestPolicy.ts';

const root = path.resolve(import.meta.dirname, '..');

test('SEENIT-PLEX-002 borne les requêtes Availability à deux exécutions simultanées', async () => {
  const limiter = createAsyncRequestLimiter(PLEX_AVAILABILITY_MAX_CONCURRENT);
  let running = 0;
  let maxRunning = 0;
  let releaseNext: (() => void) | undefined;
  const gate = () => new Promise<void>(resolve => { releaseNext = resolve; });

  const firstGate = gate();
  const tasks = Array.from({ length: 8 }, (_, index) => limiter.run(async () => {
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    if (index < 2) await firstGate;
    await new Promise(resolve => setTimeout(resolve, 2));
    running -= 1;
    return index;
  }));

  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(limiter.getActiveCount(), 2);
  assert.equal(limiter.getPendingCount(), 6);
  assert.equal(maxRunning, 2);
  releaseNext?.();

  const values = await Promise.all(tasks);
  assert.deepEqual(values, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(maxRunning, 2);
  assert.equal(limiter.getActiveCount(), 0);
  assert.equal(limiter.getPendingCount(), 0);
});

test('SEENIT-PLEX-002 réserve le réseau aux vérifications explicitement actives', () => {
  assert.equal(shouldRunPlexAvailabilityNetwork(), false);
  assert.equal(shouldRunPlexAvailabilityNetwork('cache-only'), false);
  assert.equal(shouldRunPlexAvailabilityNetwork('active'), true);
});

test('SEENIT-PLEX-002 ne considère comme négatif confirmé qu’un contrat 2xx explicite', () => {
  assert.equal(isConfirmedPlexAvailabilityResponse(200, { available: false }), true);
  assert.equal(isConfirmedPlexAvailabilityResponse(200, { available: true }), true);
  assert.equal(isConfirmedPlexAvailabilityResponse(401, { available: false }), false);
  assert.equal(isConfirmedPlexAvailabilityResponse(503, { available: false }), false);
  assert.equal(isConfirmedPlexAvailabilityResponse(200, null), false);
  assert.equal(isConfirmedPlexAvailabilityResponse(200, {}), false);
});

test('SEENIT-PLEX-002 laisse au fallback partagé le budget nécessaire et verrouille les consommateurs', () => {
  assert.equal(PLEX_AVAILABILITY_REQUEST_TIMEOUT_MS, 20_000);
  assert.ok(PLEX_AVAILABILITY_REQUEST_TIMEOUT_MS >= 20_000);

  const availabilitySource = fs.readFileSync(
    path.join(root, 'src/features/plex/plexAvailability.ts'),
    'utf8'
  );
  const presenceSource = fs.readFileSync(
    path.join(root, 'src/store/mediaPresenceStore.ts'),
    'utf8'
  );

  assert.match(availabilitySource, /PLEX_AVAILABILITY_REQUEST_TIMEOUT_MS/);
  assert.doesNotMatch(availabilitySource, /connectTimeout:\s*5000|readTimeout:\s*5000|AbortSignal\.timeout\(5000\)/);
  assert.match(presenceSource, /networkMode:\s*['"]active['"]/);
});
