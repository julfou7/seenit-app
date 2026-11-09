import assert from 'node:assert/strict';
import test from 'node:test';
import { createDownloadNotificationMediaResolver, createDownloadNotificationPosterResolver } from '../src/features/downloads/downloadNotificationPoster.ts';
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

test('SEENIT-DOWNLOAD-022 notifications de téléchargement : titre de la fiche TMDB fr-FR par identité exacte, repli Sonarr/Radarr', async () => {
  // Retour terrain du 09/11 : « The House with a Clock in Its Walls · Import Plex terminé » au lieu de « La Prophétie de l'Horloge ».
  const calls: string[] = [];
  const resolve = createDownloadNotificationMediaResolver({ apiKey: () => 'secret', request: async input => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    assert.equal(url.searchParams.get('language'), 'fr-FR');
    const id = Number(url.pathname.split('/').at(-1));
    if (id === 463821) return Response.json({ id, title: 'La Prophétie de l’Horloge', original_title: 'The House with a Clock in Its Walls', poster_path: '/horloge.jpg' });
    if (id === 77) return Response.json({ id, name: 'L’Arène\n', poster_path: '/arene.jpg' });
    if (id === 5) return Response.json({ id: 6, title: 'Autre fiche' });
    return Response.json({ id, title: 'fuite secret' });
  } });
  assert.deepEqual(await resolve(463821, 'movie'), { posterUrl: 'https://image.tmdb.org/t/p/w342/horloge.jpg', title: 'La Prophétie de l’Horloge' });
  assert.deepEqual(await resolve(77, 'tv'), { posterUrl: 'https://image.tmdb.org/t/p/w342/arene.jpg', title: 'L’Arène' }, 'titre de série (name), sans caractère de contrôle');
  assert.deepEqual(await resolve(5, 'movie'), {}, 'autre identité : ni titre ni affiche');
  assert.deepEqual(await resolve(9, 'movie'), {}, 'jamais un texte qui contient la clé');
  await resolve(463821, 'movie');
  assert.equal(calls.filter(path => path === '/3/movie/463821').length, 1, 'une seule lecture : affiche et titre partagent le cache');

  const media = { posterUrl: 'https://image.tmdb.org/t/p/w342/horloge.jpg', title: 'La Prophétie de l’Horloge' };
  for (const fails of [false, true]) {
    const presentation = buildDownloadWebhookPresentation('radarr', { eventType: 'Download', movie: { title: 'The House with a Clock in Its Walls', tmdbId: 463821 }, downloadId: 'clock' });
    const sent: Array<{ notification: { title: string; body: string } | null; data: Record<string, string> }> = [];
    await deliverDownloadWebhookPresentation({ uid: 'a', ownerUidHash: '0123456789abcdef', presentation,
      resolveMedia: async (id, mediaType) => { assert.deepEqual([id, mediaType], [463821, 'movie']); if (fails) throw new Error('offline'); return media; },
      sendPush: async (_uid, notification, data = {}) => { sent.push({ notification, data }); return { attempted: 1, delivered: 1, invalid: 0 }; } });
    const expected = fails ? 'The House with a Clock in Its Walls' : 'La Prophétie de l’Horloge';
    assert.equal(sent[0].data.title, expected, 'reçu natif « Import Plex terminé »');
    assert.equal(sent[0].data.posterUrl, fails ? undefined : media.posterUrl);
    assert.deepEqual(sent.slice(1).map(call => [call.notification?.title, call.data.title]), [[expected, expected], [expected, expected]], 'APK ancienne et PWA');
    assert.equal(sent[1].notification?.body, 'Import Plex terminé');
  }
  // Envoi au client (Grab) : même titre français.
  const grab = buildDownloadWebhookPresentation('sonarr', { eventType: 'Grab', series: { title: 'The Arena (2026)', tmdbId: 77 }, episodes: [{ seasonNumber: 1, episodeNumber: 3 }] });
  const grabs: Array<string | undefined> = [];
  await deliverDownloadWebhookPresentation({ uid: 'a', ownerUidHash: '0123456789abcdef', presentation: grab, resolveMedia: async () => ({ title: 'L’Arène' }),
    sendPush: async (_uid, notification) => { grabs.push(notification?.title); return { attempted: 1, delivered: 1, invalid: 0 }; } });
  assert.deepEqual(grabs, ['L’Arène']);
});
