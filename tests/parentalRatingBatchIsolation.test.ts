import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { registerParentalRatingBatchRoute } from '../src/features/providers/parentalRatingBatchBackend.ts';

const backendSource = readFileSync('src/features/providers/mediaProviderBackend.ts', 'utf8').replace(/\r\n/g, '\n');
const json = (data: unknown) => new Response(JSON.stringify(data), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

test('issue #326 branche le batch progressif sur le fetch brut, sans warmup Explorer caché', () => {
  assert.match(
    backendSource,
    /registerParentalRatingBatchRoute\(app, \{\s*\.\.\.dependencies,[\s\S]*?fetch: upstream,\s*\}\);/,
    'la route /api/media/parental-ratings doit exécuter uniquement les items explicitement demandés',
  );
  assert.match(
    backendSource,
    /registerCoreMediaProviderRoutes\(app, \{\s*\.\.\.dependencies,\s*fetch: acceleratedFetch,\s*\}\);/,
    'le warmup historique peut rester confiné au chemin core/legacy',
  );

  const batchBlock = backendSource.slice(
    backendSource.indexOf('registerParentalRatingBatchRoute(app'),
    backendSource.indexOf('registerCoreMediaProviderRoutes(app'),
  );
  assert.doesNotMatch(
    batchBlock,
    /fetch: acceleratedFetch/,
    'un préfixe progressif de 1 média ne doit jamais redevenir un fan-out Explorer côté serveur',
  );
});

test('issue #326 un batch explicite de 1 média provoque exactement 1 classification TMDB', async () => {
  const calls: URL[] = [];
  const upstream: typeof fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    calls.push(url);
    return json({
      id: 7,
      results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'PG' }] }],
    });
  }) as typeof fetch;

  let route: ((req: any, res: any) => Promise<void>) | null = null;
  const app: any = {};
  app.get = (path: string, ...handlers: any[]) => {
    if (path === '/api/media/parental-ratings') route = handlers.at(-1);
    return app;
  };

  registerParentalRatingBatchRoute(app, {
    authenticate: ((_req: any, _res: any, next: () => void) => next()) as any,
    fetch: upstream,
    secrets: () => ({ TMDB_API_KEY: 'test-private-key' }),
  });
  assert.ok(route, 'la vraie route batch doit être enregistrée');

  let body: any;
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(value: any) {
      body = value;
      return this;
    },
  };

  const handler = route as (req: any, res: any) => Promise<void>;
  await handler({ user: { uid: 'field-regression-user' }, query: { items: 'movie:7' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1, 'aucun ID Explorer non demandé ne doit être classifié en arrière-plan');
  assert.equal(calls[0].pathname, '/3/movie/7/release_dates');
  assert.deepEqual(body?.results?.map((item: any) => item.key), ['movie:7']);
});
