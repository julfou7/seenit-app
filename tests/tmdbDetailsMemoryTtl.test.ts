import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { PUBLIC_METADATA_CACHE_POLICIES } from '../src/features/shows/publicMetadataCache.ts';

type ShowResult = { ok: boolean; value: { seasons: Array<{ episode_count: number }>; similar?: unknown } };
type Facade = {
  getShowDetails: (id: number, refresh?: boolean) => Promise<ShowResult>;
  peekMediaDetails: (id: number, type?: string) => ShowResult['value'] | null;
  isMediaDetailsStale: (id: number, type?: string) => boolean;
  getMediaDetailsRevalidateAt: (id: number, type?: string) => number | null;
};

/**
 * #755 : la façade réelle (tmdbClient) avec ses ports réseau et cache public simulés, une horloge contrôlée
 * et un single-flight réel. Le cache public simulé applique la même fraîcheur que la famille `details`.
 */
async function loadFacade() {
  const bundle = await build({ entryPoints: ['src/features/shows/tmdbClient.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [{ name: 'metadata-ports', setup(builder) {
    builder.onResolve({ filter: /\/(?:apiAuth|seenitApi|utils|publicMetadataCache|parentalRatingCache)$/ }, args => ({ path: args.path, namespace: 'ports' }));
    builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: `
      const p=()=>globalThis.__ports;
      export const authenticatedFetch=async()=>{p().calls++;await new Promise(r=>setTimeout(r,5));if(p().offline)return {ok:false,status:503,json:async()=>({})};return {ok:true,status:200,json:async()=>({id:42,name:'Série',seasons:[{season_number:1,episode_count:p().episodes}],similar:{results:[{id:7}]}})};};
      export const resolveSeenItApiUrl=path=>'https://fixture.invalid'+path;
      export const adjustTMDBShowDataForEurope=()=>{};export const adjustTMDBSeasonDataForEurope=()=>{};
      export const readParentalRatingCache=()=>null;export const writeParentalRatingCache=()=>{};
      export const normalizePublicMetadataRequestKey=value=>value;
      export const isPublicMetadataFallbackStatus=status=>status===503;
      export const readPublicMetadataCache=async(family,key,options={})=>{const e=p().cache.get(family+key);if(!e)return null;const fresh=Date.now()-e.storedAt<p().freshMs;return fresh||options.allowStale?{...e,fresh}:null;};
      export const writePublicMetadataCache=(family,key,data)=>{p().cache.set(family+key,{data:structuredClone(data),storedAt:Date.now()});};
      const inFlight=new Map();
      export const runPublicMetadataSingleFlight=(family,key,load)=>{const k=family+key;if(inFlight.has(k)){p().shared++;return inFlight.get(k);}const r=Promise.resolve().then(load);inFlight.set(k,r);r.finally(()=>inFlight.delete(k)).catch(()=>{});return r;};
    ` }));
  } }] });
  const clock = { now: Date.UTC(2026, 10, 4, 8) };
  class FixedDate extends Date {
    constructor(...args: [] | [number]) { super(...(args.length ? args : [clock.now]) as [number]); }
    static now() { return clock.now; }
  }
  const ports = { calls: 0, shared: 0, offline: false, episodes: 6, freshMs: PUBLIC_METADATA_CACHE_POLICIES.details.freshMs, cache: new Map<string, { data: unknown; storedAt: number }>() };
  const module = { exports: {} as { tmdb: Facade; MEDIA_DETAILS_MEMORY_FRESH_MS: number; MEDIA_DETAILS_REVALIDATION_RETRY_MS: number } };
  vm.runInContext(bundle.outputFiles[0].text, vm.createContext({ module, __ports: ports, Date: FixedDate, URL, console, setTimeout, clearTimeout, structuredClone }));
  return { clock, ports, exports: module.exports };
}

test('SEENIT-PERF-001 #755 révalide un détail chaud au-delà du TTL en un seul appel partagé et garde le contenu connu en panne', async () => {
  const { clock, ports, exports } = await loadFacade();
  const client = exports.tmdb;
  assert.equal(exports.MEDIA_DETAILS_MEMORY_FRESH_MS, PUBLIC_METADATA_CACHE_POLICIES.details.freshMs, 'le TTL mémoire suit la politique publique de la famille details');

  assert.equal((await client.getShowDetails(42)).value.seasons[0].episode_count, 6);
  assert.equal(ports.calls, 1);
  clock.now += exports.MEDIA_DETAILS_MEMORY_FRESH_MS - 1000;
  assert.equal((await client.getShowDetails(42)).value.seasons[0].episode_count, 6);
  assert.equal(ports.calls, 1, 'dans le TTL, le cache mémoire chaud répond sans appel fournisseur');

  // Au-delà du TTL, la donnée fournisseur a changé : le premier rendu reste le contenu connu, puis converge.
  clock.now += 2000;
  ports.episodes = 8;
  assert.equal(client.peekMediaDetails(42, 'tv')?.seasons[0].episode_count, 6, 'le premier rendu chaud est conservé');
  const [first, second] = await Promise.all([client.getShowDetails(42), client.getShowDetails(42)]);
  assert.equal(first.value.seasons[0].episode_count, 8, 'les métadonnées évolutives convergent pendant une session longue');
  assert.equal(second.value.seasons[0].episode_count, 8);
  assert.equal(ports.calls, 2, 'un seul rafraîchissement fournisseur pour les lectures concurrentes');
  assert.equal(ports.shared, 1, 'la seconde lecture partage la révalidation en cours');
  assert.equal(client.peekMediaDetails(42, 'tv')?.seasons[0].episode_count, 8);
  assert.equal((await client.getShowDetails(42)).value.seasons[0].episode_count, 8);
  assert.equal(ports.calls, 2, 'la donnée révalidée redevient chaude pour un TTL');

  // Puis panne au TTL suivant : le contenu connu (similaires compris) reste servi, sans rafale de tentatives.
  clock.now += exports.MEDIA_DETAILS_MEMORY_FRESH_MS + 1;
  ports.offline = true;
  const duringOutage = await client.getShowDetails(42);
  assert.equal(duringOutage.ok, true, 'une panne de révalidation ne casse pas la fiche');
  assert.equal(duringOutage.value.seasons[0].episode_count, 8);
  assert.ok(duringOutage.value.similar, 'le détail mémoire complet prime sur la copie persistée allégée');
  assert.equal(ports.calls, 3);
  await client.getShowDetails(42);
  await client.getShowDetails(42);
  assert.equal(ports.calls, 3, 'pas de nouvel appel pendant le délai de nouvelle tentative');
  clock.now += exports.MEDIA_DETAILS_REVALIDATION_RETRY_MS + 1;
  ports.offline = false;
  ports.episodes = 9;
  assert.equal((await client.getShowDetails(42)).value.seasons[0].episode_count, 9, 'le réseau revenu, la révalidation reprend');
  assert.equal(ports.calls, 4);
});

test('SEENIT-PERF-001 #851 une fiche restée ouverte au-delà du TTL relit ses détails d’elle-même', async () => {
  const { clock, ports, exports } = await loadFacade();
  const client = exports.tmdb;
  assert.equal(client.getMediaDetailsRevalidateAt(42, 'tv'), null, 'rien à surveiller avant le premier chargement');
  assert.equal(client.isMediaDetailsStale(42, 'tv'), false);
  await client.getShowDetails(42);
  assert.equal(client.getMediaDetailsRevalidateAt(42, 'tv'), clock.now + exports.MEDIA_DETAILS_MEMORY_FRESH_MS, 'la fiche connaît l’échéance de son détail');
  assert.equal(client.isMediaDetailsStale(42, 'tv'), false);
  clock.now += exports.MEDIA_DETAILS_MEMORY_FRESH_MS + 1;
  ports.episodes = 10;
  assert.equal(client.isMediaDetailsStale(42, 'tv'), true, 'échéance dépassée : la fiche ouverte doit relire');
  assert.equal(client.peekMediaDetails(42, 'tv')?.seasons[0].episode_count, 6, 'sans relecture, le contenu reste affiché');
  assert.equal((await client.getShowDetails(42)).value.seasons[0].episode_count, 10);
  assert.equal(client.isMediaDetailsStale(42, 'tv'), false);
  assert.equal(client.getMediaDetailsRevalidateAt(42, 'tv'), clock.now + exports.MEDIA_DETAILS_MEMORY_FRESH_MS, 'nouvelle échéance après la relecture');

  // L'écran monté déclenche la relecture : minuteur sur l'échéance et retour au premier plan (heure murale).
  const screen = readFileSync('src/screens/ShowDetailScreenCore.tsx', 'utf8');
  const trigger = readFileSync('src/screens/mediaDetail/useDetailsRevalidation.ts', 'utf8');
  assert.match(trigger, /isStale: \(\) => tmdb\.isMediaDetailsStale\(id, mediaType\)/);
  assert.match(trigger, /document\.addEventListener\('visibilitychange', schedule\.check\)/);
  assert.match(trigger, /document\.removeEventListener\('visibilitychange', schedule\.check\)/);
  assert.match(trigger, /\}, \[tmdbId, mediaKey, mediaType, details\]\);/);
  const fetchEffect = screen.slice(screen.indexOf('const fetchDetails = async () => {'));
  assert.match(fetchEffect.slice(0, 2000), /\}, \[effectiveTmdbId, requestedMediaKey, requestedMediaType, detailsRevalidation\]\);/, 'la relecture passe par le chargement réel et sa propagation à la vue');
});

test('SEENIT-PERF-001 #851 la fiche ouverte retente la relecture tant que TMDB est en panne', async () => {
  const bundle = await build({ entryPoints: ['src/screens/mediaDetail/useDetailsRevalidation.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [{ name: 'revalidation-ports', setup(builder) {
    builder.onResolve({ filter: /^react$|\/features\/shows\/tmdb$/ }, args => ({ path: args.path, namespace: 'ports' }));
    builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: 'export const MEDIA_DETAILS_REVALIDATION_RETRY_MS=300000;export const tmdb={};export const useState=()=>[0,()=>{}];export const useEffect=()=>{};' }));
  } }] });
  const module = { exports: {} as { scheduleDetailsRevalidation: (ports: Record<string, unknown>) => { check: () => void; dispose: () => void } } };
  vm.runInContext(bundle.outputFiles[0].text, vm.createContext({ module }));
  const day = 24 * 60 * 60 * 1000, retry = 300000;
  const state = { now: 0, revalidateAt: day as number | null, visible: true, revalidations: 0 };
  let timer: { at: number; run: () => void } | null = null;
  const schedule = module.exports.scheduleDetailsRevalidation({
    revalidateAt: () => state.revalidateAt, isStale: () => state.revalidateAt !== null && state.now >= state.revalidateAt,
    isVisible: () => state.visible, now: () => state.now, onRevalidate: () => { state.revalidations++; },
    setTimer: (run: () => void, delay: number) => (timer = { at: state.now + delay, run }), clearTimer: () => { timer = null; },
  });
  const fire = () => { const due = timer!; timer = null; state.now = due.at; due.run(); };
  assert.equal(timer!.at, day + 50, 'le minuteur vise l’échéance du détail');
  fire();
  assert.equal(state.revalidations, 1, 'échéance atteinte : relecture lancée');
  // TMDB en panne : le détail affiché reste le même et l'échéance recule de 5 min.
  state.revalidateAt = state.now + retry;
  assert.equal(timer!.at, state.now + retry + 50, 'minuteur réarmé au délai de nouvelle tentative');
  fire();
  assert.equal(state.revalidations, 2, 'la relecture est retentée pendant que la fiche reste ouverte');
  state.revalidateAt = state.now + retry;
  state.visible = false;
  fire();
  assert.equal(state.revalidations, 2, 'en arrière-plan, aucune relecture');
  assert.equal(timer, null, 'ni minuteur : la veille gèle de toute façon les minuteurs');
  state.now += 3 * day;
  state.visible = true;
  schedule.check();
  assert.equal(state.revalidations, 3, 'au retour au premier plan, l’heure murale déclenche la relecture');
  assert.ok(timer, 'puis la nouvelle tentative est planifiée');
  schedule.dispose();
  assert.equal(timer, null, 'démontage ou nouveau détail : plus aucun minuteur');
});
