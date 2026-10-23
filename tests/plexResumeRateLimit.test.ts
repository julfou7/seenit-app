import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';

const now = Date.UTC(2026, 9, 23, 16);
const storage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); }, values };
};
const compileTransport = (realWebAuth = false) => build({ entryPoints: ['src/features/plex/plexHistoryTransport.ts'], bundle: true, write: false, format: 'cjs', platform: 'node',
  plugins: [{ name: 'transport-ports', setup(builder) {
    builder.onResolve({ filter: /^@capacitor\/core$|\/(?:firebase|apiAuth|seenitApi|logStore|updateStore|clientOperationalDiagnostics\.ts)$/ }, args => realWebAuth && args.path.endsWith('/apiAuth') ? undefined : ({ path: 'ports', namespace: 'ports' }));
    builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: `
      const p=()=>globalThis.__ports;
      export const auth={get currentUser(){return p().user}};
      export const Capacitor={isNativePlatform:()=>p().native};
      export const CapacitorHttp={post:async request=>{p().nativeCalls.push(request);if(p().switchDuringReply)p().user={uid:'user-b'};if(p().allNativeDnsFailure||p().dnsFailure&&p().nativeCalls.length===1)throw new Error('Unable to resolve host');return p().reply}};
      export const getAuthenticatedHeaders=async headers=>{if(p().switchDuringHeaders)p().user={uid:'user-b'};return {...headers,Authorization:'opaque-auth'}};
      export const authenticatedFetch=async (url,request)=>{p().webCalls.push({url,request});return p().webReply};
      export const resolveSeenItApiCandidates=()=>['https://primary.invalid/api/plex/history','https://secondary.invalid/api/plex/history'];
      export const appLogger={info:()=>{},warn:()=>{},success:()=>{}};
      export const CURRENT_APP_VERSION='1.4.219';export const flushClientOperationalSignals=()=>Promise.resolve();
      export const resolveSeenItApiUrl=value=>value;export const isSeenItApiRequest=()=>true;export const isUnexpectedHtmlApiResponse=()=>false;
    ` }));
  } }],
});
const bundle = compileTransport();
const webBundle = compileTransport(true);
async function harness(memory = storage(), realWebAuth = false) {
  const clock = { now };
  class Clock extends Date { static now() { return clock.now; } }
  const ports = { user: { uid: 'user-a' } as {uid: string;getIdToken?:()=>Promise<string>}, native: true, nativeCalls: [] as unknown[], webCalls: [] as unknown[], dnsFailure: false, allNativeDnsFailure: false, headerLookups: 0, switchDuringWebToken: false, switchDuringReply: false, switchDuringHeaders: false,
    reply: { status: 200, headers: {} as Record<string, string>, data: '{"history":[],"watchlist":[]}' },
    webReply: new Response('{"history":[],"watchlist":[]}', { status: 200 }),
  };
  ports.user.getIdToken = async () => { ports.headerLookups++; if (ports.switchDuringWebToken && (!ports.native || ports.headerLookups > 2)) ports.user = {uid:'user-b'}; return 'opaque-id'; };
  const module = { exports: {} as { fetchPlexHistoryData: (uid: string, token: string, clientId: string, delta: boolean) => Promise<{ history: unknown[] }> } };
  const context = vm.createContext({ module, __ports: ports, Date: Clock, localStorage: memory, setTimeout, clearTimeout, AbortController, Headers, fetch: async (url: string, request: unknown) => { ports.webCalls.push({url,request});return ports.webReply; } });
  vm.runInContext((await (realWebAuth ? webBundle : bundle)).outputFiles[0].text, context);
  return { ports, clock, memory, run: () => module.exports.fetchPlexHistoryData(ports.user.uid, 'opaque-plex', 'client', true) };
}

test('SEENIT-PLEX-002 le transport réel conserve le refus HTTP natif et son délai sans parsing ni rafale', async () => {
  const h = await harness();
  h.memory.setItem('cursor', '123'); h.memory.setItem('progress', '["1x2"]');
  h.ports.reply = { status: 429, headers: { 'ReTrY-AfTeR': '120' }, data: 'Rate exceeded.' };
  await assert.rejects(h.run, error => {
    assert.equal((error as { status: number }).status, 429);
    assert.equal((error as { retryAt: number }).retryAt, now + 120_000);
    assert.doesNotMatch(String(error), /Unexpected token|Rate exceeded|opaque/);
    return true;
  });
  assert.equal(h.ports.nativeCalls.length, 1); assert.equal(h.ports.webCalls.length, 0);
  assert.equal(h.memory.getItem('cursor'), '123'); assert.equal(h.memory.getItem('progress'), '["1x2"]');
  const reopened = await harness(h.memory);
  await assert.rejects(reopened.run, { name: 'PlexSyncHttpError', status: 429 });
  assert.equal(reopened.ports.nativeCalls.length, 0, 'un redémarrage ne contourne pas Retry-After');
  reopened.ports.user = { uid: 'user-b' };
  assert.deepEqual((await reopened.run()).history.length, 0, 'aucun délai emprunté à un autre UID');
  reopened.ports.user = { uid: 'user-a' }; reopened.clock.now += 120_001;
  assert.equal((await reopened.run()).history.length, 0, 'une vraie reprise est possible après le délai');
});

test('SEENIT-PLEX-002 respecte Retry-After HTTP et défaut60s sur la voie Web réelle', async () => {
  for (const [header, expected] of [[new Date(now + 300_000).toUTCString(), 300_000], ['invalide', 60_000], ['', 60_000]] as const) {
    const h = await harness(); h.ports.native = false;
    h.ports.webReply = new Response('Rate exceeded.', { status: 429, headers: { 'Retry-After': header } });
    await assert.rejects(h.run, error => { assert.equal((error as { retryAt: number }).retryAt, now + expected); return true; });
    assert.equal(h.ports.webCalls.length, 1); assert.equal(h.ports.nativeCalls.length, 0);
  }
});

test('SEENIT-PLEX-002 distingue les refus fonctionnels du secours DNS et des réponses illisibles', async () => {
  for (const status of [401, 403, 500, 503]) {
    const h = await harness(); h.ports.reply = { status, headers: {}, data: '<html>indisponible</html>' };
    await assert.rejects(h.run, { name: 'PlexSyncHttpError', status });
    assert.equal(h.ports.nativeCalls.length, 1); assert.equal(h.ports.webCalls.length, 0);
  }
  const malformed = await harness(); malformed.ports.reply.data = 'not JSON';
  await assert.rejects(malformed.run, /Réponse du service Plex illisible/);
  assert.equal(malformed.ports.nativeCalls.length, 1);
  const dns = await harness(); dns.ports.dnsFailure = true;
  assert.equal((await dns.run()).history.length, 0);
  assert.equal(dns.ports.nativeCalls.length, 2, 'le secours réseau approuvé reste disponible');
});

async function engineHarness() {
  const compiled = await build({ entryPoints: ['src/features/plex/plexSyncEngine.ts'], bundle: true, write: false, platform: 'node', format: 'cjs',
    plugins: [{ name: 'engine-ports', setup(builder) {
      builder.onResolve({ filter: /^(?:firebase\/firestore|@capacitor\/core)$|\/(?:firebase|tmdb|showsStore|syncStore|toastStore|utils|logStore|plex|apiAuth|seenitApi|plexStorage|plexAvailability|plexResolution|updateStore)$/ }, () => ({ path: 'ports', namespace: 'ports' }));
      builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ resolveDir: process.cwd(), contents: `
        export {fetchPlexHistoryData} from './src/features/plex/plexHistoryTransport.ts';
        const p=()=>globalThis.__ports;
        export const auth={get currentUser(){return p().user}}; export const db={};
        export const Capacitor={isNativePlatform:()=>true};export const CapacitorHttp={post:async()=>{p().requests++;return {status:429,data:'Rate exceeded.',headers:{'Retry-After':'120'}}}};
        export const getAuthenticatedHeaders=async()=>({});export const authenticatedFetch=()=>{throw new Error('fallback interdit')};
        export const resolveSeenItApiCandidates=()=>['https://example.invalid/api/plex/history'];export const resolveSeenItApiUrl=value=>value;
        export const appLogger={info:()=>{},warn:()=>{},error:()=>{},success:()=>{}};export const tmdb={};export const CURRENT_APP_VERSION='1.4.219';
        export const collection=(...args)=>args;export const doc=(...args)=>args;
        export const getDocFromServer=async()=>{p().reads++;return {exists:()=>true,data:()=>({authToken:p().cloudAuthToken,lastSyncTimestamp:42})}};
        export const runTransaction=async()=>{p().writes++};export const setDoc=async()=>{p().writes++;if(p().migrationGate)await p().migrationGate};export const updateDoc=setDoc;export const getDocs=async()=>({docs:[]});export const writeBatch=()=>{};export const deleteField=()=>{};
        export const fetchAuthoritativeShowsForUser=async()=>{throw new Error('lecture progression interdite après refus')};export const useShowsStore={getState:()=>({})};
        export const useSyncStore={getState:()=>({plexSyncStatus:null,setPlexSyncStatus:()=>{}})};
        export const useToastStore={getState:()=>({showToast:(message,tone)=>p().toasts.push({message,tone})})};export const openExternalUrl=()=>{};
        export const getPlexClientId=()=> 'client';export const getStoredPlexToken=()=> 'opaque';export const getStoredPlexUsername=()=>'';
        export const getPlexLastSyncTimestamp=()=>42;export const setPlexLastSyncTimestamp=()=>{p().cursorWrites++};
        export const getPlexResolutionCache=()=>p().cache;export const setPlexResolutionCache=(_uid,value)=>{p().cache=value};
        export const mergePlexResolutionCaches=(a,b)=>({...a,...b});export const compactPlexResolutionCache=value=>value;
        export const getPlexUserStorageKey=()=>'';export const storePlexCredentials=()=>{};
        export const getPlexMediaKey=()=>'';export const usePlexAvailabilityStore={getState:()=>({})};
        export const buildPlexResolutionCacheKey=()=>'';export const cleanShowForFirestore=value=>value;export const extractTmdbIdFromPlex=()=>null;
        export const findShowInLocalLibrary=()=>null;export const getPlexGuid=()=>null;export const resolvePlexItem=()=>null;export const runPlexTasksWithConcurrency=()=>{};
      ` }));
    } }],
  });
  const cache = { 'movie:42': { available: true } };
  const ports = { user: { uid: 'a' }, cloudAuthToken: 'opaque' as string | null, migrationGate: null as Promise<void> | null, requests: 0, reads: 0, writes: 0, cursorWrites: 0, cache,
    toasts: [] as Array<{ message: string; tone: string }> };
  const module = { exports: {} as { performPlexSync: (options: { ignoreCooldown: boolean }) => Promise<{ success: boolean }> } };
  const memory = storage();
  vm.runInContext(compiled.outputFiles[0].text, vm.createContext({ module, __ports: ports, localStorage: memory,
    setTimeout: (callback: () => void) => { callback(); return 1; }, clearTimeout() {},
  }));
  return { ports, cache, module, memory };
}

test('SEENIT-PLEX-003 la synchronisation réelle ne touche pas au curseur ni à la progression sur429', async () => {
  const { ports, cache, module } = await engineHarness();
  assert.equal((await module.exports.performPlexSync({ ignoreCooldown: true })).success, false);
  assert.equal(ports.requests, 1); assert.equal(ports.reads, 1); assert.equal(ports.writes, 0); assert.equal(ports.cursorWrites, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(ports.cache)), cache); assert.equal(ports.toasts[0].tone, 'info'); assert.doesNotMatch(ports.toasts[0].message, /Unexpected token/);
  assert.equal((await module.exports.performPlexSync({ ignoreCooldown: true })).success, false);
  assert.equal(ports.requests, 1); assert.equal(ports.reads, 1, 'même le forçage manuel ne relit pas Firestore pendant Retry-After');
});


test('SEENIT-PLEX-004 annule le compte capturé si l’auth change pendant la migration Plex réelle', async () => {
  const h = await engineHarness(); h.ports.cloudAuthToken = null;
  let release = () => {};
  h.ports.migrationGate = new Promise<void>(resolve => { release = resolve; });
  const sync = h.module.exports.performPlexSync({ ignoreCooldown: true });
  while (h.ports.writes === 0) await new Promise(resolve => setImmediate(resolve));
  h.ports.user = { uid: 'b' }; release();
  assert.equal((await sync).success, false);
  assert.equal(h.ports.requests, 0, 'aucun token Plex A envoyé avec une session B');
  assert.equal(h.ports.cursorWrites, 0);
  assert.equal(h.memory.getItem('seenit_user:b:plex_sync_retry_at'), null, 'la migration A ne met pas B en pause');
});


test('SEENIT-PLEX-004 conserve l’UID d’origine après une réponse en vol et arrête les en-têtes d’un autre compte', async () => {
  const inFlight = await harness(); inFlight.ports.switchDuringReply = true;
  inFlight.ports.reply = {status:429,headers:{'Retry-After':'120'},data:'Rate exceeded.'};
  await assert.rejects(inFlight.run, {name:'PlexSyncHttpError',status:429});
  assert.equal(inFlight.ports.user.uid, 'user-b');
  assert.equal(Number(inFlight.memory.getItem('seenit_user:user-a:plex_sync_retry_at')), now+120_000);
  assert.equal(inFlight.memory.getItem('seenit_user:user-b:plex_sync_retry_at'), null);
  const headers = await harness(); headers.ports.switchDuringHeaders = true;
  await assert.rejects(headers.run, /Compte SeenIt modifié/);
  assert.equal(headers.ports.nativeCalls.length, 0);
  assert.equal(headers.ports.webCalls.length, 0);
});


test('SEENIT-PLEX-004 le vrai authenticatedFetch annule aussi après les en-têtes Web et WebView', async () => {
  for (const native of [false,true]) {
    const h = await harness(storage(), true);
    h.ports.native = native; h.ports.allNativeDnsFailure = native; h.ports.switchDuringWebToken = true;
    await assert.rejects(h.run, /Compte SeenIt modifié/);
    assert.equal(h.ports.webCalls.length, 0, 'aucun fetch après le changement pendant getIdToken');
    assert.equal(h.ports.nativeCalls.length, native ? 2 : 0, 'le secours WebView utilise aussi la façade authentifiée réelle');
    assert.equal(h.memory.getItem('seenit_user:user-b:plex_sync_retry_at'), null);
  }
});
