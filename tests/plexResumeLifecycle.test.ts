import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';

const bundle = build({
  entryPoints: ['src/features/plex/plexHistoryTransport.ts'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  plugins: [{
    name: 'plex-resume-lifecycle-ports',
    setup(builder) {
      builder.onResolve({ filter: /^@capacitor\/app$|^@capacitor\/core$|\/(?:firebase|apiAuth|seenitApi|logStore)$/ }, () => ({ path: 'ports', namespace: 'ports' }));
      builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: `
        const p=()=>globalThis.__ports;
        export const auth={get currentUser(){return p().user}};
        export const App={addListener:async (_event,callback)=>{p().appStateListener=callback;return{remove:async()=>{if(p().appStateListener===callback)p().appStateListener=null}}}};
        export const Capacitor={isNativePlatform:()=>p().native};
        export const CapacitorHttp={post:async request=>{p().nativeCalls.push(request);if(p().nativeError)throw p().nativeError;return p().nativeReply}};
        export const getAuthenticatedHeaders=async headers=>({...headers,Authorization:'opaque-auth'});
        export const authenticatedFetch=async (url,request)=>{p().webCalls.push({url,request});return p().webResponder(url,request)};
        export const resolveSeenItApiCandidates=()=>['https://primary.invalid/api/plex/history'];
        export const appLogger={info:(...args)=>p().logs.push(['info',...args]),warn:(...args)=>p().logs.push(['warn',...args]),success:(...args)=>p().logs.push(['success',...args])};
      ` }));
    }
  }]
});

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

function response(body = '{"history":[],"watchlist":[]}') {
  return {
    status: 200,
    headers: { get: (_key: string) => null },
    text: async () => body,
  } as unknown as Response;
}

function abortError() {
  return Object.assign(new Error('signal is aborted without reason'), { name: 'AbortError' });
}

async function waitFor(predicate: () => boolean, message: string) {
  for (let attempt = 0; attempt < 250; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

async function harness() {
  const pageDocument = Object.assign(new EventTarget(), { visibilityState: 'visible' as 'visible' | 'hidden' });
  const ports = {
    user: { uid: 'user-a' },
    native: true,
    nativeCalls: [] as unknown[],
    webCalls: [] as Array<{ url: string; request: RequestInit }>,
    nativeError: null as Error | null,
    nativeReply: { status: 200, headers: {}, data: '{"history":[],"watchlist":[]}' },
    webResponder: async (_url: string, _request: RequestInit) => response(),
    logs: [] as unknown[][],
    appStateListener: null as null | ((state: { isActive: boolean }) => void),
  };
  const module = { exports: {} as { fetchPlexHistoryData: (uid: string, token: string, clientId: string, delta: boolean) => Promise<{ history?: unknown[] }> } };
  const context = vm.createContext({
    module,
    __ports: ports,
    localStorage: storage(),
    document: pageDocument,
    Event,
    EventTarget,
    AbortController,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext((await bundle).outputFiles[0].text, context);
  return {
    ports,
    pageDocument,
    run: () => module.exports.fetchPlexHistoryData(ports.user.uid, 'opaque-plex', 'client', true),
    background: () => {
      pageDocument.visibilityState = 'hidden';
      pageDocument.dispatchEvent(new Event('visibilitychange'));
      ports.appStateListener?.({ isActive: false });
    },
    foreground: () => {
      pageDocument.visibilityState = 'visible';
      pageDocument.dispatchEvent(new Event('visibilitychange'));
      ports.appStateListener?.({ isActive: true });
    },
  };
}

test('SEENIT-PLEX-002 une requête Plex WebView déjà en vol attend le retour foreground sans toast AbortSignal', async () => {
  const h = await harness();
  h.ports.nativeError = new Error('Unable to resolve host');
  let webAttempt = 0;
  h.ports.webResponder = async (_url, request) => {
    webAttempt += 1;
    if (webAttempt > 1) return response();
    return new Promise<Response>((_resolve, reject) => {
      const signal = request.signal as AbortSignal;
      const rejectAbort = () => reject(abortError());
      if (signal.aborted) rejectAbort();
      else signal.addEventListener('abort', rejectAbort, { once: true });
    });
  };

  const sync = h.run();
  await waitFor(() => h.ports.webCalls.length === 1, 'le fallback WebView n’a pas démarré');
  assert.equal(typeof h.ports.appStateListener, 'function', 'le transport natif doit écouter appStateChange');
  h.background();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.ports.webCalls.length, 1, 'aucune nouvelle requête ne part tant que l’app reste en arrière-plan');

  h.foreground();
  const result = await sync;
  assert.equal(result.history?.length, 0);
  assert.equal(h.ports.nativeCalls.length, 1, 'le serveur natif en échec n’est pas martelé au retour');
  assert.equal(h.ports.webCalls.length, 2, 'la même collecte WebView reprend une seule fois au foreground');
  assert.equal(webAttempt, 2);
  assert.equal(h.ports.appStateListener, null, 'le listener natif est retiré après la collecte');
});

test('SEENIT-PLEX-002 un AbortError transport hors cycle de vie ne fuit jamais comme message technique brut', async () => {
  const h = await harness();
  h.ports.native = false;
  h.ports.webResponder = async () => { throw abortError(); };

  await assert.rejects(h.run(), error => {
    const message = error instanceof Error ? error.message : String(error);
    assert.match(message, /Network request failed/i);
    assert.doesNotMatch(message, /signal is aborted without reason/i);
    return true;
  });
  assert.equal(h.ports.nativeCalls.length, 0);
  assert.equal(h.ports.webCalls.length, 1);
});
