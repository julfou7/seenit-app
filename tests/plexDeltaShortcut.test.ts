import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isPlexWatchlistAlreadyTracked, isUnchangedPlexDelta, plexWatchlistFingerprint } from '../src/features/plex/plexDeltaShortcut.ts';

const show = (tmdbId: number, type = 'show') => ({ type, title: `Titre ${tmdbId}`, Guid: [{ id: `tmdb://${tmdbId}` }] });
const shows = [{ tmdbId: 1, mediaType: 'tv' }, { tmdbId: 2, mediaType: 'movie' }, { tmdbId: 3 }];
const watchlist = [show(1), show(2, 'movie'), show(3)];

test('SEENIT-PLEX-011 une delta sans nouveauté s’arrête après Plex, sans relire la bibliothèque', () => {
  const fingerprint = plexWatchlistFingerprint(watchlist);
  assert.equal(fingerprint, plexWatchlistFingerprint([...watchlist].reverse()), 'l’ordre de la Watchlist ne change pas l’empreinte');
  assert.notEqual(fingerprint, plexWatchlistFingerprint(watchlist.slice(0, 2)), 'un retrait change l’empreinte');
  assert.notEqual(fingerprint, plexWatchlistFingerprint([...watchlist.slice(0, 2), show(4)]), 'un remplacement change l’empreinte');

  const base = { delta: true, history: [], libraryWatchStates: [], watchlist, watchlistComplete: true, collectionComplete: true, previousFingerprint: fingerprint, shows, resolutionCache: {} };
  assert.equal(isUnchangedPlexDelta(base), true, 'Watchlist identique, rien de neuf : raccourci');
  assert.equal(isUnchangedPlexDelta({ ...base, delta: false }), false, 'une synchro complète retraite toujours tout');
  assert.equal(isUnchangedPlexDelta({ ...base, history: [{}] }), false, 'un visionnage depuis la dernière delta est traité');
  assert.equal(isUnchangedPlexDelta({ ...base, libraryWatchStates: [{}] }), false, 'un état de bibliothèque est traité');
  assert.equal(isUnchangedPlexDelta({ ...base, watchlistComplete: false }), false, 'Watchlist partielle : pas de décision');
  assert.equal(isUnchangedPlexDelta({ ...base, collectionComplete: false }), false, 'collecte incomplète : pas de décision');
  assert.equal(isUnchangedPlexDelta({ ...base, previousFingerprint: undefined }), false, 'première delta : traitement complet');
  assert.equal(isUnchangedPlexDelta({ ...base, watchlist: [...watchlist, show(5)] }), false, 'un ajout Watchlist est traité');
  assert.equal(isUnchangedPlexDelta({ ...base, shows: shows.slice(0, 2) }), false, 'un titre Watchlist sans fiche est réimporté par le traitement complet');
});

test('SEENIT-PLEX-011 un titre Watchlist sans TMDB direct est reconnu par le cache de résolution', () => {
  const plexOnly = { type: 'show', Guid: [{ id: 'plex://show/abc' }] };
  assert.equal(isPlexWatchlistAlreadyTracked([plexOnly], shows, {}), false, 'identité inconnue : traitement complet');
  assert.equal(isPlexWatchlistAlreadyTracked([plexOnly], shows, { 'tv:plex:abc': { id: 3 } }), true);
  assert.equal(isPlexWatchlistAlreadyTracked([show(2)], shows, {}), false, 'une série ne correspond pas au film de même identifiant');
});

test('SEENIT-PLEX-011 l’empreinte n’est enregistrée qu’après une synchro entièrement validée', () => {
  const engine = readFileSync('src/features/plex/plexSyncEngine.ts', 'utf8');
  const commit = engine.slice(engine.indexOf('if (canCommitCursor) {'));
  assert.match(commit.slice(0, 600), /watchlistFingerprint: plexWatchlistFingerprint\(watchlist\)/, 'empreinte écrite avec le curseur validé');
  assert.ok(engine.indexOf('const unchangedDelta = isUnchangedPlexDelta(') < engine.indexOf('fetchAuthoritativeShowsForUser(user.uid)'), 'le raccourci précède la relecture Firestore');
  const cloud = readFileSync('src/features/plex/plexCloudState.ts', 'utf8');
  assert.match(cloud, /next\.watchlistFingerprint = values\.watchlistFingerprint/);
});

test('SEENIT-PLEX-011 le backend lance Watchlist, activité cloud et serveurs ensemble', () => {
  const server = readFileSync('server.ts', 'utf8');
  const serversStart = server.indexOf('const serversTask = getPlexServers(');
  const watchlistStart = server.indexOf('const watchlistTask = (async () => {');
  const cloudStart = server.indexOf('const cloudTask = (async () => {');
  const joined = server.indexOf('await Promise.all([watchlistTask, cloudTask]);');
  assert.ok(serversStart > 0 && serversStart < watchlistStart && watchlistStart < cloudStart && cloudStart < joined, 'les trois appels partent avant la première attente');
  assert.ok(joined < server.indexOf('const servers = await serversTask;'), 'les serveurs sont attendus après la Watchlist et le cloud');
  assert.match(server, /serversTask\.catch\(\(\) => undefined\)/, 'aucun rejet orphelin si la découverte échoue pendant l’attente');
  assert.match(server, /visitedSources\.unshift\(watchlistVisited\)/, 'la Watchlist reste la première source listée');
});

test('SEENIT-PLEX-011 #843 le raccourci ne lit que la bibliothèque confirmée par le serveur Firestore', async () => {
  const { build } = await import('esbuild');
  const vm = await import('node:vm');
  const { createRequire } = await import('node:module');
  const bundle = await build({ stdin: { contents: "export * from './src/store/showsStore.ts'; export { getServerConfirmedLibrary } from './src/features/shows/serverConfirmedLibrary.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', external: ['zustand'],
    plugins: [{ name: 'shows-listener-ports', setup(builder) {
      builder.onResolve({ filter: /^@capacitor\/(?:app|core)$|^firebase\/firestore$|\/(?:firebase|firebaseErrors|syncStore|logStore|utils)$/ }, args => ({ path: args.path, namespace: 'ports' }));
      builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: `
        export const auth={currentUser:{uid:'a'},onAuthStateChanged:()=>{}};
        export const Capacitor={isNativePlatform:()=>false};export const App={addListener:()=>Promise.resolve({remove(){}})};
        export const db={}; export const collection=(...x)=>x;export const query=(...x)=>x;
        export const getDocs=async()=>({docs:[]});export const getDocsFromCache=getDocs;export const getDocsFromServer=getDocs;
        export const doc=(...x)=>x;export const writeBatch=()=>({set(){},commit:async()=>{}});
        export const onSnapshot=(_ref,options,next)=>{globalThis.__listener={options,next};return()=>{};};
        export const handleFirestoreError=()=>{};export const OperationType={};export const useSyncStore={getState:()=>({})};
        export const appLogger={info(){},warn(){},error(){},debug(){}};export const getNextEpisodeNumber=()=>null;export const checkIsUpToDate=()=>false;
      ` }));
    } }],
  });
  const timers = new Map<number, () => void>(), idle = new Map<number, () => void>();
  let sequence = 0;
  const win = Object.assign(new EventTarget(), { setTimeout: (fn: () => void) => { timers.set(++sequence, fn); return sequence; }, clearTimeout: (id: number) => timers.delete(id),
    requestIdleCallback: (fn: () => void) => { idle.set(++sequence, fn); return sequence; }, cancelIdleCallback: (id: number) => idle.delete(id) });
  type ListenerExports = { setupRealtimeShowsListener: (uid: string) => void; getServerConfirmedLibrary: (uid: string) => Array<{ tmdbId: number }> | null; useShowsStore: { getState: () => { shows: unknown[] } } };
  const bundleModule = { exports: {} as ListenerExports };
  const sandbox: Record<string, unknown> = { module: bundleModule, require: createRequire(import.meta.url), window: win, document: Object.assign(new EventTarget(), { visibilityState: 'visible' }), Event, CustomEvent, console,
    setTimeout: win.setTimeout, clearTimeout: win.clearTimeout, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
  vm.runInContext(bundle.outputFiles[0].text, vm.createContext(sandbox));
  const exports = bundleModule.exports;
  const flush = () => { for (const pool of [timers, idle]) { const pending = [...pool.values()]; pool.clear(); pending.forEach(fn => fn()); } };
  const snapshot = (ids: number[], metadata: { fromCache: boolean; hasPendingWrites?: boolean }, changes: number) => ({ metadata: { hasPendingWrites: false, ...metadata },
    forEach: (fn: (doc: { id: string; data: () => unknown }) => void) => ids.forEach(id => fn({ id: `tv-${id}`, data: () => ({ tmdbId: id, mediaType: 'tv', title: `Série ${id}` }) })),
    docChanges: () => Array.from({ length: changes }) });

  exports.setupRealtimeShowsListener('a');
  const listener = sandbox.__listener as { options: { includeMetadataChanges?: boolean }; next: (s: unknown) => void };
  assert.equal(listener.options.includeMetadataChanges, true, 'le passage cache → serveur est signalé même sans document modifié');
  const confirmed = () => { const library = exports.getServerConfirmedLibrary('a'); return library ? Array.from(library, show => show.tmdbId) : null; };

  listener.next(snapshot([1, 2], { fromCache: true }, 2));
  assert.equal(exports.useShowsStore.getState().shows.length, 2, 'premier rendu immédiat depuis le cache local');
  assert.equal(confirmed(), null, 'un instantané du cache local ne fonde aucune décision');
  flush();
  listener.next(snapshot([1, 2], { fromCache: false }, 0));
  assert.deepEqual(confirmed(), [1, 2], 'confirmation serveur immédiate');
  assert.equal(timers.size + idle.size, 0, 'sans nouvelle fusion ni sauvegarde de la bibliothèque');
  assert.equal(exports.getServerConfirmedLibrary('b'), null, 'jamais la bibliothèque d’un autre compte');

  // Un autre appareil supprime la série 2 : tant que l'instantané n'est pas appliqué, rien n'est confirmé.
  listener.next(snapshot([1], { fromCache: false }, 1));
  assert.equal(confirmed(), null);
  flush();
  assert.deepEqual(confirmed(), [1]);
  const base = { delta: true, history: [], libraryWatchStates: [], watchlist: [show(1), show(2)], watchlistComplete: true, collectionComplete: true, previousFingerprint: plexWatchlistFingerprint([show(1), show(2)]), resolutionCache: {} };
  assert.equal(isUnchangedPlexDelta({ ...base, shows: exports.getServerConfirmedLibrary('a') }), false, 'la série supprimée ailleurs mais toujours en Watchlist est réimportée');

  listener.next(snapshot([1, 2], { fromCache: false, hasPendingWrites: true }, 1));
  flush();
  assert.equal(confirmed(), null, 'une écriture locale non confirmée ne vaut pas état serveur');
  assert.equal(isUnchangedPlexDelta({ ...base, shows: null }), false, 'sans bibliothèque confirmée, le traitement complet relit Firestore');

  const engine = readFileSync('src/features/plex/plexSyncEngine.ts', 'utf8');
  assert.match(engine, /shows: getServerConfirmedLibrary\(user\.uid\)/);
  assert.doesNotMatch(engine.slice(engine.indexOf('const unchangedDelta'), engine.indexOf('const unchangedDelta') + 400), /useShowsStore/);
});
