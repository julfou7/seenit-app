import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findPlexAvailabilityOnServers,
  getPlexServers,
  type PlexServerResource,
} from '../src/backend/plexAvailabilityBackend.ts';

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

test('SEENIT-PLEX-002 accélère la disponibilité par un identifiant IMDb exact sans inventaire', async () => {
  const calls: string[] = [];
  const request: typeof fetch = async input => {
    const url = String(input);
    calls.push(url);
    if (decodeURIComponent(url).includes('imdb://tt0133093')) {
      return json({ MediaContainer: { Metadata: [{
        type: 'movie',
        title: 'Film exact',
        ratingKey: 'matrix',
        Guid: [{ id: 'imdb://tt0133093' }]
      }] } });
    }
    if (fastMiss(url)) return json({ MediaContainer: { Metadata: [] } });
    throw new Error('le chemin rapide ne doit pas atteindre l’inventaire');
  };

  const result = await findPlexAvailabilityOnServers({
    servers: [sharedServer()],
    accountToken: 'account-token',
    tmdbId: 603,
    imdbId: 'tt0133093',
    mediaType: 'movie',
    request,
    fastTimeoutMs: 50,
    inventoryTimeoutMs: 50,
    inventoryBudgetMs: 500
  });

  assert.equal(result?.ratingKey, 'matrix');
  assert.equal(calls.some(url => url.endsWith('/library/sections')), false);
  assert.equal(calls.some(url => url.includes('/library/sections/')), false);
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

test('SEENIT-IDENTITY-001 refuse un résultat rapide dont les identifiants externes exacts diffèrent', async () => {
  const request: typeof fetch = async input => {
    const url = String(input);
    if (fastMiss(url)) {
      return json({ MediaContainer: { Metadata: [{
        type: 'movie',
        title: 'Même titre',
        year: 1999,
        ratingKey: 'wrong',
        Guid: [{ id: 'imdb://tt9999999' }, { id: 'tmdb://999' }]
      }] } });
    }
    if (url.endsWith('/library/sections')) return json({ MediaContainer: { Directory: [] } });
    return json({ MediaContainer: { Metadata: [] } });
  };

  const result = await findPlexAvailabilityOnServers({
    servers: [sharedServer()],
    accountToken: 'account-token',
    tmdbId: 603,
    imdbId: 'tt0133093',
    mediaType: 'movie',
    request,
    fastTimeoutMs: 20,
    inventoryTimeoutMs: 20,
    inventoryBudgetMs: 100
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

test('SEENIT-PLEX-002 une connexion lente ne bloque plus une connexion PMS exacte disponible', async () => {
  const server = sharedServer('https://slow.example.test');
  server.connections = [
    { uri: 'https://slow.example.test', local: false, relay: false },
    { uri: 'https://fast.example.test', local: false, relay: true }
  ];

  const request: typeof fetch = async input => {
    const url = String(input);
    if (url.startsWith('https://slow.example.test')) {
      await new Promise(resolve => setTimeout(resolve, 500));
      return json({ MediaContainer: { Metadata: [] } });
    }
    if (url.startsWith('https://fast.example.test') && fastMiss(url)) {
      return json({ MediaContainer: { Metadata: [{
        type: 'movie',
        ratingKey: 'fast-603',
        Guid: [{ id: 'tmdb://603' }]
      }] } });
    }
    return json({ MediaContainer: { Metadata: [] } });
  };

  const startedAt = Date.now();
  const result = await findPlexAvailabilityOnServers({
    servers: [server],
    accountToken: 'account-token',
    tmdbId: 603,
    mediaType: 'movie',
    request,
    fastTimeoutMs: 800,
    inventoryTimeoutMs: 50,
    inventoryBudgetMs: 100
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result?.ratingKey, 'fast-603');
  assert.ok(elapsedMs < 300, `la connexion valide doit gagner sans attendre 500 ms (reçu ${elapsedMs} ms)`);
});

test('SEENIT-PLEX-002 force la redécouverte des serveurs sans affaiblir le cache normal', async () => {
  const resourceCalls: string[] = [];
  let generation = 0;
  const request: typeof fetch = async input => {
    const url = String(input);
    resourceCalls.push(url);
    generation += 1;
    return json([{
      name: `Serveur ${generation}`,
      clientIdentifier: `server-${generation}`,
      provides: 'server',
      connections: [{ uri: `https://server-${generation}.example.test`, local: false }]
    }]);
  };
  let now = 10_000;
  const clock = () => now;
  const token = 'refresh-test-token';
  const uid = 'refresh-test-user';

  const first = await getPlexServers(request, token, 'client', uid, clock);
  now += 1000;
  const cached = await getPlexServers(request, token, 'client', uid, clock);
  now += 1000;
  const refreshed = await getPlexServers(request, token, 'client', uid, clock, true);

  assert.equal(resourceCalls.length, 2, 'le chemin normal réutilise le cache mais le refresh explicite refait resources');
  assert.equal(first?.[0].clientIdentifier, 'server-1');
  assert.equal(cached?.[0].clientIdentifier, 'server-1');
  assert.equal(refreshed?.[0].clientIdentifier, 'server-2');
});
