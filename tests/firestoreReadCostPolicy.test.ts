import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(path, 'utf8');

test('SEENIT-COST-001 évite les refetch complets redondants quand le listener temps réel est actif', () => {
  const app = read('src/App.tsx');
  const showsStore = read('src/store/showsStore.ts');
  const syncWorker = read('src/hooks/useDetailsSyncWorker.ts');

  const authStart = showsStore.indexOf('auth.onAuthStateChanged(user => {');
  assert.ok(authStart >= 0);
  const authBlock = showsStore.slice(authStart);
  assert.match(authBlock, /setupRealtimeShowsListener\(user\.uid\)/);
  assert.doesNotMatch(authBlock, /void useShowsStore\.getState\(\)\.fetchShows\(\)/);

  const focusBlock = app.match(/const handleVisibilityOrFocus = \(\) => \{([\s\S]*?)\n    \};/)?.[0] || '';
  assert.match(focusBlock, /checkUrlParams\(\)/);
  assert.doesNotMatch(focusBlock, /fetchShows/);

  assert.doesNotMatch(syncWorker, /useShowsStore\.getState\(\)\.fetchShows\(\)/);
  assert.match(syncWorker, /updateShowOptimistic\(showId, movieUpdatePayload\)/);
});

test('SEENIT-COST-001 n’effectue pas de getDoc avant le listener downloadConfig', () => {
  const downloadConfig = read('src/store/downloadConfigStore.ts');
  const authStart = downloadConfig.indexOf('onAuthStateChanged(auth, user => {');
  assert.ok(authStart >= 0);
  const authBlock = downloadConfig.slice(authStart);
  const listenerIndex = authBlock.indexOf('onSnapshot(');
  assert.ok(listenerIndex >= 0);
  assert.doesNotMatch(authBlock.slice(0, listenerIndex), /syncFromCloud\(\)/);
});
