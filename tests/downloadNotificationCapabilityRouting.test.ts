import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  notificationCapabilitiesForPlatform,
  PLEX_AVAILABILITY_BACKGROUND_V1,
  supportsPlexAvailabilityBackgroundV1
} from '../src/features/notifications/notificationCapabilities.ts';

test('SEENIT-NOTIFICATION-003 n’annonce la capability Android qu’après confirmation native', () => {
  assert.deepEqual(notificationCapabilitiesForPlatform('android'), []);
  assert.deepEqual(notificationCapabilitiesForPlatform('android', false), []);
  assert.deepEqual(
    notificationCapabilitiesForPlatform('android', true),
    [PLEX_AVAILABILITY_BACKGROUND_V1]
  );
  assert.deepEqual(notificationCapabilitiesForPlatform('web', true), []);
  assert.equal(supportsPlexAvailabilityBackgroundV1('android', [PLEX_AVAILABILITY_BACKGROUND_V1]), true);
  assert.equal(supportsPlexAvailabilityBackgroundV1('android', undefined), false);
  assert.equal(supportsPlexAvailabilityBackgroundV1('android', []), false);
  assert.equal(supportsPlexAvailabilityBackgroundV1('web', [PLEX_AVAILABILITY_BACKGROUND_V1]), false);
});

test('SEENIT-NOTIFICATION-003 garde une notification visible pour les APK legacy', () => {
  const server = readFileSync('server.ts', 'utf8');
  const client = readFileSync('src/lib/firebase.ts', 'utf8');

  assert.ok(client.includes('await syncNativePlexBackgroundCredentials(auth.currentUser.uid)'));
  assert.ok(client.includes("notificationCapabilitiesForPlatform('android', plexAvailabilityBackgroundReady)"));
  assert.ok(server.includes('deliverDownloadWebhookPresentation({'));
  assert.ok(server.includes('sendPush: sendPushToUserDevices'));
  assert.ok(server.includes("device.get('plexAvailabilityBackgroundV1') === true"));
  assert.ok(server.includes('plexAvailabilityBackgroundV1,'));
});
