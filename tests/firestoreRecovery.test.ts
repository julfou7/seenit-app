import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIRESTORE_RECOVERY_WINDOW_MS,
  buildFirestoreIndexedDbName,
  decideFirestoreRecovery,
  isFirestoreIndexedDbCorruption,
  selectCurrentFirestoreDatabaseNames,
  type FirestoreRecoveryState
} from '../src/lib/firestoreRecovery.ts';

const config = {
  projectId: 'gen-lang-client-0201895414',
  databaseId: 'default'
};

test('SEENIT-DATA-004 sélectionne uniquement la base Firestore exacte du projet courant', () => {
  const expected = 'firestore/[DEFAULT]/gen-lang-client-0201895414.default/main';
  assert.equal(buildFirestoreIndexedDbName(config.projectId, config.databaseId), expected);
  assert.deepEqual(
    selectCurrentFirestoreDatabaseNames([
      { name: expected },
      { name: 'firestore/[DEFAULT]/gen-lang-client-0201895414/main' },
      { name: 'firestore/[DEFAULT]/gen-lang-client-0201895414.archive/main' },
      { name: 'firestore/[DEFAULT]/un-autre-projet.default/main' },
      { name: 'firebaseLocalStorageDb' },
      { name: 'seenit-cache' }
    ], config),
    [expected]
  );
  assert.equal(
    buildFirestoreIndexedDbName('gen-lang-client-0201895414', '(default)'),
    'firestore/[DEFAULT]/gen-lang-client-0201895414/main'
  );
});

test('SEENIT-DATA-004 partage une seule tentative entre onglets et casse la boucle de rechargement', () => {
  const now = 1_800_000_000_000;
  assert.equal(decideFirestoreRecovery(null, now, config), 'attempt');

  const preparing: FirestoreRecoveryState = {
    version: 1,
    ...config,
    attemptId: 'onglet-a',
    startedAt: now,
    phase: 'prepare'
  };
  assert.equal(decideFirestoreRecovery(preparing, now + 100, config), 'follow');

  const completed: FirestoreRecoveryState = { ...preparing, phase: 'reload' };
  assert.equal(decideFirestoreRecovery(completed, now + 500, config), 'stop');

  const failed: FirestoreRecoveryState = { ...preparing, phase: 'failed' };
  assert.equal(decideFirestoreRecovery(failed, now + 500, config), 'stop');

  assert.equal(
    decideFirestoreRecovery(completed, now + FIRESTORE_RECOVERY_WINDOW_MS + 1, config),
    'attempt'
  );
  assert.equal(
    decideFirestoreRecovery(completed, now + 500, { ...config, projectId: 'autre-projet' }),
    'attempt'
  );
});

test('SEENIT-DATA-004 limite la réparation aux assertions internes Firestore', () => {
  assert.equal(
    isFirestoreIndexedDbCorruption(new Error('INTERNAL ASSERTION FAILED: Unexpected state')),
    true
  );
  assert.equal(isFirestoreIndexedDbCorruption('INTERNAL ASSERTION FAILED'), true);
  assert.equal(isFirestoreIndexedDbCorruption(new Error('Failed to fetch')), false);
  assert.equal(isFirestoreIndexedDbCorruption(null), false);
});
