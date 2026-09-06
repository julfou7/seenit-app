import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consumeAppUpdateAvailablePush,
  handleAppUpdateAvailablePush,
  queueAppUpdateAvailablePush
} from '../src/features/release/releaseUpdatePushClient.ts';

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


test('SEENIT-UPDATE-003 conserve le clic Android reçu avant le montage de MainApp', () => {
  consumeAppUpdateAvailablePush();
  assert.equal(queueAppUpdateAvailablePush({ type: 'DOWNLOAD_EVENT', version: '1.4.115' }), false);
  assert.equal(queueAppUpdateAvailablePush({ type: 'APP_UPDATE_AVAILABLE', version: ' 1.4.115 ' }), true);
  assert.deepEqual(consumeAppUpdateAvailablePush(), {
    type: 'APP_UPDATE_AVAILABLE',
    version: '1.4.115'
  });
  assert.equal(consumeAppUpdateAvailablePush(), null);
});

test('SEENIT-UPDATE-004 ouvre l’accueil et la modale seulement pour une mise à jour réelle', async () => {
  let opened = 0;
  const payload = { type: 'APP_UPDATE_AVAILABLE', version: '1.4.118' };

  assert.equal(await handleAppUpdateAvailablePush(payload, async () => false, () => { opened += 1; }), true);
  assert.equal(opened, 0);

  assert.equal(await handleAppUpdateAvailablePush(payload, async force => force === true, () => { opened += 1; }), true);
  assert.equal(opened, 1);

  assert.equal(await handleAppUpdateAvailablePush({ type: 'DOWNLOAD_EVENT', version: '1.4.118' }, async () => true, () => { opened += 1; }), false);
  assert.equal(opened, 1);
});
