import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLiveDownloadStorageKey,
  buildTrackedSeasonPackStorageKey,
  isDownloadRequestScopeCurrent
} from '../src/features/downloads/downloadUserScope.ts';

test('le stockage des téléchargements est réellement partitionné par UID', () => {
  assert.equal(buildLiveDownloadStorageKey('uid-a'), 'seenit_live_downloads_v4:uid-a');
  assert.notEqual(buildLiveDownloadStorageKey('uid-a'), buildLiveDownloadStorageKey('uid-b'));
  assert.equal(buildTrackedSeasonPackStorageKey('uid-a'), 'seenit_tracked_season_packs_v1:uid-a');
  assert.equal(buildTrackedSeasonPackStorageKey(''), 'seenit_tracked_season_packs_v1:default');
});

test('une réponse lente de A est rejetée après passage au compte B', () => {
  const requestA = { uid: 'uid-a', epoch: 4 };
  assert.equal(isDownloadRequestScopeCurrent(requestA, { uid: 'uid-a', epoch: 4 }), true);
  assert.equal(isDownloadRequestScopeCurrent(requestA, { uid: 'uid-b', epoch: 5 }), false);
  assert.equal(isDownloadRequestScopeCurrent(requestA, { uid: 'uid-a', epoch: 5 }), false);
});
