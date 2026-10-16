import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { bundleDownloadRuntime } from './helpers/downloadRuntime.ts';

let sequence = 0;
const runtimes = new Set<{ getState: () => { stopPolling: () => void } }>();
afterEach(() => { for (const store of runtimes) store.getState().stopPolling(); runtimes.clear(); });
async function fixture(storage = new Map<string, string>()) {
  const key = `__availabilityRuntime${++sequence}`;
  const state = {
    uid: 'owner', storage, remotes: [] as unknown[], history: [] as unknown[],
    queueGate: null as Promise<void> | null,
    movies: [{ id: 42, tmdbId: 11, qualityProfileId: 1, monitored: false, hasFile: false }],
    series: [{ id: 2, tvdbId: 123, monitored: false, seasons: [{ seasonNumber: 0, monitored: false }, { seasonNumber: 1, monitored: true }] }],
    episodes: [{ id: 5, seriesId: 2, seasonNumber: 0, episodeNumber: 2, monitored: false, hasFile: false },
      { id: 6, seriesId: 2, seasonNumber: 1, episodeNumber: 1, monitored: true, hasFile: false }],
    rss: true, interval: 15, refuse: false, switchOnRead: false, syncRefuse: false,
    puts: [] as Array<{ path: string; body: Record<string, unknown> }>, posts: [] as string[],
    published: [] as Array<Record<string, unknown>>, retired: [] as unknown[], queueDeletes: [] as unknown[],
    onAuth: null as ((user: unknown) => void) | null, onSnapshot: null as ((snapshot: unknown) => void) | null,
  };
  (globalThis as Record<string, unknown>)[key] = state;
  Object.assign(globalThis, { window: {}, document: { addEventListener: () => {} }, localStorage: {
    getItem: (id: string) => storage.get(id) || null, setItem: (id: string, value: string) => storage.set(id, value),
    removeItem: (id: string) => storage.delete(id)
  } });
  const port = `const s=globalThis.${key};`;
  const transport = `${port}
    export const cleanUrl=url=>url;
    export const executeGet=async url=>{
      const p=url.split('/api/v3/')[1];
      if(s.switchOnRead){s.uid='other';s.switchOnRead=false;}
      if(p==='movie')return structuredClone(s.movies);
      if(p==='series')return structuredClone(s.series);
      if(p.startsWith('episode?'))return structuredClone(s.episodes);
      if(p==='health')return [];
      if(p==='indexer')return [{enableAutomaticSearch:true,enableInteractiveSearch:true,enableRss:s.rss}];
      if(p==='config/indexer')return {rssSyncInterval:s.interval};
      if(p==='qualityprofile')return [{id:1,name:'1080p'}];
      if(p==='history')return {records:s.history};
      if(p.startsWith('release?'))return [];
      throw Error('GET inattendu '+p);
    };
    export const executePut=async(url,body)=>{
      const path=url.split('/api/v3/')[1];s.puts.push({path,body});
      if(s.refuse)throw Error('timeout');
      if(path.startsWith('movie/'))s.movies=s.movies.map(m=>m.id===body.id?body:m);
      else if(path.startsWith('series/'))s.series=s.series.map(m=>m.id===body.id?body:m);
      else if(path.startsWith('episode/'))s.episodes=s.episodes.map(m=>m.id===body.id?body:m);
      else throw Error('PUT inattendu '+path);
      return structuredClone(body);
    };
    export const executePost=async url=>{s.posts.push(url);throw Error('POST inattendu');};
    export const executeArrInteractiveGet=executeGet;export const executeArrInteractivePost=executePost;
    export const executeDelete=async()=>{throw Error('DELETE inattendu')};
    export const loginQBittorrent=async()=>({success:true});export const resolveQualityProfileId=()=>1;
    export const isLocalNetworkUrl=()=>true;`;
  const runtime = await bundleDownloadRuntime(`
    export { useLiveDownloadStore as store } from './src/store/liveDownloadStoreCore.ts';
    export { beginDownloadRequest, failDownloadRequest } from './src/features/downloads/downloadLifecycle.ts';
    export { enableArrAvailabilityWatch, cancelArrAvailabilityWatch } from './src/services/arrAvailabilityWatch.ts';
    export { searchAndDownloadInRadarr } from './src/services/sonarrRadarrSearch.ts';`, {
    firebase: `${port}export const auth={get currentUser(){return s.uid?{uid:s.uid}:null;}};export const db={};`,
    'firebase/auth': `${port}export const onAuthStateChanged=(_auth,callback)=>{s.onAuth=callback;return()=>{};};`,
    'firebase/firestore': `${port}export const collection=()=>({});export const doc=(...args)=>args;
      export const setDoc=async(_doc,value)=>{s.published.push(value)};
      export const onSnapshot=(_query,callback)=>{s.onSnapshot=callback;return()=>{};};
      export const deleteDoc=async value=>{
        s.onSnapshot?.({docs:[],docChanges:()=>[{type:'removed',doc:{id:value.at(-1)}}]});
        if(s.syncRefuse)throw Error('offline');s.retired.push(value);
      };`,
    '@capacitor/core': `export const Capacitor={isNativePlatform:()=>false};export const CapacitorHttp={};`,
    '@capacitor/app': `export const App={addListener:()=>{}};`,
    downloadConfigStore: `${port}export const useDownloadConfigStore={subscribe:()=>()=>{},getState:()=>({downloadsEnabled:true,isHydrated:true,scopeUid:s.uid,radarrUrl:'https://arr.example',radarrApiKey:'fixture',sonarrUrl:'https://arr.example',sonarrApiKey:'fixture'})};`,
    toastStore: `export const useToastStore={getState:()=>({showToast:()=>{}})};`,
    logStore: `export const appLogger={warn:()=>{},error:()=>{},info:()=>{}};`,
    showsStore: `export const useShowsStore={getState:()=>({shows:[]})};`,
    tmdb: `export const tmdb={getShowDetails:async()=>({ok:true,value:{id:11,external_ids:{tvdb_id:123}}})};`,
    apiAuth: `export const authenticatedFetch=()=>{throw Error('transport inattendu')};`,
    downloadFailureNotificationClient: `${port}export const enqueueDownloadFailureNotification=value=>{s.published.push({notification:value})};`,
    episodeSeasonPackCleanup: `export const processTrackedSeasonPackFallbacks=async()=>({cleanedFallbacks:[],removedQueueIds:[]});export const removeTrackedSeasonPack=()=>{};export const registerTrackedSeasonPack=()=>{};`,
    sonarrRadarrTransport: transport,
    sonarrRadarr: `${port}export const fetchLiveDownloadsQueue=async()=>{if(s.queueGate)await s.queueGate;return s.remotes;};
      export const getLastLiveDownloadSourceHealth=()=>({radarr:{configured:true,ok:true},sonarr:{configured:true,ok:true},qbittorrent:{configured:false,ok:false}});
      export const matchShowDownload=()=>false;export const matchMovieDownload=()=>false;
      export const deleteLiveDownloadItem=async item=>{s.queueDeletes.push(item);return {success:true}};
      export const extractQualityFromTitle=()=>undefined;export const formatCleanMediaInfo=item=>({cleanTitle:item.title,isTv:item.mediaType==='tv'});
      export const cleanUrl=url=>url;export const executeGet=async()=>({records:s.history});`
  });
  state.onAuth?.({ uid: state.uid });
  runtimes.add(runtime.store);
  runtime.store.getState().stopPolling();
  await runtime.store.getState().fetchDownloads();
  return { runtime, state };
}

const movieInput = { title: 'Film canonique', movieTitle: 'Film canonique', mediaType: 'movie', tmdbId: 11, downloadClient: 'Radarr' };
const watch = { ownerUid: 'owner', service: 'radarr', url: 'https://arr.example', apiKey: 'fixture', tmdbId: 11 };
const hash = 'a'.repeat(40);

test('SEENIT-DOWNLOAD-012 le service et le lifecycle conservent zéro release en attente surveillée sans lancer de transfert', async () => {
  const { runtime, state } = await fixture();
  const id = runtime.beginDownloadRequest(movieInput);
  runtime.store.getState().stopPolling();
  const result = await runtime.searchAndDownloadInRadarr({ ...watch, title: movieInput.title, qualityProfileId: 1 });
  assert.equal(result.failureCode, 'no_release');
  assert.equal(result.availability.automatic, true);
  runtime.failDownloadRequest(id, result.message, result.failureCode, result.availability);
  await runtime.store.getState().fetchDownloads();
  const item = runtime.store.getState().downloads[0];
  assert.equal(item.status, 'waiting');
  assert.equal(item.errorMessage, undefined);
  assert.equal(item.statusText, 'En attente de disponibilité');
  assert.equal(state.movies[0].monitored, true);
  assert.equal(state.posts.length, 0);
  assert.ok(state.published.some(value => value.status === 'waiting' && Number(value.sharedExpiresAt) > Date.now() + 86400_000));
});

test('le téléchargement futur exige RSS actif, surveillance confirmée et compte exact', async () => {
  for (const scenario of ['rss', 'interval', 'refused', 'existing-file', 'wrong-media', 'uid']) {
    const { runtime, state } = await fixture();
    if (scenario === 'rss') state.rss = false;
    if (scenario === 'interval') state.interval = 0;
    if (scenario === 'refused') state.refuse = true;
    if (scenario === 'existing-file') state.movies[0].hasFile = true;
    if (scenario === 'wrong-media') state.movies[0].tmdbId = 12;
    if (scenario === 'uid') state.switchOnRead = true;
    assert.equal((await runtime.enableArrAvailabilityWatch(watch)).automatic, false, scenario);
    assert.equal(state.posts.length, 0);
    if (scenario === 'wrong-media' || scenario === 'uid') assert.equal(state.puts.length, 0);
  }
});

test('la surveillance Sonarr respecte S00E02 puis son annulation sans toucher aux autres épisodes', async () => {
  const { runtime, state } = await fixture();
  const scope = { ...watch, service: 'sonarr', season: 0, episode: 2 };
  assert.equal((await runtime.enableArrAvailabilityWatch(scope)).automatic, true);
  assert.equal(state.series[0].monitored, true);
  assert.equal(state.episodes[0].monitored, true);
  await runtime.cancelArrAvailabilityWatch(scope);
  assert.equal(state.episodes[0].monitored, false);
  assert.equal(state.episodes[1].monitored, true);
  assert.equal(state.puts.filter(call => call.path.startsWith('episode/')).every(call => call.body.id === 5), true);
  assert.equal(state.posts.length, 0);
});

test('SEENIT-DOWNLOAD-012 l’attente survit au vrai stockage et au redémarrage au-delà des anciens TTL', async () => {
  const { runtime, state } = await fixture();
  const id = runtime.beginDownloadRequest(movieInput);
  runtime.store.getState().stopPolling();
  runtime.failDownloadRequest(id, 'Aucune release', 'no_release', { reason: 'no_release', automatic: true });
  await runtime.store.getState().fetchDownloads();
  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() + 3 * 86400_000;
    const restored = await fixture(state.storage);
    assert.equal(restored.runtime.store.getState().downloads.length, 1);
    assert.equal(restored.runtime.store.getState().downloads[0].status, 'waiting');
    assert.equal(restored.runtime.store.getState().downloads[0].requestId, id);
    assert.equal(restored.runtime.store.getState().downloads[0].availability.automatic, true);
    await restored.runtime.store.getState().fetchDownloads();
    assert.equal(restored.runtime.store.getState().downloads.length, 1);
    assert.equal(restored.state.posts.length, 0);
    restored.state.uid = 'other';
    restored.state.onAuth?.({ uid: 'other' });
    restored.runtime.store.getState().stopPolling();
    await restored.runtime.store.getState().fetchDownloads();
    assert.equal(restored.runtime.store.getState().downloads.length, 0);
  } finally { Date.now = originalNow; }
});

test('une recherche interrompue reste visible après son délai sans inventer no_release ou une surveillance', async () => {
  const { runtime } = await fixture();
  runtime.beginDownloadRequest(movieInput);
  runtime.store.getState().stopPolling();
  await runtime.store.getState().fetchDownloads();
  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() + 121_000;
    await runtime.store.getState().fetchDownloads();
    assert.equal(runtime.store.getState().downloads[0].status, 'waiting');
    assert.deepEqual(runtime.store.getState().downloads[0].availability, { reason: 'unconfirmed', automatic: false });
  } finally { Date.now = originalNow; }
});

test('une panne reste une erreur visible et persistée, sans attente automatique', async () => {
  const { runtime, state } = await fixture();
  const id = runtime.beginDownloadRequest(movieInput);
  runtime.store.getState().stopPolling();
  runtime.failDownloadRequest(id, 'HTTP 503');
  await runtime.store.getState().fetchDownloads();
  assert.equal(runtime.store.getState().downloads[0].status, 'error');
  assert.equal(runtime.store.getState().downloads[0].availability, undefined);
  const restored = await fixture(state.storage);
  assert.equal(restored.runtime.store.getState().downloads[0].status, 'error');
});

test('le snapshot partagé hydrate une attente après l’ancien TTL sans la supprimer', async () => {
  const { runtime, state } = await fixture();
  const data = { ...movieInput, id: 'shared-wait', requestId: 'shared-wait', addedAt: Date.now() - 86400_000,
    status: 'waiting', statusText: 'En attente de disponibilité', availability: { reason: 'no_release', automatic: true }, sharedExpiresAt: Date.now() - 1 };
  state.onSnapshot?.({ docs: [{ id: 'shared-wait', data: () => data }], docChanges: () => [] });
  runtime.store.getState().stopPolling();
  await runtime.store.getState().fetchDownloads();
  assert.equal(runtime.store.getState().downloads[0].status, 'waiting');
  assert.equal(state.retired.length, 0);
});

test('l’attente rejoint un transfert exact tardif, mais pas un ancien ni deux hashes ambigus', async () => {
  for (const scenario of ['exact', 'old', 'ambiguous']) {
    const { runtime, state } = await fixture();
    const id = runtime.beginDownloadRequest(movieInput);
    runtime.store.getState().stopPolling();
    runtime.failDownloadRequest(id, 'Aucune release', 'no_release');
    await runtime.store.getState().fetchDownloads();
    const item = runtime.store.getState().downloads[0];
    item.addedAt = Date.now() - 86400_000;
    state.remotes = [{ ...movieInput, id: 'radarr_99', addedAt: scenario === 'old' ? item.addedAt - 60_000 : Date.now(),
      size: 1000, sizeleft: 600, progress: 40, status: 'downloading', statusText: 'En cours', downloadId: hash }];
    if (scenario === 'ambiguous') state.remotes.push({ ...(state.remotes[0] as Record<string, unknown>), id: 'radarr_100', downloadId: 'b'.repeat(40) });
    await runtime.store.getState().fetchDownloads();
    const items = runtime.store.getState().downloads;
    assert.equal(items.some((value: { status: string }) => value.status === 'waiting'), scenario !== 'exact');
    if (scenario === 'exact') { assert.equal(items.length, 1); assert.equal(items[0].requestId, id); assert.equal(items[0].progress, 40); assert.equal(state.retired.length, 1); }
    if (scenario === 'ambiguous') assert.equal(items.length, 3);
  }
});

test('annuler l’attente arrête la surveillance exacte sans supprimer un fichier ou une queue', async () => {
  const { runtime, state } = await fixture();
  const id = runtime.beginDownloadRequest(movieInput);
  runtime.store.getState().stopPolling();
  runtime.failDownloadRequest(id, 'Aucune release', 'no_release', await runtime.enableArrAvailabilityWatch(watch));
  await runtime.store.getState().fetchDownloads();
  const waiting = runtime.store.getState().downloads[0];
  state.refuse = true;
  assert.equal(await runtime.store.getState().removeDownload(waiting), false);
  assert.equal(runtime.store.getState().downloads.length, 1);
  state.refuse = false;
  state.syncRefuse = true;
  assert.equal(await runtime.store.getState().removeDownload(waiting), false);
  assert.equal(runtime.store.getState().downloads.length, 1);
  assert.equal(runtime.store.getState().downloads[0].availability.automatic, false);
  state.syncRefuse = false;
  let releaseQueue: (() => void) | undefined;
  state.queueGate = new Promise<void>(resolve => { releaseQueue = resolve; });
  const inFlightPoll = runtime.store.getState().fetchDownloads();
  assert.equal(await runtime.store.getState().removeDownload(waiting), true);
  releaseQueue?.();
  await inFlightPoll;
  state.queueGate = null;
  assert.equal(state.movies[0].monitored, false);
  assert.equal(runtime.store.getState().downloads.length, 0);
  assert.equal(state.queueDeletes.length, 0);
  await runtime.store.getState().fetchDownloads();
  const stale = { ...waiting, sharedExpiresAt: Number.MAX_SAFE_INTEGER };
  state.onSnapshot?.({ docs: [{ id, data: () => stale }], docChanges: () => [] });
  runtime.store.getState().stopPolling();
  await runtime.store.getState().fetchDownloads();
  assert.equal(runtime.store.getState().downloads.length, 0);
});

test('un choix manuel remplace l’attente par une seule nouvelle intention', async () => {
  const { runtime } = await fixture();
  const id = runtime.beginDownloadRequest(movieInput);
  runtime.store.getState().stopPolling();
  runtime.failDownloadRequest(id, 'Aucune release', 'no_release');
  await runtime.store.getState().fetchDownloads();
  const next = runtime.beginDownloadRequest(movieInput);
  runtime.store.getState().stopPolling();
  await runtime.store.getState().fetchDownloads();
  assert.equal(next, id);
  assert.equal(runtime.store.getState().downloads.length, 1);
  assert.equal(runtime.store.getState().downloads[0].status, 'submitting');
  assert.notEqual(runtime.store.getState().downloads[0].requestId, id);
});
