import assert from 'node:assert/strict';
import test from 'node:test';
import express, { type Request, type RequestHandler } from 'express';
import { registerCharacterRoutes } from '../src/features/providers/characterBackend.ts';

test('terrain Ragnar : la route production transforme bien les crédits Vikings en Ragnar Lothbrok', async t => {
  const app = express();
  const authenticate: RequestHandler = (req, res, next) => {
    if (!req.headers.authorization) { res.status(401).end(); return; }
    (req as Request & { user: { uid: string } }).user = { uid: String(req.headers.authorization) };
    next();
  };
  registerCharacterRoutes(app, {
    authenticate,
    secrets: () => ({ TMDB_API_KEY: 'ragnar-test-key' }),
    fetch: async input => {
      const url = new URL(String(input));
      if (url.pathname !== '/3/tv/44217') throw new Error(`Unexpected provider path ${url.pathname}`);
      return new Response(JSON.stringify({
        id: 44217,
        name: 'Vikings',
        poster_path: '/vikings.jpg',
        first_air_date: '2013-03-03',
        seasons: [{ season_number: 1, episode_count: 9 }],
        aggregate_credits: {
          cast: [
            { id: 43943, name: 'Travis Fimmel', profile_path: '/travis.jpg', roles: [{ character: 'Ragnar Lothbrok', episode_count: 49 }] },
            { id: 12572, name: 'Katheryn Winnick', profile_path: '/katheryn.jpg', roles: [{ character: 'Lagertha', episode_count: 71 }] },
          ],
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const response = await fetch(`http://127.0.0.1:${address.port}/api/media/characters?ids=tv:44217&q=ragnar`, {
    headers: { Authorization: 'user-a' },
  });
  assert.equal(response.status, 200);
  const payload = await response.json() as { results: Array<{ name: string; seed: string; actors: Array<{ name: string }> }> };
  assert.equal(payload.results.length, 1);
  assert.equal(payload.results[0].name, 'Ragnar Lothbrok');
  assert.equal(payload.results[0].seed, 'tv:44217');
  assert.equal(payload.results[0].actors[0].name, 'Travis Fimmel');
});
