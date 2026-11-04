import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { PUBLIC_METADATA_CACHE_POLICIES } from '../src/features/shows/publicMetadataCache.ts';

type ShowResult = { ok: boolean; value: { seasons: Array<{ episode_count: number }>; similar?: unknown } };
type Facade = {
  getShowDetails: (id: number, refresh?: boolean) => Promise<ShowResult>;
  peekMediaDetails: (id: number, type?: string) => ShowResult['value'] | null;
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
