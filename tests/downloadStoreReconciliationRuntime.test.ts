import assert from 'node:assert/strict';
import test from 'node:test';
import { bundleDownloadRuntime } from './helpers/downloadRuntime.ts';

const state = { remotes: [] as unknown[], history: [] as unknown[], retired: [] as unknown[], scope: 0,
  onAuth: null as ((user: unknown) => void) | null, onSnapshot: null as ((snapshot: unknown) => void) | null };
(globalThis as Record<string, unknown>).__downloadStoreFixture = state;
Object.assign(globalThis, { window: {}, document: { addEventListener: () => {} },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
const runtime = await bundleDownloadRuntime(`export { useLiveDownloadStore } from './src/store/liveDownloadStoreCore.ts';`, {
  firebase: `export const auth={currentUser:{uid:'fixture'}};export const db={};`,
  'firebase/auth': `export const onAuthStateChanged=(_auth,callback)=>{globalThis.__downloadStoreFixture.onAuth=callback;return()=>{};};`,
  'firebase/firestore': `export const collection=()=>({});export const doc=(...args)=>args;
    export const setDoc=async()=>{};export const onSnapshot=(_query,callback)=>{globalThis.__downloadStoreFixture.onSnapshot=callback;return()=>{};};
    export const deleteDoc=async value=>{globalThis.__downloadStoreFixture.retired.push(value)};`,
  '@capacitor/core': `export const Capacitor={isNativePlatform:()=>false};`,
  '@capacitor/app': `export const App={addListener:()=>{}};`,
  downloadConfigStore: `export const useDownloadConfigStore={getState:()=>({radarrUrl:'https://arr'+globalThis.__downloadStoreFixture.scope+'.example',radarrApiKey:'fixture'})};`,
  toastStore: `export const useToastStore={getState:()=>({showToast:()=>{}})};`,
  logStore: `export const appLogger={warn:()=>{},error:()=>{},info:()=>{}};`,
  arrAvailabilityWatch: `export const cancelArrAvailabilityWatch=async()=>{};`,
  showsStore: `export const useShowsStore={getState:()=>({shows:[]})};`,
  episodeSeasonPackCleanup: `export const processTrackedSeasonPackFallbacks=async()=>({cleanedFallbacks:[],removedQueueIds:[]});export const removeTrackedSeasonPack=()=>{};`,
  sonarrRadarr: `export const fetchLiveDownloadsQueue=async()=>globalThis.__downloadStoreFixture.remotes;
    export const getLastLiveDownloadSourceHealth=()=>({radarr:{configured:true,ok:true},sonarr:{configured:false,ok:false},qbittorrent:{configured:false,ok:false}});
    export const matchShowDownload=()=>false;export const matchMovieDownload=()=>false;
    export const deleteLiveDownloadItem=async()=>true;export const extractQualityFromTitle=(raw,fallback)=>fallback||raw;
    export const formatCleanMediaInfo=item=>({cleanTitle:item.title,isTv:item.mediaType==='tv'});
    export const cleanUrl=url=>url;export const executeGet=async()=>({records:globalThis.__downloadStoreFixture.history});`
});
const store = runtime.useLiveDownloadStore;
const hash = 'a'.repeat(40);
function fixture(otherHash = hash) {
  const now = Date.now();
  state.scope += 1;
  state.retired.length = 0;
  state.remotes = [{ id: 'radarr_42', mediaType: 'movie', tmdbId: 11, movieTitle: 'Canonique', title: 'Fournisseur',
    downloadId: hash, quality: '1080p WEB-DL', releaseTitle: 'Exact.MULTI.VFQ.1080p', size: 6100, sizeleft: 0,
    progress: 100, status: 'completed', statusText: 'Terminé', addedAt: now - 55_000 }];
  state.history = [{ eventType: 'downloadFolderImported', movie: { tmdbId: 11 }, downloadId: otherHash,
    date: new Date(now - 1_000).toISOString(), sourceTitle: 'Exact.MULTI.VFQ.1080p', quality: { quality: { name: 'WEBDL-1080p' } } }];
  store.setState({ downloads: [{ id: 'opt_4k', requestId: 'request-4k', mediaType: 'movie', tmdbId: 11, title: 'Canonique',
    movieTitle: 'Canonique', releaseTitle: 'Canonique • 4K', size: 0, sizeleft: 0, progress: 0, status: 'searching',
    statusText: 'Recherche en cours', isOptimistic: true, addedAt: now - 60_000 }], removedIds: [], lastUpdated: null });
}
test('SEENIT-DOWNLOAD-010 le poll réunit intention 4K et import 1080p uniquement par le hash prouvé', async () => {
  fixture();
  await store.getState().fetchDownloads();
  const items = store.getState().downloads;
  assert.equal(items.length, 1);
  assert.equal(items[0].status, 'completed');
  assert.equal(items[0].downloadId, hash);
  assert.equal(items[0].releaseTitle, 'Exact.MULTI.VFQ.1080p');
  assert.equal(items[0].isOptimistic, false);
  assert.equal(state.retired.length, 1);
  await store.getState().fetchDownloads();
  assert.equal(store.getState().downloads.length, 1);
});
test('un second appui conserve le requestId, le hash et la progression du transfert actif', () => {
  store.setState({ downloads: [{ id: 'radarr_active', requestId: 'stable', mediaType: 'movie', tmdbId: 11,
    title: 'Canonique', downloadId: hash, size: 6100, sizeleft: 3000, progress: 51, status: 'downloading',
    statusText: 'En cours', isOptimistic: false }], isPolling: true });
  // Le poll est suspendu pour isoler le callback de soumission réel.
  const fetchDownloads = store.getState().fetchDownloads;
  store.setState({ fetchDownloads: async () => {} });
  const id = store.getState().addOptimisticDownload({ title: 'Canonique', mediaType: 'movie', tmdbId: 11 });
  assert.equal(id, 'radarr_active');
  assert.equal(store.getState().downloads[0].requestId, 'stable');
  assert.equal(store.getState().downloads[0].downloadId, hash);
  assert.equal(store.getState().downloads[0].progress, 51);
  assert.equal(Boolean(store.getState().downloads[0].isOptimistic), false);
  store.setState({ fetchDownloads, isPolling: false });
});
test('le poll conserve deux transferts dont les hash sont différents', async () => {
  fixture('b'.repeat(40));
  await store.getState().fetchDownloads();
  assert.equal(store.getState().downloads.length, 2);
  assert.deepEqual(new Set(store.getState().downloads.map(item => item.downloadId)), new Set([hash, 'b'.repeat(40)]));
});
test('un ancien import ne termine pas une demande plus récente', async () => {
  fixture();
  state.history[0] = { ...(state.history[0] as Record<string, unknown>), date: new Date(Date.now() - 120_000).toISOString() };
  await store.getState().fetchDownloads();
  assert.equal(store.getState().downloads.length, 2);
  assert.equal(store.getState().downloads.find(item => item.id === 'opt_4k').status, 'searching');
});
test('une demande partagée conserve le hash choisi à l’hydratation et rejoint le transfert exact', async () => {
  state.scope += 1; state.remotes = []; state.history = []; state.retired = [];
  state.onAuth?.({ uid: 'fixture' }); store.getState().stopPolling();
  await store.getState().fetchDownloads();
  const now = Date.now();
  const data = { id: 'shared-choice', requestId: 'shared-choice', title: 'Canonique', mediaType: 'movie', tmdbId: 11,
    releaseTitle: 'Choix.MULTI.VFF.1080p', downloadId: hash, status: 'queued', addedAt: now - 10_000, sharedExpiresAt: now + 60_000 };
  state.onSnapshot?.({ docs: [{ id: 'shared-choice', data: () => data }], docChanges: () => [] });
  store.getState().stopPolling();
  assert.equal(store.getState().downloads[0].downloadId, hash);
  await store.getState().fetchDownloads();
  state.remotes = [{ ...data, id: 'radarr_final', status: 'completed', progress: 100, size: 7000, sizeleft: 0 }];
  await store.getState().fetchDownloads();
  assert.equal(store.getState().downloads.length, 1);
  assert.equal(Boolean(store.getState().downloads[0].isOptimistic), false);
  assert.equal(store.getState().downloads[0].downloadId, hash);
});
