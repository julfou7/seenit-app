import assert from 'node:assert/strict';
import test from 'node:test';
import { bundleDownloadRuntime } from './helpers/downloadRuntime.ts';

const state = { uid: 'fixture', get: async (_url: string): Promise<unknown> => [],
  post: async (_url: string, _body: unknown): Promise<unknown> => ({}) };
(globalThis as Record<string, unknown>).__manualArrFixture = state;
const runtime = await bundleDownloadRuntime(`export * from './src/services/arrManualReleases.ts';`, {
  firebase: `export const auth={get currentUser(){return {uid:globalThis.__manualArrFixture.uid}}};`,
  tmdb: `export const tmdb={getShowDetails:async id=>({ok:true,value:{id,external_ids:{tvdb_id:123}}})};`,
  sonarrRadarrTransport: `export const cleanUrl=url=>url.endsWith('/')?url.slice(0,-1):url;
    export const executeGet=(url)=>globalThis.__manualArrFixture.get(url);
    export const executeArrInteractiveGet=executeGet;
    export const executeArrInteractivePost=(url,body)=>globalThis.__manualArrFixture.post(url,body);`
});
const config = { radarrUrl: 'https://arr.example', radarrApiKey: 'fixture', sonarrUrl: 'https://sonarr.example', sonarrApiKey: 'fixture' };
const scope = { mediaType: 'movie', tmdbId: 11 };
function fixture() {
  state.uid = 'fixture';
  const gets: string[] = [];
  const posts: unknown[] = [];
  const releases = [
    { guid: 'vfq', indexerId: 2, title: 'Exact.MULTI.VFQ.1080p', approved: true, size: 4000, seeders: 99 },
    { guid: 'vff', indexerId: 2, title: 'Exact.MULTI.VFF.1080p', approved: false, rejections: ['Existing file is of equal quality'], size: 5000, seeders: 9 },
    { guid: 'blocked', indexerId: 2, title: 'Other.VFF.1080p', mappedMovieId: 99, mappedSeriesId: 99, approved: true },
    { guid: 'unknown', indexerId: 2, title: 'Exact.MULTI.1080p', approved: true }
  ];
  state.get = async url => {
    gets.push(url);
    if (url.endsWith('/movie')) return [{ id: 3, tmdbId: 11, title: 'Titre fournisseur différent' }];
    if (url.endsWith('/series')) return [{ id: 4, tvdbId: 123, title: 'Titre Sonarr' }];
    if (url.includes('/episode?')) return [{ id: 5, seriesId: 4, seasonNumber: 0, episodeNumber: 2 }];
    return releases;
  };
  state.post = async (_url, body) => { posts.push(body); return {}; };
  return { gets, posts, releases };
}

test('SEENIT-DOWNLOAD-011 consulte le film exact sans aucune mutation', async () => {
  const f = fixture();
  const session = await runtime.searchManualArrReleases(scope, config);
  assert.equal(f.posts.length, 0);
  assert.deepEqual(f.gets.map(url => url.split('/api/v3/')[1]), ['movie', 'release?movieId=3']);
  assert.equal(session.candidates[0].audio.label, 'MULTI VFF');
  assert.equal(session.candidates.find(c => c.title.startsWith('Other')).selectable, false);
  assert.equal(session.candidates.find(c => c.title === 'Exact.MULTI.1080p').audio.vff, false);
});

test('un choix exact produit un seul POST même lors de double appui ou timeout', async () => {
  for (const fails of [false, true]) {
    const f = fixture();
    const session = await runtime.searchManualArrReleases(scope, config);
    if (fails) state.post = async (_url, body) => { f.posts.push(body); throw new Error('timeout après envoi'); };
    const selected = session.candidates.find(c => c.title === 'Exact.MULTI.VFF.1080p');
    const calls = [runtime.grabManualArrRelease(session, selected.key, 'request'), runtime.grabManualArrRelease(session, selected.key, 'request')];
    const results = await Promise.allSettled(calls);
    assert.equal(f.posts.length, 1);
    assert.deepEqual(f.posts[0], { guid: 'vff', indexerId: 2, movieId: 3 });
    assert.equal(results[0].status, fails ? 'rejected' : 'fulfilled');
    await Promise.allSettled([runtime.grabManualArrRelease(session, session.candidates.at(-1).key, 'retry')]);
    assert.equal(f.posts.length, 1);
  }
});

test('un compte modifié ou une identité inconnue ne lance aucun candidat', async () => {
  const f = fixture();
  const session = await runtime.searchManualArrReleases(scope, config);
  await assert.rejects(runtime.grabManualArrRelease(session, 'inconnu', 'request'));
  state.uid = 'autre';
  assert.throws(() => runtime.grabManualArrRelease(session, session.candidates[0].key, 'request'));
  assert.equal(f.posts.length, 0);
  fixture(); state.get = async () => [{ id: 8, tmdbId: 99 }];
  await assert.rejects(runtime.searchManualArrReleases(scope, config), /identifié/);
});

test('Sonarr conserve le scope épisode spécial exact et refuse une série entière sans saison', async () => {
  const f = fixture();
  const session = await runtime.searchManualArrReleases({ mediaType: 'tv', tmdbId: 11, seasonNumber: 0, episodeNumber: 2 }, config);
  assert.ok(f.gets.at(-1).endsWith('release?episodeId=5'));
  await runtime.grabManualArrRelease(session, session.candidates[0].key, 'tv-request');
  assert.deepEqual(f.posts[0], { guid: 'vff', indexerId: 2, seriesId: 4, episodeId: 5 });
  await assert.rejects(runtime.searchManualArrReleases({ mediaType: 'tv', tmdbId: 11 }, config), /saison/);
});
