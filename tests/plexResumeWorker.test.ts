import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';

const bundle = build({ entryPoints: ['src/hooks/useDetailsSyncWorker.ts'], bundle: true, write: false, platform: 'node', format: 'cjs',
  plugins: [{ name: 'resume-ports', setup(builder) {
    builder.onResolve({ filter: /^(?:react|firebase\/firestore|@capacitor\/core|@capacitor\/app)$|\/(?:firebase|tmdb|utils|syncStore|showsStore|syncPlex|plexStorage|logStore)$/ }, () => ({ path: 'ports', namespace: 'ports' }));
    builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: `
      const p=()=>globalThis.__ports;
      export const useRef=value=>({current:value});export const useEffect=effect=>{p().cleanup=effect()};
      export const Capacitor={isNativePlatform:()=>true};
      export const App={addListener:async(_name,callback)=>{p().nativeListener=callback;return {remove:async()=>{p().removed++}}}};
      export const auth={get currentUser(){return p().user},onAuthStateChanged:callback=>{p().authListener=callback;callback(p().user);return ()=>{p().unsubscribed++}}};
      export const db={};export const sendNativeNotification=()=>{};
      export const collection=(...args)=>args;export const doc=(...args)=>args;
      export const getDocs=async()=>{p().detailsReads++;return {empty:true,docs:[]}};
      export const getDoc=async()=>({exists:()=>false});export const updateDoc=async()=>{};export const addDoc=async()=>{};
      export const tmdb={};export const getTodayStr=()=>'';export const getNextEpisodeNumber=()=>null;export const computeAutoArchiveStatus=()=>false;
      export const useSyncStore={getState:()=>({setSyncStatus:()=>{},setQuotaExceeded:()=>{},isQuotaExceeded:false})};
      export const useShowsStore={getState:()=>({shows:[]})};export const appLogger={warn:()=>{}};
      export const getStoredPlexToken=()=> 'opaque';export const getPlexLastSyncTimestamp=uid=>p().lastSuccess[uid]||0;
      export const performPlexSync=async options=>{p().plexCalls.push({uid:p().user.uid,options});return {success:true}};
    ` }));
  } }],
});

async function harness() {
  const clock = { now: Date.UTC(2026, 9, 23, 16) };
  class Clock extends Date { static now() { return clock.now; } }
  let nextTimer = 0;
  const timers = new Map<number, { callback: () => void; at: number; repeat: number }>();
  const schedule = (callback: () => void, delay: number, repeat = 0) => {
    const id = ++nextTimer; timers.set(id, { callback, at: clock.now + delay, repeat }); return id;
  };
  const ports = { user: { uid: 'alpha' } as { uid: string } | null, cleanup: () => {}, authListener: (_user: { uid: string } | null) => {},
    nativeListener: (_event: { isActive: boolean }) => {}, removed: 0, unsubscribed: 0,
    plexCalls: [] as Array<{ uid: string }>, detailsReads: 0, lastSuccess: {} as Record<string, number> };
  const window = new EventTarget(), document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const values = new Map<string, string>();
  const localStorage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const module = { exports: {} as { useDetailsSyncWorker: () => void } };
  vm.runInContext((await bundle).outputFiles[0].text, vm.createContext({ module, __ports: ports, Date: Clock, localStorage,
    window, document, console: { log() {}, warn() {}, error() {} },
    setTimeout: (callback: () => void, delay: number) => schedule(callback, delay), clearTimeout: (id: number) => timers.delete(id),
    setInterval: (callback: () => void, delay: number) => schedule(callback, delay, delay), clearInterval: (id: number) => timers.delete(id),
  }));
  const advance = async (duration: number) => {
    const end = clock.now + duration;
    for (;;) {
      const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, timer] = next; clock.now = timer.at;
      if (timer.repeat) timer.at += timer.repeat; else timers.delete(id);
      timer.callback(); for (let n = 0; n < 5; n++) await Promise.resolve();
    }
    clock.now = end;
  };
  return { ports, clock, timers, document, values, advance, mount: () => module.exports.useDetailsSyncWorker(),
    focus: () => window.dispatchEvent(new Event('focus')),
    visibility: (visible: boolean) => { document.visibilityState = visible ? 'visible' : 'hidden'; document.dispatchEvent(new Event('visibilitychange')); },
  };
}

test('SEENIT-PLEX-002 le worker réel regroupe et annule les reprises hors écran', async () => {
  const h = await harness(); h.mount();
  for (let n = 0; n < 10; n++) { h.focus(); h.visibility(true); h.ports.nativeListener({ isActive: true }); }
  await h.advance(1999); assert.equal(h.ports.plexCalls.length, 0); assert.equal(h.ports.detailsReads, 0);
  h.visibility(false); await h.advance(10_000);
  assert.equal(h.ports.plexCalls.length, 0); assert.equal(h.ports.detailsReads, 0, 'fermer avant le délai ne consomme pas le throttle');
  h.visibility(true); await h.advance(2000);
  assert.equal(h.ports.plexCalls.length, 1); assert.equal(h.ports.detailsReads, 0, 'les deux travaux ne démarrent pas ensemble');
  await h.advance(3000); assert.equal(h.ports.detailsReads, 1);
  h.visibility(false); await h.advance(45 * 60_000);
  assert.equal(h.ports.plexCalls.length, 1, 'aucun polling caché malgré trois intervalles');
  assert.equal(h.ports.detailsReads, 1);
  h.visibility(true); h.ports.nativeListener({ isActive: false }); await h.advance(6000);
  assert.equal(h.ports.plexCalls.length, 1, 'le signal natif caché suffit même si le DOM reste visible');
  h.ports.nativeListener({ isActive: true }); await h.advance(2000); assert.equal(h.ports.plexCalls.length, 2);
  h.ports.cleanup(); h.focus(); await h.advance(30_000); await Promise.resolve();
  assert.equal(h.ports.plexCalls.length, 2); assert.equal(h.timers.size, 0); assert.equal(h.ports.removed, 1);
});

test('SEENIT-PLEX-002 le worker respecte le délai persistant les succès récents et le changement de compte', async () => {
  const h = await harness(); h.values.set('seenit_user:alpha:plex_sync_retry_at', String(h.clock.now + 120_000)); h.mount();
  await h.advance(2000); assert.equal(h.ports.plexCalls.length, 0);
  h.ports.user = { uid: 'beta' }; h.ports.authListener(h.ports.user); await h.advance(2000);
  assert.equal(h.ports.plexCalls.length, 1); assert.equal(h.ports.plexCalls[0].uid, 'beta');
  h.ports.user = null; h.ports.authListener(null); await h.advance(5000); assert.equal(h.ports.detailsReads, 0);
  await h.advance(120_000); h.ports.user = { uid: 'alpha' }; h.ports.authListener(h.ports.user); await h.advance(2000);
  assert.equal(h.ports.plexCalls.length, 2, 'le délai a expiré sans fausse réussite persistée'); h.ports.cleanup();
  const recent = await harness(); recent.ports.lastSuccess.alpha = recent.clock.now; recent.mount(); await recent.advance(5000);
  assert.equal(recent.ports.plexCalls.length, 0, 'le cooldown de réussite existant reste respecté'); recent.ports.cleanup();
});
