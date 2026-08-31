import assert from 'node:assert/strict';
import test from 'node:test';
import {
  downloadSecretMatches,
  hashDownloadSecret,
  isAllowedServiceProxyPath,
  isInvalidFcmTokenError,
  selectUserNotificationDevices
} from '../src/features/downloads/downloadBackendSecurity.ts';

test('un webhook personnel accepte uniquement son secret exact', () => {
  const secret = 'secret-personnel-compte-a';
  const digest = hashDownloadSecret(secret);
  assert.equal(downloadSecretMatches(digest, secret), true);
  assert.equal(downloadSecretMatches(digest, 'secret-personnel-compte-b'), false);
});

test('un événement du compte A ne cible que les appareils de A', () => {
  const devices = selectUserNotificationDevices('uid-a', [
    { ownerUid: 'uid-a', token: 'token-pwa-aaaaaaaaaaaaaaaaaaaa', platform: 'web' },
    { ownerUid: 'uid-a', token: 'token-apk-aaaaaaaaaaaaaaaaaaaa', platform: 'android' },
    { ownerUid: 'uid-b', token: 'token-apk-bbbbbbbbbbbbbbbbbbbb', platform: 'android' }
  ]);
  assert.deepEqual(devices.map(device => device.platform).sort(), ['android', 'web']);
  assert.equal(devices.some(device => device.ownerUid === 'uid-b'), false);
});

test('les tokens invalides sont identifiés sans bloquer les appareils valides', () => {
  assert.equal(isInvalidFcmTokenError('messaging/registration-token-not-registered'), true);
  assert.equal(isInvalidFcmTokenError('messaging/invalid-registration-token'), true);
  assert.equal(isInvalidFcmTokenError('messaging/internal-error'), false);
});

test('le proxy n’accepte que les chemins Sonarr Radarr et qBittorrent nécessaires', () => {
  assert.equal(isAllowedServiceProxyPath('https://sonarr.example/api/v3/queue?page=1', 'GET'), true);
  assert.equal(isAllowedServiceProxyPath('https://radarr.example/api/v3/release/push', 'POST'), true);
  assert.equal(isAllowedServiceProxyPath('https://qbit.example/api/v2/torrents/delete', 'POST'), true);
  assert.equal(isAllowedServiceProxyPath('https://example.org/admin/export', 'GET'), false);
  assert.equal(isAllowedServiceProxyPath('https://example.org/api/v3/queue', 'PATCH'), false);
});
