import assert from 'node:assert/strict';
import test from 'node:test';
import express, { type RequestHandler } from 'express';
import {
  PARENTAL_BATCH_ITEM_BUDGET_PER_MINUTE,
  PARENTAL_BATCH_MAX_CONCURRENT,
  PARENTAL_BATCH_MAX_ITEMS,
  registerParentalRatingBatchRoute,
} from '../src/features/providers/parentalRatingBatchBackend.ts';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

async function harness(t: any) {
  let active = 0;
  let maxActive = 0;
  const calls: URL[] = [];
  const authenticate: RequestHandler = (req: any, res, next) => {
    const token = req.headers.authorization;
    if (!token?.startsWith('Bearer test-user-')) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    req.user = { uid: token.slice('Bearer test-user-'.length) };
    next();
  };
  const app = express();
  registerParentalRatingBatchRoute(app, {
    authenticate,
    secrets: () => ({ TMDB_API_KEY: 'private-tmdb-key', TVDB_API_KEY: 'private-tvdb-key' }),
    fetch: async input => {
      const url = new URL(String(input));
      calls.push(url);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await sleep(5);
      active -= 1;
      const id = Number(url.pathname.split('/').at(-2));
      return url.pathname.endsWith('/release_dates')
        ? json({ id, results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'PG' }] }] })
        : json({ id, results: [{ iso_3166_1: 'US', rating: 'TV-PG' }] });
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close(error => error ? reject(error) : resolve());
  }));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const send = (items: string, user: string | null = 'a') => fetch(
    `http://127.0.0.1:${address.port}/api/media/parental-ratings?items=${encodeURIComponent(items)}`,
    { headers: user ? { Authorization: `Bearer test-user-${user}` } : {} },
  );
  return { send, calls, maxActive: () => maxActive };
}

test('issue #326 batch parental authentifié résout 40 médias avec un fan-out serveur borné', async t => {
  const { send, calls, maxActive } = await harness(t);
  const items = [
    ...Array.from({ length: 20 }, (_, index) => `movie:${index + 1}`),
    ...Array.from({ length: 20 }, (_, index) => `tv:${index + 101}`),
  ].join(',');
  const response = await send(items);
  assert.equal(response.status, 200);
  const payload = await response.json() as any;
  assert.equal(payload.results.length, PARENTAL_BATCH_MAX_ITEMS);
  assert.equal(calls.length, PARENTAL_BATCH_MAX_ITEMS);
  assert.equal(maxActive() <= PARENTAL_BATCH_MAX_CONCURRENT, true);
  assert.equal(maxActive() > 8, true, 'le serveur doit dépasser la vieille borne client à 8 sans dépasser 24');
  assert.equal(calls.every(url => url.origin === 'https://api.themoviedb.org'), true);
  assert.equal(calls.every(url => url.searchParams.get('api_key') === 'private-tmdb-key'), true);
  assert.equal(JSON.stringify(payload).includes('private-tmdb-key'), false, 'la clé TMDB ne doit jamais revenir au client');
  assert.ok(payload.results.find((item: any) => item.key === 'movie:1')?.details?.release_dates);
  assert.ok(payload.results.find((item: any) => item.key === 'tv:101')?.details?.content_ratings);
});

test('issue #326 batch parental refuse auth absente, entrée invalide et dépassement sans appeler TMDB', async t => {
  const { send, calls } = await harness(t);
  assert.equal((await send('movie:1', null)).status, 401);
  assert.equal((await send('movie:0')).status, 400);
  assert.equal((await send('movie:1,person:2')).status, 400);
  const tooMany = Array.from({ length: PARENTAL_BATCH_MAX_ITEMS + 1 }, (_, index) => `movie:${index + 1}`).join(',');
  assert.equal((await send(tooMany)).status, 400);
  assert.equal(calls.length, 0);
});

test('issue #326 budget pondéré refuse le 241e média avec Retry-After sans appel TMDB supplémentaire', async t => {
  const { send, calls } = await harness(t);
  const fullBatches = PARENTAL_BATCH_ITEM_BUDGET_PER_MINUTE / PARENTAL_BATCH_MAX_ITEMS;
  assert.equal(Number.isInteger(fullBatches), true);

  for (let batch = 0; batch < fullBatches; batch += 1) {
    const start = batch * PARENTAL_BATCH_MAX_ITEMS + 1;
    const items = Array.from(
      { length: PARENTAL_BATCH_MAX_ITEMS },
      (_, index) => `movie:${start + index}`,
    ).join(',');
    assert.equal((await send(items, 'budget')).status, 200);
  }
  assert.equal(calls.length, PARENTAL_BATCH_ITEM_BUDGET_PER_MINUTE);

  const blocked = await send('movie:999999', 'budget');
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
  assert.equal(calls.length, PARENTAL_BATCH_ITEM_BUDGET_PER_MINUTE);
});
