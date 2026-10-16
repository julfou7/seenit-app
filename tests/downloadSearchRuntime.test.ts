import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Seuls les transports/configurations sont remplacés ; les services et le fallback
// de production sont exécutés avec leurs branches réelles.
const bundle = await build({
  stdin: { contents: `export { searchAndDownloadInSonarr, searchAndDownloadInRadarr } from './src/services/sonarrRadarrSearch.ts'; export { downloadEpisodeWithSeasonPackFallback } from './src/features/downloads/episodeSeasonPackFallback.ts';`, resolveDir: fileURLToPath(new URL('..', import.meta.url)) },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'download-fixture-ports', setup(builder) {
    builder.onResolve({ filter: /(?:^|\/)(?:sonarrRadarrTransport|apiAuth|firebase|tmdb|sonarrRadarr|episodeSeasonPackCleanup)$/ }, args => ({ path: args.path.split('/').at(-1) || '', namespace: 'fixture' }));
    builder.onResolve({ filter: /^@capacitor\/core$/ }, () => ({ path: 'capacitor', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => {
      if (args.path === 'tmdb') return { contents: `export const tmdb={getShowDetails:async()=>({ok:true,value:{id:11,external_ids:{tvdb_id:123}}})};` };
      if (args.path === 'firebase') return { contents: `export const auth={currentUser:null};` };
      if (args.path === 'apiAuth') return { contents: `export const authenticatedFetch=()=>{throw new Error('transport inattendu')};` };
      if (args.path === 'capacitor') return { contents: `export const Capacitor={isNativePlatform:()=>false};export const CapacitorHttp={};` };
      if (args.path === 'episodeSeasonPackCleanup') return { contents: `export const registerTrackedSeasonPack=()=>{};` };
      return { contents: `const ports=()=>globalThis.__seenitDownloadFixture;
        export const cleanUrl=url=>url.endsWith('/')?url.slice(0,-1):url;
        export const executeGet=(...args)=>ports().get(...args);
        export const executeArrInteractiveGet=executeGet;
        export const executePost=(...args)=>ports().post(...args);
        export const executeArrInteractivePost=executePost;
        export const executePut=async()=>({});export const executeDelete=async()=>({});
        export const loginQBittorrent=async()=>({success:true});
        export const resolveQualityProfileId=()=>1;export const isLocalNetworkUrl=()=>true;
        export const searchAndDownloadInSonarr=(...args)=>ports().searchSonarr(...args);` };
    });
  } }]
});
const runtime = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function fixture(extra: (path: string) => unknown = () => undefined) {
  const calls: string[] = [];
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const episode = { id: 2, seasonNumber: 1, episodeNumber: 1, monitored: true, hasFile: false, airDateUtc: '2020-01-01' };
  const ports = {
    get: async (url: string) => {
      const path = url.split('/api/v3/')[1]; calls.push(path);
      const value = extra(path);
      if (value instanceof Error) throw value;
      if (value !== undefined) return value;
      if (path === 'series') return [{ id: 1, title: 'Titre Sonarr', tvdbId: 123, qualityProfileId: 1 }];
      if (path.startsWith('episode?')) return [episode];
      if (path === 'movie') return [{ id: 3, title: 'Titre Radarr', tmdbId: 11, qualityProfileId: 1, hasFile: false }];
      if (path === 'indexer') return [{ enableAutomaticSearch: true, enableInteractiveSearch: true }];
      return [];
    },
    post: async (url: string, body: Record<string, unknown>) => { posts.push({ path: url.split('/api/v3/')[1], body }); return { id: 3 }; },
    searchSonarr: runtime.searchAndDownloadInSonarr
  };
  (globalThis as Record<string, unknown>).__seenitDownloadFixture = ports;
  return { calls, posts };
}

const params = { url: 'https://arr.example', apiKey: 'fixture', title: 'Titre SeenIt', tmdbId: 11, qualityProfileId: 1, qualityPreference: '1080p' };

test('les services réels distinguent zéro release, panne et lancement confirmé pour film/saison/série', async () => {
  for (const run of [() => runtime.searchAndDownloadInRadarr(params), () => runtime.searchAndDownloadInSonarr({ ...params, season: 1 }), () => runtime.searchAndDownloadInSonarr(params)]) {
    const empty = fixture();
    assert.equal((await run()).failureCode, 'no_release');
    assert.equal(empty.posts.length, 0);
    const failed = fixture(path => path.startsWith('release?') ? new Error('HTTP 503') : undefined);
    assert.equal((await run()).failureCode, undefined);
    assert.equal(failed.posts.length, 0);
    const successful = fixture(path => path.startsWith('release?') ? [{ approved: true, quality: { quality: { resolution: 1080 } } }] : undefined);
    assert.equal((await run()).success, true);
    assert.equal(successful.posts.at(-1)?.path, 'command');
  }
});

test('un nouveau film est ajouté sans recherche concurrente avant la preuve zéro release', async () => {
  const state = fixture(path => path === 'movie' ? [] : path.startsWith('movie/lookup?') ? [{ tmdbId: 11, title: 'Titre Radarr' }] : path === 'rootfolder' ? [{ path: '/media', accessible: true }] : undefined);
  const result = await runtime.searchAndDownloadInRadarr(params);
  assert.equal(result.failureCode, 'no_release');
  assert.equal(state.posts.length, 1);
  assert.deepEqual(state.posts[0].body.addOptions, { searchForMovie: false });
});

test('le fallback réel attend le pack et refuse les réponses invalides ou les pannes', async () => {
  const empty = fixture();
  const result = await runtime.downloadEpisodeWithSeasonPackFallback({ ...params, season: 1, episode: 1 });
  assert.equal(result.failureCode, 'no_release');
  assert.deepEqual(empty.calls.filter(path => path.startsWith('release?')), ['release?episodeId=2', 'release?seriesId=1&seasonNumber=1']);
  for (const failed of [new Error('timeout pack'), '<html>']) {
    fixture(path => path.includes('seasonNumber=1') ? failed : undefined);
    assert.equal((await runtime.downloadEpisodeWithSeasonPackFallback({ ...params, season: 1, episode: 1 })).failureCode, undefined);
  }
});
