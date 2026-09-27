import assert from 'node:assert/strict';
import test from 'node:test';
import { deliverDownloadWebhookPresentation } from '../src/features/downloads/downloadWebhookDelivery.ts';
import { buildDownloadWebhookPresentation } from '../src/features/downloads/downloadWebhookNotification.ts';

test('SEENIT-NOTIFICATION-003 garde l’import visible et ajoute la vérification Plex capable', async () => {
  const presentation = buildDownloadWebhookPresentation('radarr', {
    eventType: 'Download',
    downloadId: 'terrain-199',
    movie: { title: 'Terrain Movie', tmdbId: 438631 },
  });
  const calls: Array<{
    uid: string;
    notification: { title: string; body: string } | null;
    data: Record<string, string>;
    options: unknown;
  }> = [];

  const result = await deliverDownloadWebhookPresentation({
    uid: 'owner-a',
    ownerUidHash: '0123456789abcdef',
    presentation,
    sendPush: async (uid, notification, data = {}, options = {}) => {
      calls.push({ uid, notification, data, options });
      return { attempted: 1, delivered: 1, invalid: 0 };
    },
  });

  assert.equal(calls.length, 3);
  assert.equal(calls[0].notification, null);
  assert.equal(calls[0].data.type, 'PLEX_AVAILABILITY_CHECK');
  assert.equal(calls[0].data.tmdbId, '438631');
  assert.equal(calls[0].data.ownerUidHash, '0123456789abcdef');
  assert.deepEqual(calls[0].options, {
    platform: 'android',
    androidHighPriority: true,
    plexAvailabilityBackground: 'required',
  });
  assert.deepEqual(calls[1].notification, presentation.notification);
  assert.deepEqual(calls[1].data, presentation.data);
  assert.deepEqual(calls[1].options, {
    platform: 'android',
    plexAvailabilityBackground: 'legacy',
  });
  assert.deepEqual(calls[2].notification, presentation.notification);
  assert.deepEqual(calls[2].data, presentation.data);
  assert.deepEqual(calls[2].options, { platform: 'web' });

  assert.deepEqual(result, {
    delivered: 3,
    invalidTokensRemoved: 0,
    plexCheckAttempted: 1,
    plexCheckDelivered: 1,
    plexCheckFailed: 0,
  });
});

test('SEENIT-NOTIFICATION-003 propage un traceId uniquement au contrôle Plex', async () => {
  const presentation = buildDownloadWebhookPresentation('sonarr', {
    eventType: 'Download',
    downloadId: 'trace-episode',
    series: { title: 'Trace', tmdbId: 123 },
    episodes: [{ seasonNumber: 1, episodeNumber: 2 }],
  });
  const calls: Array<{ notification: unknown; data: Record<string, string> }> = [];
  await deliverDownloadWebhookPresentation({
    uid: 'owner-a',
    ownerUidHash: '0123456789abcdef',
    presentation,
    traceId: '00000000-0000-4000-8000-000000000430',
    sendPush: async (_uid, notification, data = {}) => {
      calls.push({ notification, data });
      return { attempted: 1, delivered: 1, invalid: 0 };
    },
  });

  assert.equal(calls.length, 3);
  assert.equal(calls[0].data.traceId, '00000000-0000-4000-8000-000000000430');
  assert.equal(calls[0].data.type, 'PLEX_AVAILABILITY_CHECK');
  assert.equal(calls[1].data.traceId, undefined);
  assert.equal(calls[2].data.traceId, undefined);
});

test('SEENIT-NOTIFICATION-003 garde le reçu visible quand aucune identité Plex exacte n’existe', async () => {
  const presentation = buildDownloadWebhookPresentation('radarr', {
    eventType: 'Download',
    movie: { title: 'Sans TMDB' },
  });
  const calls: Array<{ notification: { title: string; body: string } | null }> = [];

  await deliverDownloadWebhookPresentation({
    uid: 'owner-a',
    ownerUidHash: '0123456789abcdef',
    presentation,
    sendPush: async (_uid, notification) => {
      calls.push({ notification });
      return { attempted: 1, delivered: 1, invalid: 0 };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].notification?.title, 'Sans TMDB');
  assert.equal(calls[0].notification?.body, 'Import terminé');
});
