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
      return { delivered: 1, invalid: 0 };
    },
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].notification, presentation.notification);
  assert.deepEqual(calls[0].data, presentation.data);
  assert.deepEqual(calls[0].options, {});
  assert.equal(calls[1].notification, null);
  assert.equal(calls[1].data.type, 'PLEX_AVAILABILITY_CHECK');
  assert.equal(calls[1].data.tmdbId, '438631');
  assert.equal(calls[1].data.ownerUidHash, '0123456789abcdef');
  assert.deepEqual(calls[1].options, {
    platform: 'android',
    androidHighPriority: true,
    plexAvailabilityBackground: 'required',
  });
  assert.deepEqual(result, { delivered: 2, invalidTokensRemoved: 0 });
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
      return { delivered: 1, invalid: 0 };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].notification?.title, 'Import terminé 🍿');
});
