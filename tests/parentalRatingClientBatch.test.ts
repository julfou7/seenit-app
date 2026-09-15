import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

async function loadClient() {
  const calls: URL[] = [];
  const stubs: Record<string, string> = {
    apiAuth: 'export const authenticatedFetch=(...args)=>globalThis.__fetch(...args);',
    seenitApi: `export const resolveSeenItApiUrl=(value)=>value;`,
    utils: 'export const adjustTMDBShowDataForEurope=x=>x; export const adjustTMDBSeasonDataForEurope=x=>x;',
    '@capacitor/core': 'export const Capacitor={isNativePlatform:()=>true};',
    showsStore: 'export const useShowsStore={getState:()=>({shows:[]})};',
    favoritePeopleStore: 'export const useFavoritePeopleStore={getState:()=>({people:[]})};',
  };

  const output = await build({
    entryPoints: ['src/features/shows/tmdbClient.ts'],
    write: false,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [{
      name: 'parental-batch-client',
      setup(plugin) {
        plugin.onResolve({ filter: /apiAuth$|seenitApi$|\/utils$|@capacitor\/core$|showsStore$|favoritePeopleStore$/ }, args => ({
          path: args.path === '@capacitor/core' ? args.path : args.path.split('/').at(-1)!,
          namespace: 'fixture',
        }));
        plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'js' }));
      },
    }],
  });

  const context = vm.createContext({
    module: { exports: {} },
    require,
    URL,
    URLSearchParams,
    Headers,
    Response,
    Request,
    AbortController,
    console,
    setTimeout,
    clearTimeout,
    __fetch: async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url, 'https://seenit.test');
      calls.push(url);
      if (url.pathname === '/api/media/parental-ratings') {
        const items = (url.searchParams.get('items') || '').split(',').filter(Boolean);
        return json({
          results: items.map(item => {
            const [mediaType, rawId] = item.split(':');
            const id = Number(rawId);
            return {
              key: item,
              media_type: mediaType,
              id,
              details: mediaType === 'movie'
                ? { id, media_type: mediaType, release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'PG' }] }] } }
                : { id, media_type: mediaType, content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-PG' }] } },
            };
          }),
        });
      }
      throw new Error(`appel réseau parental inattendu: ${url.pathname}`);
    },
  });
  vm.runInContext(output.outputFiles[0].text, context);
  return { exports: (context.module as any).exports, calls };
}

test('issue #326 regroupe 40 classifications Explorer en un seul appel HTTP batch', async () => {
  const fixture = await loadClient();
  const client = new fixture.exports.TMDBClient();
  const results = await Promise.all(Array.from({ length: 40 }, (_, index) => (
    client.getParentalRatingDetails(1000 + index, index % 2 === 0 ? 'movie' : 'tv')
  )));

  assert.equal(results.every((result: any) => result.ok), true);
  assert.equal(fixture.calls.length, 1, '40 classifications froides doivent traverser un seul aller-retour SeenIt');
  assert.equal(fixture.calls[0].pathname, '/api/media/parental-ratings');
  assert.equal((fixture.calls[0].searchParams.get('items') || '').split(',').length, 40);
  assert.ok(results[0].value.release_dates);
  assert.ok(results[1].value.content_ratings);

  await client.getParentalRatingDetails(1000, 'movie');
  assert.equal(fixture.calls.length, 1, 'la preuve batchée doit rester disponible dans le cache parental client');
});
