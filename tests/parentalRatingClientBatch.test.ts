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
  const batchSizes: number[] = [];
  const directParentalCalls: URL[] = [];
  const stubs: Record<string, string> = {
    firebase: `export const auth={currentUser:{getIdToken:async()=> 'test-firebase-token'}};`,
    updateStore: `export const CURRENT_APP_VERSION='1.4.152';`,
    logStore: `export const appLogger={warn:()=>{},info:()=>{}};`,
    seenitApi: `
      export const resolveSeenItApiUrl=(value)=>value.startsWith('/')?'https://seenit.test'+value:value;
      export const isSeenItApiRequest=(value)=>String(value).includes('/api/');
      export const isUnexpectedHtmlApiResponse=(value)=>String(value||'').includes('text/html');
    `,
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
        plugin.onResolve({ filter: /\/firebase$|updateStore$|logStore$|seenitApi$|\/utils$|@capacitor\/core$|showsStore$|favoritePeopleStore$/ }, args => ({
          path: args.path === '@capacitor/core' ? args.path : args.path.split('/').at(-1)!,
          namespace: 'fixture',
        }));
        plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'js' }));
      },
    }],
  });

  const fetchImpl = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url, 'https://seenit.test');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('authorization'), 'Bearer test-firebase-token');
    if (url.pathname === '/api/media/parental-ratings') {
      const items = (url.searchParams.get('items') || '').split(',').filter(Boolean);
      batchSizes.push(items.length);
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
    if (/\/api\/media\/tmdb\/(movie|tv)\/\d+\/(release_dates|content_ratings)$/.test(url.pathname)) {
      directParentalCalls.push(url);
      throw new Error(`appel parental unitaire inattendu: ${url.pathname}`);
    }
    return json({ id: 1 });
  };

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
    fetch: fetchImpl,
    location: { origin: 'https://localhost', hostname: 'localhost' },
    window: { location: { origin: 'https://localhost', hostname: 'localhost' } },
  });
  vm.runInContext(output.outputFiles[0].text, context);
  return { exports: (context.module as any).exports, batchSizes, directParentalCalls };
}

test('issue #326 regroupe les 40 classifications APK en cinq appels batch au lieu de 40 HTTP', async () => {
  const fixture = await loadClient();
  const client = new fixture.exports.TMDBClient();
  const results = await Promise.all(Array.from({ length: 40 }, (_, index) => (
    client.getParentalRatingDetails(1000 + index, index % 2 === 0 ? 'movie' : 'tv')
  )));

  assert.equal(results.every((result: any) => result.ok), true);
  assert.deepEqual(fixture.batchSizes, [8, 8, 8, 8, 8],
    'la borne client historique à 8 devient cinq batchs réseau et non quarante requêtes authentifiées');
  assert.equal(fixture.directParentalCalls.length, 0,
    'aucun endpoint parental TMDB unitaire ne doit traverser le réseau depuis le client');
  assert.ok(results[0].value.release_dates);
  assert.ok(results[1].value.content_ratings);
});
