import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const showsStoreSource = readFileSync(new URL('../src/store/showsStore.ts', import.meta.url), 'utf8');

test('#229 coalesce les rafales Firestore et les applique hors du chemin critique', () => {
  assert.match(showsStoreSource, /const REALTIME_SNAPSHOT_COALESCE_MS = 750/);
  assert.match(showsStoreSource, /const REALTIME_IDLE_TIMEOUT_MS = 1200/);
  assert.match(showsStoreSource, /requestIdleCallback\(callback, \{ timeout: REALTIME_IDLE_TIMEOUT_MS \}\)/);
  assert.match(showsStoreSource, /coalesceHandle = window\.setTimeout\([\s\S]*scheduleWhenIdle/);
  assert.match(showsStoreSource, /const snapshotToApply = latestSnapshot/);
  assert.match(showsStoreSource, /firestoreUnsubscribe\(\);[\s\S]*cancelScheduledWork\(\);/);
});

test('#229 conserve les références des médias inchangés et évite une réécriture identique', () => {
  assert.match(showsStoreSource, /function preserveUnchangedShowReferences\(/);
  assert.match(showsStoreSource, /getShowStateSignature\(currentShow\) === getShowStateSignature\(nextShow\)/);
  assert.match(showsStoreSource, /function applyMergedShowsState\(/);
  assert.match(showsStoreSource, /stableShows\.every\(\(show, index\) => show === currentState\.shows\[index\]\)/);
  assert.match(showsStoreSource, /if \(isSameLibrary\) \{[\s\S]*return false;/);

  const applyCalls = showsStoreSource.match(/applyMergedShowsState\(user\.uid, mergedShows\)/g) || [];
  assert.ok(
    applyCalls.length >= 2,
    'le cache Firestore et le fetch serveur doivent eux aussi éviter de remplacer toute la bibliothèque sans changement',
  );
});
