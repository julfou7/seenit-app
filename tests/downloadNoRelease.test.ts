import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmNoArrRelease, diskFullRejection, executeProvenArrSearch, requireArrReleaseArray, sonarrSeriesSearchQueries } from '../src/features/downloads/downloadNoRelease.ts';

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

// Retour terrain du 15/11 (« La Guerre des mondes ») : Radarr refusait toutes les versions faute de place,
// SeenIt affichait « Aucune release compatible trouvée ».
test('disque plein : une version refusée faute de place devient une panne nommée, jamais « aucune release »', async () => {
  const reads: string[] = [];
  const read = async (path: string) => {
    reads.push(path);
    if (path.startsWith('release')) return [
      { approved: false, title: 'War.of.the.Worlds.2025.1080p.WEB-DL', quality: { quality: { name: 'WEBDL-1080p', resolution: 1080 } }, rejections: ['Not enough free space'] },
      { approved: false, title: 'War.of.the.Worlds.2025.2160p', quality: { quality: { name: 'WEBDL-2160p', resolution: 2160 } }, rejections: ['Not enough free space'] },
    ];
    return [];
  };
  let launched = 0;
  const outcome = await executeProvenArrSearch({ queries: ['release?movieId=7'], read, launch: async () => { launched++; }, preference: '1080p' });
  assert.equal(outcome.success, false);
  assert.equal(outcome.failureCode, undefined, 'pas une absence de release : une panne');
  assert.match(outcome.message, /^Disque plein/);
  assert.equal(launched, 0);
  assert.ok(!reads.includes('health'), 'conclusion directe, sans diagnostic d’indexers');

  // Refus d'une autre nature (qualité, taille) : la règle « aucune release » reste inchangée.
  assert.equal(diskFullRejection([{ approved: false, title: 'x.1080p', quality: { quality: { name: 'WEBDL-1080p', resolution: 1080 } }, rejections: ['Size too large'] }], '1080p'), false);
  // Disque plein seulement sur une autre qualité que celle demandée : pas de conclusion disque.
  assert.equal(diskFullRejection([{ approved: false, title: 'x.2160p', quality: { quality: { name: 'WEBDL-2160p', resolution: 2160 } }, rejections: ['Not enough free space'] }], '1080p'), false);
});
