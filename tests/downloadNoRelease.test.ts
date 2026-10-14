import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmNoArrRelease, executeProvenArrSearch, requireArrReleaseArray, sonarrSeriesSearchQueries } from '../src/features/downloads/downloadNoRelease.ts';

const healthy = [{ enableAutomaticSearch: true, enableInteractiveSearch: true }];

test('SEENIT-NOTIFICATION-004 conclut uniquement après tous les scopes et fallbacks', async () => {
  const visited: string[] = [];
  let launched = 0;
  const result = await executeProvenArrSearch({
    queries: ['episode', 'pack'],
    read: async path => { visited.push(path); return path === 'indexer' ? healthy : []; },
    launch: async () => { launched++; },
  });
  assert.equal(result.failureCode, 'no_release');
  assert.equal(launched, 0);
  assert.deepEqual(visited, ['episode', 'pack', 'health', 'indexer']);
});

test('une release admissible conserve le succès sans alerte et attend le lancement confirmé', async () => {
  let launched = 0;
  const result = await executeProvenArrSearch({
    queries: ['release?movieId=11'], preference: '1080p',
    read: async () => [{ approved: true, quality: { quality: { resolution: 1080 } } }],
    launch: async () => { launched++; },
  });
  assert.equal(result.success, true);
  assert.equal(result.failureCode, undefined);
  assert.equal(launched, 1);
});

test('une panne, un timeout, une réponse invalide ou un grab refusé ne devient jamais no_release', async () => {
  for (const response of [null, {}, '<html>', [null], [{}]]) {
    const result = await executeProvenArrSearch({ queries: ['episode'], read: async () => response, launch: async () => {} });
    assert.equal(result.failureCode, undefined);
    assert.equal(result.success, false);
  }
  for (const message of ['timeout', 'HTTP 401', 'HTTP 503']) {
    const result = await executeProvenArrSearch({ queries: ['episode'], read: async () => { throw new Error(message); }, launch: async () => {} });
    assert.equal(result.failureCode, undefined);
    assert.match(result.message, new RegExp(message));
  }
  const refused = await executeProvenArrSearch({ queries: ['episode'], read: async () => [{ approved: true }], launch: async () => { throw new Error('client indisponible'); } });
  assert.equal(refused.failureCode, undefined);
  assert.equal(refused.success, false);
  assert.throws(() => requireArrReleaseArray(''), /invalide/);
});

test('une panne indexer ou un indexer non observable interdit une fausse absence', async () => {
  for (const [health, indexers] of [[[{ source: 'IndexerStatusCheck' }], healthy], [[], []], [[], [{ enableAutomaticSearch: true, enableInteractiveSearch: false }]]]) {
    const result = await confirmNoArrRelease(async path => path === 'health' ? health : indexers);
    assert.equal(result.failureCode, undefined);
    assert.equal(result.success, false);
  }
});

test('la série vérifie chaque saison diffusée et manquante, jamais le flux RSS global', () => {
  const queries = sonarrSeriesSearchQueries(19, [
    { seasonNumber: 1, airDateUtc: '2020-01-01', hasFile: false },
    { seasonNumber: 1, airDateUtc: '2020-01-02', hasFile: false },
    { seasonNumber: 2, airDateUtc: '2020-01-01' },
    { seasonNumber: 3, airDateUtc: '2099-01-01' },
    { seasonNumber: 4, airDateUtc: '2020-01-01', hasFile: true },
  ]);
  assert.deepEqual(queries, ['release?seriesId=19&seasonNumber=1', 'release?seriesId=19&seasonNumber=2']);
});

// CI recovery 2026-10-14: no functional change; resynchronize PR checks after GitHub access restoration.
