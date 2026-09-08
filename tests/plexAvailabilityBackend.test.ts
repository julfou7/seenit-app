import assert from 'node:assert/strict';
import test from 'node:test';
import { findPlexAvailabilityOnServers, type PlexServerResource } from '../src/backend/plexAvailabilityBackend.ts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

const sharedServer = (uri = 'https://shared.example.test'): PlexServerResource => ({
  name: 'Plex Ami',
  clientIdentifier: 'friend-server-id',
  accessToken: 'friend-server-token',
  provides: 'server',
  connections: [{ uri, local: false, relay: false }]
});

function fastMiss(url: string): boolean {
  return url.includes('/library/all?guid=') || url.includes('/hubs/search?query=');
}

test('SEENIT-PLEX-002 détecte un film partagé via inventaire quand les lookups GUID rapides ratent', async () => {
  const calls: Array<{ url: string; token: string }> = [];
  const request: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, token: String(new Headers(init?.headers).get('X-Plex-Token') || '') });
    if (fastMiss(url)) return json({ MediaContainer: { Metadata: [] } });
    if (url.endsWith('/library/sections')) {
      return json({ MediaContainer: { Directory: [{ key: '7', type: 'movie', title: 'Films' }] } });
    }
    if (url.includes('/library/sections/7/all')) {
      return json({
        MediaContainer: {
          totalSize: 2,
          Metadata: [
            { type: 'movie', title: 'Homonyme', ratingKey: '1', Guid: [{ id: 'tmdb://999' }] },
            { type: 'movie', title: 'Film exact', ratingKey: '42', Guid: [{ id: 'tmdb://603' }] }
          ]
        }
      });
    }
    throw new Error('URL inattendue: ' + url);
  };

  const result = await findPlexAvailabilityOnServers({
    servers: [sharedServer()],
    accountToken: 'account-token',
    tmdbId: 603,
    mediaType: 'movie',
    request,
    fastTimeoutMs: 50,
    inventoryTimeoutMs: 50,
    inventoryBudgetMs: 500
  });

  assert.equal(result?.available, true);
  assert.equal(result?.serverName, 'Plex Ami');
  assert.equal(result?.ratingKey, '42');
  assert.equal(result?.plexUrl, 'https://app.plex.tv/desktop/#!/server/friend-server-id/details?key=%2Flibrary%2Fmetadata%2F42');
  assert.ok(calls.some(call => call.url.includes('/library/sections/7/all')));
  assert.ok(calls.every(call => call.token === 'friend-server-token'), 'le jeton propre au serveur partagé doit être utilisé');
});

test('SEENIT-IDENTITY-001 refuse un homonyme Plex dont le TMDB diffère', async () => {
  const request: typeof fetch = async input => {
    const url = String(input);
    if (fastMiss(url)) return json({ MediaContainer: { Metadata: [] } });
    if (url.endsWith('/library/sections')) {
      return json({ MediaContainer: { Directory: [{ key: '1', type: 'movie' }] } });
    }
    return json({
      MediaContainer: {
        totalSize: 1,
        Metadata: [{ type: 'movie', title: 'Même titre', year: 2024, ratingKey: '9', Guid: [{ id: 'tmdb://999' }] }]
      }
    });
  };

  const result = await findPlexAvailabilityOnServers({
    servers: [sharedServer()],
    accountToken: 'account-token',
    tmdbId: 603,
    mediaType: 'movie',
    request,
    fastTimeoutMs: 50,
    inventoryTimeoutMs: 50,
    inventoryBudgetMs: 500
  });

  assert.equal(result, null);
});

test('le fallback inventaire s’arrête au premier TMDB exact sans scanner les sections suivantes', async () => {
  const calls: string[] = [];
  const request: typeof fetch = async input => {
    const url = String(input);
    calls.push(url);
    if (fastMiss(url)) return json({ MediaContainer: { Metadata: [] } });
    if (url.endsWith('/library/sections')) {
      return json({ MediaContainer: { Directory: [
        { key: 'first', type: 'movie' },
        { key: 'second', type: 'movie' }
      ] } });
    }
    if (url.includes('/library/sections/first/all')) {
      return json({ MediaContainer: { totalSize: 1, Metadata: [
        { type: 'movie', ratingKey: '603', Guid: [{ id: 'tmdb://603' }] }
      ] } });
    }
    if (url.includes('/library/sections/second/all')) {
      throw new Error('la seconde section ne doit pas être consultée');
    }
    throw new Error('URL inattendue: ' + url);
  };

  const result = await findPlexAvailabilityOnServers({
    servers: [sharedServer()],
    accountToken: 'account-token',
    tmdbId: 603,
    mediaType: 'movie',
    request,
    fastTimeoutMs: 50,
    inventoryTimeoutMs: 50,
    inventoryBudgetMs: 500
  });

  assert.equal(result?.ratingKey, '603');
  assert.equal(calls.some(url => url.includes('/library/sections/second/all')), false);
});

test('un serveur Plex inaccessible ne masque pas un match exact sur un autre serveur', async () => {
  const broken = sharedServer('https://offline.example.test');
  broken.name = 'Hors ligne';
  broken.clientIdentifier = 'offline-id';
  const working = sharedServer('https://working.example.test');

  const request: typeof fetch = async input => {
    const url = String(input);
    if (url.startsWith('https://offline.example.test')) throw new Error('offline');
    if (url.startsWith('https://working.example.test') && fastMiss(url)) {
      return json({ MediaContainer: { Metadata: [] } });
    }
    if (url === 'https://working.example.test/library/sections') {
      return json({ MediaContainer: { Directory: [{ key: 'movies', type: 'movie' }] } });
    }
    if (url.includes('https://working.example.test/library/sections/movies/all')) {
      return json({ MediaContainer: { totalSize: 1, Metadata: [
        { type: 'movie', title: 'Exact', ratingKey: '77', Guid: [{ id: 'tmdb://603' }] }
      ] } });
    }
    return json({ MediaContainer: { Metadata: [] } });
  };

  const result = await findPlexAvailabilityOnServers({
    servers: [broken, working],
    accountToken: 'account-token',
    tmdbId: 603,
    mediaType: 'movie',
    request,
    fastTimeoutMs: 30,
    inventoryTimeoutMs: 30,
    inventoryBudgetMs: 300
  });

  assert.equal(result?.serverName, 'Plex Ami');
  assert.equal(result?.ratingKey, '77');
});
