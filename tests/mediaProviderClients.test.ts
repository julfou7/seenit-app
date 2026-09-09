import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { buildProviderRequest } from '../src/features/providers/mediaProviderBackend.ts';

const require = createRequire(import.meta.url);
const { hasProviderSecret } = require('../scripts/scan-provider-client-bundle.cjs');
const json = (data: any, status = 200) => new Response(JSON.stringify(data), { status });

async function loadClient(entry: string, handler: (url: URL) => Promise<Response> | Response, native = false) {
  const calls: URL[] = [];
  const stubs: Record<string, string> = {
    apiAuth: 'export const authenticatedFetch = (...args) => globalThis.__fetch(...args);',
    utils: 'export const adjustTMDBShowDataForEurope=x=>x; export const adjustTMDBSeasonDataForEurope=x=>x;',
    '@capacitor/core': 'export const Capacitor={isNativePlatform:()=>globalThis.__native};',
    showsStore: 'export const useShowsStore={getState:()=>({shows:[{tmdbId:999,status:"completed",genres:[28]}]})};',
    favoritePeopleStore: 'export const useFavoritePeopleStore={getState:()=>({people:[{id:123}]})};',
    tmdbFacade: 'export const tmdb={};',
  };
  const output = await build({
    entryPoints: [entry], write: false, bundle: true, platform: 'node', format: 'cjs',
    plugins: [{
      name: 'isolated-provider-client',
      setup(plugin) {
        plugin.onResolve({ filter: /apiAuth$|\/utils$|@capacitor\/core$|showsStore$|favoritePeopleStore$/ }, args => ({
          path: args.path === '@capacitor/core' ? args.path : args.path.split('/').at(-1)!, namespace: 'fixture',
        }));
        if (entry.endsWith('recommendations.ts')) plugin.onResolve({ filter: /shows\/tmdb$/ }, () => ({ path: 'tmdbFacade', namespace: 'fixture' }));
        plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'js' }));
      },
    }],
  });
  const location = { origin: native ? 'https://localhost' : 'https://seenit.ai.studio', hostname: native ? 'localhost' : 'seenit.ai.studio' };
  const context = vm.createContext({
    module: { exports: {} }, require, URL, URLSearchParams, console, setTimeout, clearTimeout, AbortController,
    location, window: { location }, __native: native,
    __fetch: async (input: string) => {
      const url = new URL(input, location.origin);
      assert.equal(url.origin, 'https://seenit.ai.studio');
      assert.equal(url.searchParams.has('api_key'), false);
      assert.equal(url.searchParams.has('apikey'), false);
      assert.equal(url.pathname.startsWith('/api/media/tmdb/'), true, url.pathname);
      assert.ok(buildProviderRequest('tmdb', url.pathname.replace('/api/media/tmdb/', ''), Object.fromEntries(url.searchParams)), url.pathname);
      calls.push(url);
      return handler(url);
    },
    fetch: () => { throw new Error('Appel non authentifié inattendu dans le scénario'); },
  });
  vm.runInContext(output.outputFiles[0].text, context);
  return { exports: (context.module as any).exports, calls };
}

for (const native of [false, true]) {
  test('issue #12 conserve caches chauds, déduplication et identité typée ' + (native ? 'APK' : 'PWA'), async () => {
    const fixture = await loadClient('src/features/shows/tmdbClient.ts', async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return json({ id: 42, similar: { results: [] } });
    }, native);
    const client = new fixture.exports.TMDBClient();
    const results = await Promise.all([client.getMovieDetails(42), client.getMovieDetails(42)]);
    assert.ok(results.every((result: any) => result.ok));
    assert.equal(fixture.calls.length, 1);
    assert.equal((await client.getMovieDetails(42)).value.media_type, 'movie');
    assert.equal(fixture.calls.length, 1);
    assert.equal((await client.getShowDetails(42)).value.media_type, 'tv');
    assert.equal(fixture.calls.length, 2);
    assert.equal(client.peekMediaDetails(42, 'movie').media_type, 'movie');
    assert.equal(client.peekMediaDetails(42, 'tv').media_type, 'tv');
  });
}

test('issue #12 conserve recherche film/année, ID externe et biographie de secours', async () => {
  const fixture = await loadClient('src/features/shows/tmdbClient.ts', url => {
    if (url.pathname.includes('/search/')) return json({ results: [{ id: 11, title: 'Film Test', vote_count: 500 }] });
    if (url.pathname.includes('/find/')) return json({ tv_results: [{ id: 22 }] });
    return json({ id: 33, biography: url.searchParams.get('language') === 'en-US' ? 'Biography' : '' });
  });
  const client = new fixture.exports.TMDBClient();
  assert.equal((await client.searchMedia('Film Test', '2020', 'movie')).value.id, 11);
  assert.equal(fixture.calls[0].searchParams.get('primary_release_year'), '2020');
  assert.equal((await client.findByExternalId('tt1234567', 'imdb_id', 'tv')).value.id, 22);
  assert.equal(fixture.calls[1].pathname, '/api/media/tmdb/find/tt1234567');
  assert.equal((await client.getPersonDetails(33)).value.biography, 'Biography');
});

test('issue #12 permet de réessayer un détail après échec sans cacher une erreur', async () => {
  let attempt = 0;
  const fixture = await loadClient('src/features/shows/tmdbClient.ts', () => ++attempt === 1 ? json({}, 404) : json({ id: 42 }));
  const client = new fixture.exports.TMDBClient();
  assert.equal((await client.getMovieDetails(42)).ok, false);
  assert.equal(client.peekMediaDetails(42, 'movie'), null);
  assert.equal((await client.getMovieDetails(42)).ok, true);
  assert.equal(attempt, 2);
});

test('SEENIT-RATING-001 supprime le client et les caches OMDb', () => {
  assert.equal(
    existsSync(new URL('../src/features/shows/omdbService.ts', import.meta.url)),
    false,
    'le service OMDb ne doit plus exister dans le runtime client',
  );
});

test('issue #12 migre aussi les recommandations sans clé et conserve leurs filtres', async () => {
  const fixture = await loadClient('src/lib/recommendations.ts', () => json({ results: [] }), true);
  await fixture.exports.getRecommendations();
  assert.equal(fixture.calls.length, 6);
  assert.equal(fixture.calls[0].searchParams.get('with_genres'), '28');
  assert.equal(fixture.calls[2].searchParams.get('with_people'), '123');
  assert.equal(fixture.calls[4].searchParams.get('vote_average.gte'), '7.0');
});

test('issue #12 le scan du bundle refuse les marqueurs de fournisseurs sans exposer leur valeur', () => {
  assert.equal(hasProviderSecret('const endpoint="/api/media/tmdb/movie/42"'), false);
  assert.equal(hasProviderSecret('this.apiKey=config.apiKey; config.apiKey===other.apiKey'), false);
  for (const content of ['VITE_TMDB_API_KEY', 'https://api.themoviedb.org/3', '?apikey=canary', '?api_key=canary']) {
    assert.equal(hasProviderSecret(content), true);
  }
});
