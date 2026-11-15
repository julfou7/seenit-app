import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';

// Retour terrain du 15/11 (vidéo de l'onglet Télécharger) : à l'ouverture, seules les demandes SeenIt
// s'affichaient, puis tout « Programmés » et « Téléchargés » apparaissait quelques secondes plus tard.
test('la dernière copie Sonarr/Radarr est montrée tout de suite, pour le même compte et le même serveur seulement', async () => {
  const bundle = await build({ entryPoints: ['src/store/arrSyncStore.ts'], bundle: true, write: false, platform: 'node', format: 'cjs',
    plugins: [{ name: 'arr-ports', setup(builder) {
      builder.onResolve({ filter: /\/(?:firebase|downloadConfigStore|mediaPresenceStore|programmedCalendar|recentImports|arrCoverage|arrMediaLabels|arrMediaSource)$/ }, args => ({ path: args.path, namespace: 'ports' }));
      builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: `
        const p=()=>globalThis.__ports;
        export const auth={get currentUser(){return {uid:p().uid};}};
        export const useDownloadConfigStore=Object.assign(()=>p().config,{getState:()=>p().config});
        export const useMediaPresenceStore={getState:()=>({checkPresence:async()=>{}})};
        export const programmedScope=c=>[c.sonarrUrl,c.sonarrApiKey].join('\\n');
        export const fetchProgrammedCalendar=async()=>({items:[{kind:'movie',id:1,tmdbId:7,title:'La Guerre des mondes'}],failures:[]});
        export const fetchWatchedMovie=async()=>null;
        export const fetchRecentImports=async()=>({items:[],failures:[],pending:[]});
        export const coverArrLibrary=(programmed)=>({programmed,undecided:[]});
        export const localizeArrLists=async lists=>lists;
        export const tmdbArrLabelSource={};
      ` }));
    } }],
  });
  const storage = new Map<string, string>();
  const ports = { uid: 'julia', config: { sonarrUrl: 'http://nas:8989', sonarrApiKey: 'SECRET-API-KEY' } };
  const module = { exports: {} as {
    useArrSyncStore: { getState: () => { sync: () => Promise<void>; snapshot: { programmed: { items: Array<{ title: string }> } } | null }; setState: (s: object) => void };
    readPersistedArrSnapshot: (key: string) => { programmed: { items: Array<{ title: string }> } } | null;
    arrSyncKey: () => string;
  } };
  const localStorage = { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); }, removeItem: (k: string) => { storage.delete(k); } };
  vm.runInContext(bundle.outputFiles[0].text, vm.createContext({ module, __ports: ports, console, setTimeout, clearTimeout, localStorage, window: { localStorage, addEventListener() {}, dispatchEvent() {} }, process: { env: {} } }));
  const store = module.exports.useArrSyncStore;

  assert.equal(module.exports.readPersistedArrSnapshot(module.exports.arrSyncKey()), null, 'rien avant la première synchronisation');
  await store.getState().sync();
  assert.ok([...storage.values()].length > 0, 'copie gardée sur l’appareil');
  assert.ok(![...storage.values()].some(value => value.includes('SECRET-API-KEY')), 'jamais la clé d’API');

  // Réouverture de l'application : magasin vide, la copie gardée est montrée avant la relecture.
  store.setState({ snapshot: null });
  assert.equal(module.exports.readPersistedArrSnapshot(module.exports.arrSyncKey())?.programmed.items[0].title, 'La Guerre des mondes');
  // Autre serveur : jamais la copie d'un autre serveur.
  ports.config = { sonarrUrl: 'http://autre:8989', sonarrApiKey: 'AUTRE' };
  assert.equal(module.exports.readPersistedArrSnapshot(module.exports.arrSyncKey()), null);
  // Autre compte : sa propre copie seulement.
  ports.config = { sonarrUrl: 'http://nas:8989', sonarrApiKey: 'SECRET-API-KEY' };
  ports.uid = 'autre-compte';
  assert.equal(module.exports.readPersistedArrSnapshot(module.exports.arrSyncKey()), null);
});
