import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';

test('SEENIT-PERF-001 le store réel ne sérialise pas la bibliothèque dans le clic et regroupe le dernier snapshot par UID', async () => {
  const bundle = await build({ entryPoints: ['src/store/showsStore.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['zustand'],
    plugins: [{ name: 'library-cache-ports', setup(builder) {
      builder.onResolve({ filter: /^@capacitor\/(?:app|core)$|^firebase\/firestore$|\/(?:firebase|firebaseErrors|syncStore|logStore|utils)$/ }, args => ({ path: args.path, namespace: 'ports' }));
      builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: `
        export const auth=globalThis.__auth ||= {currentUser:{uid:'a'},onAuthStateChanged:fn=>{globalThis.authChanged=fn;}};
        export const Capacitor={isNativePlatform:()=>true};export const App={addListener:(_event,fn)=>{globalThis.nativeStateChanged=fn;return Promise.resolve({remove(){}});}};
        export const db={}; export const collection=(...x)=>x;export const query=(...x)=>x;
        export const getDocs=async()=>({docs:[]});export const getDocsFromCache=getDocs;export const getDocsFromServer=getDocs;
        export const doc=(...x)=>x;export const writeBatch=()=>({set(){},commit:async()=>{}});export const onSnapshot=()=>()=>{};
        export const handleFirestoreError=()=>{};export const OperationType={};export const useSyncStore={getState:()=>({})};
        export const appLogger={info(){},warn(){},error(){},debug(){}};export const getNextEpisodeNumber=()=>null;export const checkIsUpToDate=()=>false;
      ` }));
    } }],
  });
  const writes: Array<{ key: string; value: string }> = [];
  const timers = new Map<number, () => void>(), idle = new Map<number, () => void>();
  let sequence = 0;
  const win = Object.assign(new EventTarget(), { setTimeout: (fn: () => void) => { timers.set(++sequence, fn); return sequence; }, clearTimeout: (id: number) => timers.delete(id),
    requestIdleCallback: (fn: () => void) => { idle.set(++sequence, fn); return sequence; }, cancelIdleCallback: (id: number) => idle.delete(id) });
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const module = { exports: {} as { useShowsStore: { getState: () => { setShows: (shows: unknown[]) => void; shows: Array<Record<string, unknown>>; updateShowOptimistic: (id: string, update: Record<string, unknown>) => void } } } };
  const context = vm.createContext({ module, require: createRequire(import.meta.url), window: win, document, Event, CustomEvent, console,
    setTimeout: win.setTimeout, clearTimeout: win.clearTimeout,
    localStorage: { getItem: () => null, setItem: (key: string, value: string) => writes.push({ key, value }), removeItem() {} },
  });
  vm.runInContext(bundle.outputFiles[0].text, context);
  const store = module.exports.useShowsStore;
  const runTimers = () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); };
  const runIdle = () => { const pending = [...idle.values()]; idle.clear(); pending.forEach(fn => fn()); };
  store.getState().setShows([{ id: 'target', mediaType: 'tv', tmdbId: 1, seenEpisodes: [] }, { id: 'neighbor', mediaType: 'tv', tmdbId: 2 }]);
  win.dispatchEvent(new Event('pagehide')); writes.length = 0;
  const neighbor = store.getState().shows[1];
  store.getState().updateShowOptimistic('target', { seenEpisodes: ['1x1'] });
  store.getState().updateShowOptimistic('target', { seenEpisodes: ['1x1', '1x2'] });
  assert.equal(writes.length, 0, 'aucune sérialisation synchrone dans les actions');
  assert.equal(store.getState().shows[1], neighbor, 'référence du voisin conservée');
  runTimers(); assert.equal(writes.length, 0, 'la phase idle reste hors du clic'); runIdle();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].key, 'seenit_user:a:shows_v2');
  assert.deepEqual(JSON.parse(writes[0].value)[0].seenEpisodes, ['1x1', '1x2']);
  store.getState().updateShowOptimistic('target', { seenEpisodes: [] });
  document.visibilityState = 'hidden'; document.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(JSON.parse(writes.at(-1)!.value)[0].seenEpisodes, [], 'Annuler est vidé avant suspension');
  document.visibilityState = 'visible';
  store.getState().updateShowOptimistic('target', { title: 'cache natif' });
  vm.runInContext('nativeStateChanged({isActive:false})', context);
  assert.equal(JSON.parse(writes.at(-1)!.value)[0].title, 'cache natif', 'le vrai événement Capacitor vide le cache même si le document est visible');
  const count = writes.length; runTimers(); runIdle(); assert.equal(writes.length, count, 'pas de réécriture après vidage');
  store.getState().updateShowOptimistic('target', { title: 'UID précédent' });
  vm.runInContext('__auth.currentUser.uid="b"', context); runTimers(); runIdle();
  assert.equal(writes.length, count, 'un UID changé avant idle ne réécrit aucun ancien cache');
  vm.runInContext('__auth.currentUser.uid="a"', context);
  store.getState().updateShowOptimistic('target', { title: 'ancien compte' });
  vm.runInContext('authChanged(null)', context); runTimers(); runIdle();
  assert.equal(writes.length, count, 'la déconnexion annule le cache encore en attente');
});
