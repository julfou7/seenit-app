import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAppUpdateAvailablePush } from '../src/features/release/releaseUpdatePushClient';

test('SEENIT-UPDATE-003 force le contrôle canonique au toucher du push Android', async () => {
  const forces: boolean[] = [];
  const checkForUpdates = async (force = false) => {
    forces.push(force);
    return true;
  };

  assert.equal(await handleAppUpdateAvailablePush({
    type: 'APP_UPDATE_AVAILABLE',
    version: '1.4.115'
  }, checkForUpdates), true);
  assert.deepEqual(forces, [true]);

  assert.equal(await handleAppUpdateAvailablePush({
    type: 'APP_UPDATE_AVAILABLE',
    version: 'https://example.test/SeenIt.apk'
  }, checkForUpdates), false);
  assert.equal(await handleAppUpdateAvailablePush({
    type: 'DOWNLOAD_EVENT',
    version: '1.4.115'
  }, checkForUpdates), false);
  assert.deepEqual(forces, [true]);
});
