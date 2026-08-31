import assert from 'node:assert/strict';
import test from 'node:test';
import { sortDownloadsByAddedAt } from '../src/features/downloads/downloadPresentation.ts';

test('l’ordre des téléchargements actifs reste celui des demandes même si la réponse distante change d’ordre', () => {
  const supergirl = { id: 'qbit-supergirl', requestId: 'req-supergirl', addedAt: 1000 };
  const colony = { id: 'qbit-colony', requestId: 'req-colony', addedAt: 2000 };

  assert.deepEqual(
    sortDownloadsByAddedAt([colony, supergirl]).map(item => item.requestId),
    ['req-supergirl', 'req-colony']
  );
  assert.deepEqual(
    sortDownloadsByAddedAt([supergirl, colony]).map(item => item.requestId),
    ['req-supergirl', 'req-colony']
  );
});

test('deux demandes à la même milliseconde ont un départage stable par requestId', () => {
  const a = { id: 'remote-z', requestId: 'req-a', addedAt: 1000 };
  const b = { id: 'remote-a', requestId: 'req-b', addedAt: 1000 };

  assert.deepEqual(
    sortDownloadsByAddedAt([b, a]).map(item => item.requestId),
    ['req-a', 'req-b']
  );
});

test('les sections historiques peuvent être affichées du plus récent au plus ancien', () => {
  const oldItem = { id: 'old', addedAt: 1000 };
  const recentItem = { id: 'recent', addedAt: 2000 };

  assert.deepEqual(
    sortDownloadsByAddedAt([oldItem, recentItem], 'desc').map(item => item.id),
    ['recent', 'old']
  );
});
