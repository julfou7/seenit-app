import assert from 'node:assert/strict';
import test from 'node:test';
import { bundleDownloadRuntime } from './helpers/downloadRuntime.ts';

const state = { get: async (_url: string): Promise<unknown> => [], post: async (_url: string, _body: unknown): Promise<unknown> => ({}) };
(globalThis as Record<string, unknown>).__arrLaunchFixture = state;
const runtime = await bundleDownloadRuntime(`export { searchAndDownloadInRadarr, pushReleaseDirectly } from './src/services/sonarrRadarrSearch.ts';`, {
  firebase: `export const auth={currentUser:{uid:'fixture'}};`,
  tmdb: `export const tmdb={getShowDetails:async()=>({ok:false})};`,
  apiAuth: `export const authenticatedFetch=()=>{throw new Error('port inattendu')};`,
  '@capacitor/core': `export const Capacitor={isNativePlatform:()=>false};export const CapacitorHttp={};`,
  sonarrRadarrTransport: `export const cleanUrl=url=>url;
    export const executeGet=url=>globalThis.__arrLaunchFixture.get(url);
    export const executeArrInteractiveGet=executeGet;
    export const executePost=(url,body)=>globalThis.__arrLaunchFixture.post(url,body);
    export const executeArrInteractivePost=executePost;export const executePut=async()=>({});
    export const loginQBittorrent=async()=>({success:true});export const resolveQualityProfileId=()=>1;`
});
test('deux appuis simultanés sur le film lancent une seule commande Radarr', async () => {
  const posts: unknown[] = [];
  state.get = async url => url.endsWith('/movie') ? [{ id: 3, tmdbId: 11, hasFile: false, qualityProfileId: 1 }]
    : [{ approved: true, title: 'Exact.2160p', quality: { quality: { resolution: 2160 } } }];
  state.post = async (_url, body) => { posts.push(body); return {}; };
  const params = { url: 'https://arr-one.example', apiKey: 'fixture', title: 'Canonique', tmdbId: 11, qualityProfileId: 1 };
  const result = await Promise.all([runtime.searchAndDownloadInRadarr({ ...params, qualityPreference: '4k' }),
    runtime.searchAndDownloadInRadarr({ ...params, qualityPreference: '1080p' })]);
  assert.ok(result.every(r => r.success));
  assert.deepEqual(posts, [{ name: 'MoviesSearch', movieIds: [3] }]);
});
test('un grab Radarr ambigu ne lance jamais la release suivante', async () => {
  const posts: unknown[] = [];
  state.get = async url => url.endsWith('/movie')
    ? [{ id: 3, tmdbId: 11, hasFile: true, qualityProfileId: 1 }]
    : [{ title: 'Release.A.1080p', approved: true }, { title: 'Release.B.1080p', approved: true }];
  state.post = async (_url, body) => { posts.push(body); throw new Error('timeout après grab'); };
  const result = await runtime.searchAndDownloadInRadarr({ url: 'https://arr-two.example', apiKey: 'fixture', title: 'Canonique',
    tmdbId: 11, qualityProfileId: 1, qualityPreference: '1080p' });
  assert.equal(result.success, false);
  assert.equal(posts.length, 1);
});
test('C411 depuis la fiche ajoute le film sans recherche automatique puis pousse seulement la release choisie', async () => {
  for (const variant of ['success', 'wrong-movie', 'timeout', 'rejected']) {
    const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
    state.get = async url => {
      const path = url.split('/api/v3/')[1];
      if (path === 'movie') return [];
      if (path.startsWith('movie/lookup')) return [{ title: 'Canonique Radarr', tmdbId: 11 }];
      if (path === 'rootfolder') return [{ path: '/movies', accessible: true }];
      if (path === 'qualityprofile') return [{ id: 1, name: 'HD' }];
      if (path.startsWith('parse?')) return { movie: { id: 3, tmdbId: variant === 'wrong-movie' ? 99 : 11 } };
      return [];
    };
    state.post = async (url, value) => {
      const body = value as Record<string, unknown>; const path = url.split('/api/v3/')[1]; posts.push({ path, body });
      if (path === 'movie') return { id: 3, tmdbId: 11 };
      if (variant === 'timeout') throw new Error('timeout après push');
      return variant === 'rejected' ? [{ approved: false, rejections: ['Unknown movie'] }] : [{ approved: true, mappedMovieId: 3 }];
    };
    const payload = { service: 'radarr', url: `https://c411-${variant}.example`, apiKey: 'fixture',
      mediaType: 'movie', mediaInfo: { title: 'Canonique SeenIt', tmdbId: 11 },
      torrent: { name: 'Choix.MULTI.VFF.1080p', magnetUri: `magnet:?xt=urn:btih:${'a'.repeat(40)}` } };
    const [result] = await Promise.all([runtime.pushReleaseDirectly(payload), runtime.pushReleaseDirectly(payload)]);
    assert.deepEqual(posts[0].body.addOptions, { searchForMovie: false });
    assert.equal(posts.filter(post => post.path === 'command').length, 0);
    assert.equal(posts.filter(post => post.path === 'release/push').length, variant === 'wrong-movie' ? 0 : 1);
    assert.equal(result.success, variant === 'success');
    if (variant === 'success') assert.equal(posts[1].body.title, 'Choix.MULTI.VFF.1080p');
  }
});
