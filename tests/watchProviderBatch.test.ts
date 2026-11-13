import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import express, { type RequestHandler } from 'express';
import { originalBroadcasterOf, originalBroadcasterPlatformIds, originalBroadcasterRow, resolvePassiveProviderState } from '../src/features/providers/passiveProviderState.ts';
import { readWatchProviderCache, WATCH_PROVIDER_CACHE_STORAGE_KEY } from '../src/features/providers/watchProviderCache.ts';
import { CANAL_ORIGINAL_BROADCASTER_NAME } from '../src/utils/providerLogos.ts';
import {
  WATCH_PROVIDER_BATCH_ITEM_BUDGET_PER_MINUTE,
  WATCH_PROVIDER_BATCH_MAX_CONCURRENT,
  compactWatchProviders,
  parseWatchProviderBatchItems,
  registerWatchProviderBatchRoute,
} from '../src/features/providers/watchProviderBatchBackend.ts';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const offer = (id: number, name: string) => ({ provider_id: id, provider_name: name, logo_path: `/${name}.png` });

test('SEENIT-PROVIDER-002 #853 une requête groupée par écran, réduite à la France et mise en cache', async t => {
  let active = 0;
  let maxActive = 0;
  const calls: URL[] = [];
  const authenticate: RequestHandler = (req, res, next) => {
    const token = req.headers.authorization;
    if (!token?.startsWith('Bearer user-')) { res.status(401).json({ error: 'Unauthorized' }); return; }
    (req as typeof req & { user: { uid: string } }).user = { uid: token.slice('Bearer user-'.length) };
    next();
  };
  const app = express();
  registerWatchProviderBatchRoute(app, {
    authenticate,
    secrets: () => ({ TMDB_API_KEY: 'private-tmdb-key' }),
    fetch: async input => {
      const url = new URL(String(input));
      calls.push(url);
      active += 1; maxActive = Math.max(maxActive, active);
      await sleep(5);
      active -= 1;
      const isTv = url.pathname.startsWith('/3/tv/');
      const id = Number(url.pathname.split('/')[3]);
      if (id === 13) return json({ status_code: 34 }, 404);
      const providers = { id, results: { FR: { link: `https://www.themoviedb.org/${id}`, flatrate: [offer(8, 'netflix')] }, US: { flatrate: [offer(15, 'hulu')] } } };
      return json(isTv ? { id, 'watch/providers': providers } : providers);
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); }));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const send = (items: string, user: string | null = 'a') => fetch(`http://127.0.0.1:${address.port}/api/media/watch-providers?items=${encodeURIComponent(items)}`, { headers: user ? { Authorization: `Bearer user-${user}` } : {} });

  const keys = Array.from({ length: 20 }, (_, index) => `${index % 2 ? 'tv' : 'movie'}:${index + 1}`);
  const first = await send(keys.join(','));
  assert.equal(first.status, 200);
  const body = await first.json() as { results: Array<{ key: string; providers: { id: number; results: Record<string, unknown> } | null }> };
  assert.equal(body.results.length, 20, 'une seule requête pour vingt cartes');
  assert.deepEqual(Object.keys(body.results[0].providers!.results), ['FR'], 'seule la région française voyage');
  assert.equal(body.results.find(entry => entry.key === 'movie:13')!.providers, null, 'une panne fournisseur reste nulle');
  assert.ok(maxActive <= WATCH_PROVIDER_BATCH_MAX_CONCURRENT, 'concurrence fournisseur bornée');
  assert.ok(calls.every(url => url.searchParams.get('api_key') === 'private-tmdb-key'
    && (/\/movie\/\d+\/watch\/providers$/.test(url.pathname)
      || (/\/tv\/\d+$/.test(url.pathname) && url.searchParams.get('append_to_response') === 'watch/providers'))));
  assert.doesNotMatch(JSON.stringify(body), /private-tmdb-key/, 'la clé ne sort jamais');

  const callsAfterFirst = calls.length;
  const second = await (await send(keys.slice(0, 5).join(','))).json() as { results: unknown[] };
  assert.equal(second.results.length, 5);
  assert.equal(calls.length, callsAfterFirst, 'réouverture ou re-défilement : servi par le cache');
  await send('movie:13');
  assert.equal(calls.length, callsAfterFirst + 1, 'une erreur n’est jamais mise en cache');

  assert.equal((await send('movie:1', null)).status, 401);
  assert.equal((await send('person:3')).status, 400, 'une personne n’a pas de diffuseurs');
  assert.equal((await send(Array.from({ length: 41 }, (_, index) => `movie:${index + 100}`).join(','))).status, 400, '40 titres au plus');
  assert.ok(WATCH_PROVIDER_BATCH_ITEM_BUDGET_PER_MINUTE >= 400, 'le quota couvre un défilement soutenu');
});

test('SEENIT-PROVIDER-002 #853 parse et compacte sans jamais inventer d’offre', () => {
  assert.deepEqual(parseWatchProviderBatchItems('movie:1,tv:2,movie:1')?.map(item => item.key), ['movie:1', 'tv:2']);
  assert.equal(parseWatchProviderBatchItems('movie:0'), null);
  assert.equal(parseWatchProviderBatchItems(''), null);
  const item = { mediaType: 'tv' as const, id: 7, key: 'tv:7' };
  assert.deepEqual(compactWatchProviders(item, { results: { US: {} } }), { id: 7, results: {} }, 'sans offre française : rien');
});

test('SEENIT-PROVIDER-002 distingue la fiche Canal+ du streaming', async t => {
  const app = express();
  const programme = 'https://www.canalplus.com/decouverte/le-gang-des-souris-vertes/h/31946070_50001';
  registerWatchProviderBatchRoute(app, {
    authenticate: (req, _res, next) => { Object.assign(req, { user: { uid: 'fixture' } }); next(); },
    secrets: () => ({ TMDB_API_KEY: 'fixture' }),
    fetch: async input => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get('append_to_response'), 'watch/providers');
      const id = Number(url.pathname.split('/').at(-1));
      const homepage = id === 2 ? 'https://www.canalplus.com/'
        : id === 4 ? 'https://www.canalplus.com/series/autre-serie/h/7654321_50001'
          : programme;
      const networks = id === 3 ? [{ id: 999 }] : [{ id: 285 }];
      return json({ id, homepage, networks, 'watch/providers': { results: {} } });
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/media/watch-providers?items=tv:335510,tv:2,tv:3,tv:4`);
  const { results } = await response.json();
  assert.deepEqual(results.map(({ providers }: { providers: unknown }) => providers), [
    { id: 335510, results: {}, originalBroadcaster: 'canal' },
    { id: 2, results: {} },
    { id: 3, results: {} },
    { id: 4, results: {}, originalBroadcaster: 'canal' },
  ]);
  const source = results[0].providers.originalBroadcaster;
  assert.equal(resolvePassiveProviderState('tv:335510', null, null, true, [381], source).name, 'Canal+ · diffuseur d’origine');
  assert.equal(resolvePassiveProviderState('tv:335510', null, null, true, [8], source).name, null);
  assert.equal(resolvePassiveProviderState('tv:335510', null, { available: true }, true, [381], source).name, 'Plex');
});

test('SEENIT-PROVIDER-002 retour v1.4.301 : le badge Canal+ d’origine ne porte plus de libellé « Origine »', () => {
  // Demande du 12/11 : « Supprime moi ce label ». Le logo Canal+ reste ; aucune carte n'ajoute de mention visible.
  for (const file of ['src/components/cards/SeriesEpisodeCard.tsx', 'src/components/cards/UpToDateShowCard.tsx', 'src/components/EpisodeCard.tsx', 'src/components/GridMediaCard.tsx', 'src/screens/watchListPresentation.tsx']) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /OriginalBroadcasterLabel|>Origine</, file);
  }
  assert.doesNotMatch(readFileSync('src/components/cards/seriesEpisodeCard.css', 'utf8'), /series-8f__provider--origin/);
});

test('SEENIT-PROVIDER-002 #853 les cartes visibles ensemble partagent une requête, avec repli titre par titre', async () => {
  const bundle = await build({ entryPoints: ['src/features/shows/tmdbClient.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [{ name: 'provider-ports', setup(builder) {
    builder.onResolve({ filter: /\/(?:apiAuth|seenitApi|utils|publicMetadataCache|parentalRatingCache)$/ }, args => ({ path: args.path, namespace: 'ports' }));
    builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: `
      const p=()=>globalThis.__ports;
      export const authenticatedFetch=async url=>{p().urls.push(String(url));const u=new URL(String(url),'https://fixture.invalid');
        if(u.pathname==='/api/media/watch-providers'){if(p().batchDown)return {ok:false,status:404,json:async()=>({})};const keys=u.searchParams.get('items').split(',');
          return {ok:true,status:200,json:async()=>({results:keys.map(key=>({key,providers:key==='movie:3'?null:{id:Number(key.split(':')[1]),results:{FR:{flatrate:[{provider_id:8,logo_path:'/n.png'}]}}}}))})};}
        return {ok:true,status:200,json:async()=>({id:1,results:{FR:{flatrate:[{provider_id:337,logo_path:'/d.png'}]}}})};};
      export const resolveSeenItApiUrl=path=>'https://fixture.invalid'+path;
      export const adjustTMDBShowDataForEurope=()=>{};export const adjustTMDBSeasonDataForEurope=()=>{};
      export const readParentalRatingCache=()=>null;export const writeParentalRatingCache=()=>{};
      export const normalizePublicMetadataRequestKey=v=>String(v);export const isPublicMetadataFallbackStatus=()=>false;
      export const readPublicMetadataCache=async()=>null;export const writePublicMetadataCache=()=>{};
      export const runPublicMetadataSingleFlight=(_f,_k,load)=>load();
    ` }));
  } }] });
  const ports = { urls: [] as string[], batchDown: false };
  const module = { exports: {} as { tmdb: { getWatchProviders: (id: number, type: string) => Promise<{ ok: boolean; value: { results: { FR?: { flatrate?: Array<{ provider_id: number }> } } } }> } } };
  vm.runInContext(bundle.outputFiles[0].text, vm.createContext({ module, __ports: ports, URL, console, setTimeout, clearTimeout, structuredClone }));
  const client = module.exports.tmdb;

  const [a, b, c] = await Promise.all([client.getWatchProviders(1, 'movie'), client.getWatchProviders(2, 'tv'), client.getWatchProviders(3, 'movie')]);
  const batchCalls = ports.urls.filter(url => url.startsWith('/api/media/watch-providers'));
  assert.equal(batchCalls.length, 1, 'trois cartes visibles : une seule requête groupée');
  assert.match(decodeURIComponent(batchCalls[0]), /items=movie:1,tv:2,movie:3/);
  assert.equal(a.value.results.FR!.flatrate![0].provider_id, 8);
  assert.equal(b.value.results.FR!.flatrate![0].provider_id, 8);
  assert.equal(c.value.results.FR!.flatrate![0].provider_id, 337, 'entrée absente du lot : la carte redemande seule');
  assert.equal(ports.urls.filter(url => url.includes('/movie/3/watch/providers')).length, 1);

  ports.urls.length = 0;
  await client.getWatchProviders(1, 'movie');
  assert.equal(ports.urls.length, 0, 'déjà en mémoire : aucun appel');
  ports.batchDown = true;
  const fallback = await client.getWatchProviders(9, 'tv');
  assert.equal(fallback.value.results.FR!.flatrate![0].provider_id, 337, 'backend sans route groupée (avant déploiement) : repli intact');
});

test('SEENIT-PROVIDER-002 #853 la marge de préchargement des logos agit dans la liste qui défile', async () => {
  const bundle = await build({ entryPoints: ['src/features/providers/watchProviderRequestPolicy.ts'], bundle: true, write: false, platform: 'node', format: 'cjs' });
  const observers: Array<{ root: unknown; margin: string; observed: unknown[]; disconnected: boolean }> = [];
  class FakeObserver {
    record: { root: unknown; margin: string; observed: unknown[]; disconnected: boolean };
    constructor(_callback: unknown, options: { root?: unknown; rootMargin?: string }) { this.record = { root: options.root ?? null, margin: options.rootMargin || '', observed: [], disconnected: false }; observers.push(this.record); }
    observe(element: unknown) { this.record.observed.push(element); }
    unobserve() {}
    disconnect() { this.record.disconnected = true; }
  }
  const scroller = { id: 'explorer-scroll' };
  const card = (root: unknown) => ({ closest: (selector: string) => selector === '[data-watch-provider-root]' ? root : null });
  const module = { exports: {} as { observeWatchProviderCard: (element: unknown, callback: () => void) => () => void } };
  vm.runInContext(bundle.outputFiles[0].text, vm.createContext({ module, IntersectionObserver: FakeObserver, document: { addEventListener() {} }, setTimeout, clearTimeout }));
  const release = module.exports.observeWatchProviderCard(card(scroller), () => {});
  module.exports.observeWatchProviderCard(card(scroller), () => {});
  module.exports.observeWatchProviderCard(card(null), () => {});
  assert.equal(observers.length, 2, 'un observateur par racine');
  assert.equal(observers[0].root, scroller, 'Explorer : racine = conteneur qui défile');
  assert.equal(observers[0].margin, '200px');
  assert.equal(observers[0].observed.length, 2);
  assert.equal(observers[1].root, null, 'ailleurs : fenêtre, comme avant');
  release();
  assert.equal(observers[0].disconnected, false, 'reste actif tant qu’une carte de la liste est observée');
  assert.match(readFileSync('src/screens/DiscoverViewCore.tsx', 'utf8'), /<div ref=\{containerRef\} data-watch-provider-root="" className="explorer-scroll/, 'Explorer déclare son conteneur qui défile');
});

test('SEENIT-PROVIDER-002 retour v1.4.300 : une copie de cache écrite avant l’attribution d’origine n’est plus servie', () => {
  // Terrain du 12/11 : Le Gang des souris vertes restait sans diffuseur après la 1.4.300 ; sa copie v1, sans
  // originalBroadcaster, était encore fraîche (6 h) et empêchait la carte de redemander le lot.
  const values = new Map<string, string>([['seenit_watch_providers_v1', JSON.stringify({ 'tv:335510': { data: { id: 335510, results: {} }, timestamp: 1_000 } })]]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  assert.equal(WATCH_PROVIDER_CACHE_STORAGE_KEY, 'seenit_watch_providers_v2');
  assert.equal(readWatchProviderCache(335510, 'tv', { now: 2_000, allowStale: true, storage }), null, 'la carte redemande le lot');
  assert.equal(values.has('seenit_watch_providers_v1'), false, 'l’ancienne copie est libérée');
});

test('SEENIT-PROVIDER-002 retour v1.4.302 : la fiche montre le même diffuseur d’origine Canal+ que la carte', () => {
  // Terrain du 12/11 : la carte du Gang des souris vertes affichait Canal+, la fiche « Pas encore disponible en streaming ».
  const core = readFileSync('src/screens/ShowDetailScreenCore.tsx', 'utf8');
  assert.match(core, /setProviders\(cachedProviders\?\.results\?\.FR \|\| null\); setOriginBroadcaster\(cachedProviders \?\? null\);/);
  assert.match(core, /setProviders\(res\.value\.results\?\.FR \|\| \[\]\); setOriginBroadcaster\(res\.value\);/);
  assert.match(readFileSync('src/screens/ShowDetailView.tsx', 'utf8'), /origin=\{originalBroadcasterRow\(originBroadcaster, tmdbDetails\?\.homepage\)\}/);
  const card = readFileSync('src/screens/mediaDetail/detailUi.tsx', 'utf8');
  assert.match(card, /Diffuseur d’origine en France/);
  assert.match(card, /\{!loading && providers\.length === 0 && !origin && <p/, 'plus de « pas encore disponible » quand Canal+ diffuse');
});

test('SEENIT-PROVIDER-002 retour v1.4.303 : une seule détection du diffuseur d’origine, appliquée partout', () => {
  // « Le correctif Canal est bien appliqué partout ? Même Explorer ? » : la détection est unique, seul l’affichage change.
  const payload = { id: 335510, results: {}, originalBroadcaster: 'canal' };
  assert.equal(originalBroadcasterOf(payload), 'canal');
  assert.equal(originalBroadcasterOf({ results: {} }), null);
  assert.deepEqual(originalBroadcasterPlatformIds(payload), [381], 'le filtre « Mes plateformes : Canal+ » garde la série');
  assert.deepEqual(originalBroadcasterPlatformIds(null), []);
  assert.deepEqual(originalBroadcasterRow(payload, 'https://www.canalplus.com/decouverte/le-gang-des-souris-vertes/h/31946070_50001'), { name: 'Canal+', logo: '/brand/providers/canalplus.png', link: 'https://www.canalplus.com/decouverte/le-gang-des-souris-vertes/h/31946070_50001' });
  assert.deepEqual(originalBroadcasterRow(payload, 'https://example.invalid/'), { name: 'Canal+', logo: '/brand/providers/canalplus.png' }, 'lien hors canalplus.com ignoré');
  assert.equal(originalBroadcasterRow({ results: {} }, null), null);
  // Fiche épisode, profil acteur et recherche Explorer lisent le même lot que les cartes.
  const episode = readFileSync('src/screens/EpisodeDetailModalCore.tsx', 'utf8');
  assert.match(episode, /const originRow = originalBroadcasterRow\(providersPayload,/);
  assert.match(episode, /\(watchProviders\.length > 0 \|\| originRow\) && <WhereToWatchCard [^>]*origin=\{originRow\}/);
  assert.match(readFileSync('src/components/MovieActorProfile.tsx', 'utf8'), /resolvePassiveProviderState\(actorCreditKey\(credit\), extractOfficialStreamingProvider\(data\?\.results\), plex, true, \[\], data\?\.originalBroadcaster\)/);
  assert.match(readFileSync('src/screens/DiscoverScreen.tsx', 'utf8'), /\.\.\.originalBroadcasterPlatformIds\(response\.value\)\]/);
});
