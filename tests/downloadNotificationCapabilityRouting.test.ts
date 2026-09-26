import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  notificationCapabilitiesForPlatform,
  PLEX_AVAILABILITY_BACKGROUND_V1,
  supportsPlexAvailabilityBackgroundV1
} from '../src/features/notifications/notificationCapabilities.ts';

test('SEENIT-NOTIFICATION-003 annonce explicitement la capability Android et la révoque par défaut', () => {
  assert.deepEqual(notificationCapabilitiesForPlatform('android'), [PLEX_AVAILABILITY_BACKGROUND_V1]);
  assert.deepEqual(notificationCapabilitiesForPlatform('web'), []);
  assert.equal(supportsPlexAvailabilityBackgroundV1('android', [PLEX_AVAILABILITY_BACKGROUND_V1]), true);
  assert.equal(supportsPlexAvailabilityBackgroundV1('android', undefined), false);
  assert.equal(supportsPlexAvailabilityBackgroundV1('android', []), false);
  assert.equal(supportsPlexAvailabilityBackgroundV1('web', [PLEX_AVAILABILITY_BACKGROUND_V1]), false);
});

test('SEENIT-NOTIFICATION-003 garde une notification visible pour les APK legacy', () => {
  const server = readFileSync('server.ts', 'utf8');
  const client = readFileSync('src/lib/firebase.ts', 'utf8');

  assert.ok(client.includes('capabilities: notificationCapabilitiesForPlatform(platform)'));
  assert.ok(server.includes("plexAvailabilityBackground?: 'required' | 'legacy'"));
  assert.ok(server.includes("plexAvailabilityBackground: 'required'"));
  assert.ok(server.includes("plexAvailabilityBackground: 'legacy'"));
  assert.ok(server.includes("device.get('plexAvailabilityBackgroundV1') === true"));
  assert.ok(server.includes('plexAvailabilityBackgroundV1,'));
  assert.ok(server.includes('androidLegacyDelivery'));
  assert.ok(server.includes('presentation.notification, presentation.data'));
});
