import assert from 'node:assert/strict';
import test from 'node:test';
import { createDownloadNotificationPosterResolver } from '../src/features/downloads/downloadNotificationPoster.ts';
import { deliverDownloadWebhookPresentation } from '../src/features/downloads/downloadWebhookDelivery.ts';
import { buildDownloadWebhookPresentation } from '../src/features/downloads/downloadWebhookNotification.ts';

test('SEENIT-NOTIFICATION-003 #801 résout une affiche exacte et coalesce le cache sans secret dans la sortie', async () => {
  const paths: string[] = [];
  let clock = 0;
  const resolve = createDownloadNotificationPosterResolver({ apiKey: () => 'secret', now: () => clock, request: async input => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.themoviedb.org');
    assert.equal(url.searchParams.get('api_key'), 'secret');
    paths.push(url.pathname);
    return Response.json({ id: Number(url.pathname.split('/').at(-1)), poster_path: '/poster.jpg' });
  } });
  const results = await Promise.all([resolve(42, 'movie'), resolve(42, 'movie')]);
  assert.deepEqual(results, ['https://image.tmdb.org/t/p/w342/poster.jpg', 'https://image.tmdb.org/t/p/w342/poster.jpg']);
  assert.equal(paths.length, 1);
  await resolve(42, 'movie');
  assert.equal(paths.length, 1);
  await resolve(42, 'tv');
  assert.deepEqual(paths, ['/3/movie/42', '/3/tv/42']);
  assert.equal(await resolve(0, 'movie'), undefined);
  assert.equal(await resolve(42, 'person'), undefined);
  clock = 86_400_001;
  await resolve(42, 'movie');
  assert.equal(paths.length, 3);
});

test('SEENIT-NOTIFICATION-003 #801 refuse les images ambiguës, URL injectées, corps trop gros et pannes', async () => {
  const responses = [Response.json({ id: 7, poster_path: '/other.jpg' }), Response.json({ id: 42, poster_path: 'https://evil.example/a.jpg' }), Response.json({ id: 42, poster_path: '/secret.jpg' }), new Response('', { status: 503 }), Response.json({ id: 42, poster_path: '/poster.jpg', extra: 'x'.repeat(70_000) })];
  for (const response of responses) {
    const resolve = createDownloadNotificationPosterResolver({ apiKey: () => 'secret', request: async () => response });
    assert.equal(await resolve(42, 'movie'), undefined);
  }
  const offline = createDownloadNotificationPosterResolver({ apiKey: () => 'secret', request: async () => { throw new Error('offline'); } });
  assert.equal(await offline(42, 'movie'), undefined);
});

test('SEENIT-NOTIFICATION-003 #801 le vrai dispatcher transmet seulement la référence image au reçu natif', async () => {
  for (const imageFails of [false, true]) {
    const presentation = buildDownloadWebhookPresentation('radarr', { eventType: 'Download', movie: { title: 'Même titre', tmdbId: 42 }, downloadId: 'exact-import' });
    const calls: Array<{ notification: unknown; data: Record<string, string> }> = [];
    await deliverDownloadWebhookPresentation({ uid: 'a', ownerUidHash: '0123456789abcdef', presentation,
      resolvePoster: async (id, mediaType) => { assert.equal(id, 42); assert.equal(mediaType, 'movie'); if (imageFails) throw new Error('offline'); return 'https://image.tmdb.org/t/p/w342/poster.jpg'; },
      sendPush: async (_uid, notification, data = {}) => { calls.push({ notification, data }); return { attempted: 1, delivered: 1, invalid: 0 }; }
    });
    assert.equal(calls.length, 3);
    assert.equal(calls[0].notification, null);
    assert.equal(calls[0].data.posterUrl, imageFails ? undefined : 'https://image.tmdb.org/t/p/w342/poster.jpg');
    assert.equal(calls[0].data.eventKey, presentation.plexAvailabilityData?.eventKey);
    assert.equal(calls[1].data.posterUrl, undefined);
    assert.equal(calls[2].data.posterUrl, undefined);
    assert.equal((calls[1].notification as { body: string }).body, 'Import Plex terminé');
    assert.doesNotMatch(JSON.stringify(calls), /Disponible dans Plex|base64|api_key|secret/);
  }
});
