import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';

type Media = { id: number; media_type?: string; vote_count?: number; release_date?: string; first_air_date?: string; title?: string };
type Page = { popular: Media[] | null; trending: Media[] | null; persons: Media[] | null; hasMore: boolean } | null;

/** Façade TMDB réelle (tmdbClient) : transport et cache public simulés, URL enregistrées. */
async function loadTmdbClient(responses: (url: URL) => { results: Media[]; total_pages?: number }) {
  const bundle = await build({ entryPoints: ['src/features/shows/tmdbClient.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [{ name: 'explorer-ports', setup(builder) {
    builder.onResolve({ filter: /\/(?:apiAuth|seenitApi|utils|publicMetadataCache|parentalRatingCache)$/ }, args => ({ path: args.path, namespace: 'ports' }));
    builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: `
      const p=()=>globalThis.__ports;
      export const authenticatedFetch=async url=>{p().urls.push(url);const body=p().respond(new URL(url));return {ok:true,status:200,json:async()=>body};};
      export const resolveSeenItApiUrl=path=>'https://fixture.invalid'+path;
      export const adjustTMDBShowDataForEurope=()=>{};export const adjustTMDBSeasonDataForEurope=()=>{};
      export const readParentalRatingCache=()=>null;export const writeParentalRatingCache=()=>{};
      export const normalizePublicMetadataRequestKey=value=>String(value);
      export const isPublicMetadataFallbackStatus=()=>false;
      export const readPublicMetadataCache=async()=>null;export const writePublicMetadataCache=()=>{};
      export const runPublicMetadataSingleFlight=(_f,_k,load)=>load();
    ` }));
  } }] });
  const ports = { urls: [] as string[], respond: responses };
  const module = { exports: {} as {
    tmdb: { getTrending: (type: string, page: number) => Promise<{ ok: boolean; value: { results: Media[] } }>; getPopular: (type: string, page: number) => Promise<{ ok: boolean; value: { results: Media[] } }> };
    explorerRecencyParams: (type: 'tv' | 'movie', now?: Date) => string;
    mergeTrendingWindows: (day: Media[], week: Media[]) => Media[];
    EXPLORER_TRENDING_MIN_VOTES: number;
  } };
  vm.runInContext(bundle.outputFiles[0].text, vm.createContext({ module, __ports: ports, URL, console, setTimeout, clearTimeout, structuredClone }));
  return { ports, exports: module.exports };
}

test('SEENIT-DISCOVER-007 #853 la tendance du jour passe d’abord et une sortie récente n’est plus écartée', async () => {
  const day = [{ id: 1, media_type: 'movie', vote_count: 12, title: 'Sortie de la semaine' }, { id: 2, media_type: 'tv', vote_count: 900 }, { id: 9, media_type: 'movie', vote_count: 4 }];
  const week = [{ id: 2, media_type: 'tv', vote_count: 900 }, { id: 3, media_type: 'movie', vote_count: 5000 }];
  const { ports, exports } = await loadTmdbClient(url => ({ results: url.pathname.endsWith('/day') ? day : url.pathname.endsWith('/week') ? week : [], total_pages: 3 }));
  const trending = await exports.tmdb.getTrending('all', 1);
  assert.deepEqual(Array.from(trending.value.results, item => item.id), [1, 2, 3], 'jour puis semaine, sans doublon ; moins de 10 votes écarté');
  assert.equal(exports.EXPLORER_TRENDING_MIN_VOTES, 10);
  assert.ok(ports.urls.some(url => url.includes('/trending/all/day?')) && ports.urls.some(url => url.includes('/trending/all/week?')));

  ports.urls.length = 0;
  await exports.tmdb.getPopular('movie', 2);
  await exports.tmdb.getPopular('tv', 2);
  const [movieUrl, tvUrl] = ports.urls.map(url => new URL(url));
  assert.equal(movieUrl.searchParams.get('vote_count.gte'), '10');
  assert.ok(movieUrl.searchParams.get('primary_release_date.gte'), 'films : sortis depuis 18 mois');
  assert.equal(movieUrl.searchParams.get('first_air_date.gte'), null);
  assert.ok(tvUrl.searchParams.get('air_date.gte') && tvUrl.searchParams.get('air_date.lte'), 'séries : un épisode diffusé ces 60 derniers jours');
  assert.doesNotMatch(tvUrl.search, /2016-01-01/, 'plus de catalogue « populaire depuis 2016 »');

  const now = new Date('2026-11-04T09:00:00Z');
  assert.equal(exports.explorerRecencyParams('movie', now), 'primary_release_date.gte=2025-05-04&primary_release_date.lte=2026-11-04');
  assert.equal(exports.explorerRecencyParams('tv', now), 'air_date.gte=2026-09-05&air_date.lte=2026-11-04');
});

test('SEENIT-DISCOVER-007 #853 le proxy TMDB laisse passer la fenêtre de diffusion des séries', async () => {
  const { buildProviderRequest } = await import('../src/features/providers/mediaProviderBackendCore.ts');
  const url = buildProviderRequest('tmdb', 'discover/tv', { 'air_date.gte': '2026-09-05', 'air_date.lte': '2026-11-04', sort_by: 'popularity.desc' });
  assert.ok(url, 'requête acceptée');
  assert.equal(url!.searchParams.get('air_date.gte'), '2026-09-05');
  assert.ok(buildProviderRequest('tmdb', 'trending/all/day', { language: 'fr-FR', page: '1' }), 'tendance du jour autorisée');
});

/** Module réel explorerHomePages avec sources TMDB simulées. */
async function loadHomePages() {
  const bundle = await build({ entryPoints: ['src/features/discover/explorerHomePages.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [{ name: 'home-ports', setup(builder) {
    builder.onResolve({ filter: /\/shows\/tmdb$|\/cinemaSearchEvidence$/ }, args => ({ path: args.path, namespace: 'ports' }));
    builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: `
      const p=()=>globalThis.__ports;
      const page=(results,total=4)=>({ok:true,value:{results,total_pages:total}});
      export const isMovieAtCinema=()=>false;
      export const tmdb={
        getTrending:async(type,n)=>{p().calls.push('trending:'+type+':'+n);return page([{id:100+n,media_type:'movie',vote_count:30},{id:500,media_type:'person',name:'Personne'}]);},
        getPopular:async(type,n)=>{p().calls.push('popular:'+type+':'+n);if(p().failPopular)return {ok:false,error:new Error('TMDB indisponible')};return page([{id:(type==='tv'?200:300)+n,media_type:type,vote_count:40}]);},
        getPopularPersons:async n=>{p().calls.push('persons:'+n);return page([{id:900,name:'Acteur'}]);},
      };
      export const discoverSeenIt=async options=>{p().calls.push('progressive:'+options.page);return page([]);};
      export const discoverSeenItDirect=async options=>{p().calls.push('direct:'+options.page);return page([]);};
      export const enrichCinemaEvidenceForExplorerLists=async(popular,trending)=>[popular,trending];
    ` }));
  } }] });
  const ports = { calls: [] as string[], failPopular: false };
  const module = { exports: {} as {
    loadExplorerHomePage: (query: Record<string, unknown>, page: number, hooks?: Record<string, unknown>) => Promise<Page>;
    createExplorerHomePrefetch: (load?: unknown, now?: () => number) => { take: (query: Record<string, unknown>, page: number) => Promise<Page> | null; prime: (query: Record<string, unknown>, page: number) => void };
    EXPLORER_PREFETCH_MAX_AGE_MS: number;
  } };
  vm.runInContext(bundle.outputFiles[0].text, vm.createContext({ module, __ports: ports, URL, console, setTimeout, clearTimeout }));
  return { ports, exports: module.exports };
}

const query = { activeCategory: 'Tout', selectedPlatforms: [], selectedGenres: [], pegi: 'Tous', minRating: 'Toutes', movieReleaseAfterYear: 'Toutes', sortBy: 'popular', sortOrder: 'desc', hasActiveFilters: false };

test('SEENIT-DISCOVER-007 #853 les personnes de la tendance restent hors de la grille des titres', async () => {
  const { exports } = await loadHomePages();
  let early: Media[] = [];
  const result = await exports.loadExplorerHomePage(query, 1, { onEarlyTrending: (list: Media[]) => { early = list; } });
  const ids = Array.from(result!.popular!, item => item.id);
  assert.ok(!ids.includes(500), 'pas de carte média (ni appel diffuseurs) pour une personne');
  assert.deepEqual(Array.from(early, item => item.id), [101], 'la tendance s’affiche avant les compléments');
  assert.deepEqual(ids, [101, 201, 301]);
  assert.equal(Array.from(result!.persons!).length, 1, 'les personnes restent dans leur rangée dédiée');
});

test('SEENIT-DISCOVER-007 #853 la page suivante est préparée une fois puis reprise sans nouvel appel', async () => {
  const { ports, exports } = await loadHomePages();
  let clock = 0;
  const prefetch = exports.createExplorerHomePrefetch(undefined, () => clock);
  prefetch.prime(query, 1);
  prefetch.prime(query, 1);
  assert.deepEqual(ports.calls.filter(call => call.endsWith(':2')), ['trending:all:2', 'popular:tv:2', 'popular:movie:2', 'persons:2'], 'page 2 demandée une seule fois, sans rappel anticipé');
  const page2 = prefetch.take(query, 2);
  assert.ok(page2, 'la page atteinte reprend la page préparée');
  assert.deepEqual(Array.from((await page2)!.popular!, item => item.id), [102, 202, 302]);
  assert.equal(prefetch.take(query, 2), null, 'consommée une seule fois');
  const callsBefore = ports.calls.length;

  prefetch.prime(query, 2);
  assert.equal(prefetch.take({ ...query, activeCategory: 'Films' }, 3), null, 'un changement de catégorie vide la fenêtre');
  prefetch.prime(query, 3);
  clock += exports.EXPLORER_PREFETCH_MAX_AGE_MS + 1;
  assert.equal(prefetch.take(query, 4), null, 'une page préparée depuis plus de 10 min est rechargée');
  assert.ok(ports.calls.length > callsBefore);

  ports.calls.length = 0;
  prefetch.prime({ ...query, pegi: '12', hasActiveFilters: true }, 1);
  prefetch.prime({ ...query, activeCategory: 'Personnes' }, 1);
  assert.deepEqual(ports.calls, [], 'filtre d’âge (anticipation dédiée) et Personnes : pas de préchargement ici');
});

test('SEENIT-DISCOVER-007 #853 le filtre d’âge résout en avance les âges de la page suivante', async () => {
  const bundle = await build({ entryPoints: ['src/features/discover/progressiveAgeFilter.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [{ name: 'age-ports', setup(builder) {
    builder.onResolve({ filter: /\/(?:apiAuth|parentalRatingStore|tmdbCore|tmdbClient|parentalRatingCache)$/ }, args => ({ path: args.path, namespace: 'ports' }));
    builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: `
      export const authenticatedFetch=async()=>({ok:false});
      export const getParentalRatingOverride=()=>null;export const getParentalRatingOverridesSnapshot=()=>({});
      export const discoverSeenIt=async()=>({ok:true,value:{results:[]}});export const tmdb={};
      export const readParentalRatingCache=()=>null;export const writeParentalRatingCache=()=>{};
    ` }));
  } }] });
  const module = { exports: {} as { createProgressiveAgeDiscover: (deps: Record<string, unknown>) => (options: Record<string, unknown>) => Promise<{ ok: boolean; value: { results: Media[] } }> } };
  vm.runInContext(bundle.outputFiles[0].text, vm.createContext({ module, URL, console, setTimeout, clearTimeout, queueMicrotask, AbortController, TextDecoder }));
  const resolved: Array<{ pages: number[]; signal: AbortSignal }> = [];
  let releaseWarm: () => void = () => {};
  const warmGate = new Promise<void>(done => { releaseWarm = done; });
  const progressive = module.exports.createProgressiveAgeDiscover({
    discover: async (options: { page: number }) => ({ ok: true, value: { results: [1, 2].map(i => ({ id: options.page * 10 + i, media_type: 'tv' })), total_pages: 9 } }),
    resolveBatch: async (items: Media[], signal: AbortSignal) => {
      const pages = [...new Set(items.map(item => Math.floor(item.id / 10)))];
      resolved.push({ pages, signal });
      if (pages[0] === 2 && resolved.filter(call => call.pages[0] === 2).length === 1) await warmGate;
      return new Map(items.map(item => [`tv:${item.id}`, { content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-PG' }] } }]));
    },
  });
  const flush = () => new Promise(done => setTimeout(done, 5));
  const pagesSeen = () => [...new Set(resolved.map(call => call.pages[0]))];
  const callsFor = (page: number) => resolved.filter(call => call.pages[0] === page).length;

  const page1 = await progressive({ type: 'tv', page: 1, pegi: '12' });
  assert.deepEqual(Array.from(page1.value.results, item => item.id), [11, 12]);
  await flush();
  assert.deepEqual(pagesSeen(), [1, 2], 'les âges de la page 2 partent dès que la page 1 est affichée');
  assert.equal(resolved.find(call => call.pages[0] === 2)!.pages.length, 1);

  const page2 = progressive({ type: 'tv', page: 2, pegi: '12' });
  await flush();
  assert.equal(callsFor(2), 1, 'la page 2 atteinte attend la résolution déjà en cours au lieu d’ouvrir un second flux');
  releaseWarm();
  assert.deepEqual(Array.from((await page2).value.results, item => item.id), [21, 22]);
  await flush();
  const warm3 = resolved.at(-1)!;
  assert.equal(warm3.pages[0], 3, 'puis la page 3 se prépare à son tour');

  await progressive({ type: 'tv', page: 1, pegi: '7' });
  assert.equal(warm3.signal.aborted, true, 'un changement de filtre annule l’anticipation devenue inutile');

  // #855 : filtre d'âge retiré, l'anticipation en cours est annulée elle aussi.
  await flush();
  const warmAfterSeven = resolved.at(-1)!;
  assert.equal(warmAfterSeven.signal.aborted, false, 'le filtre 7 ans prépare sa propre page suivante');
  await progressive({ type: 'tv', page: 1, pegi: 'Tous' });
  assert.equal(warmAfterSeven.signal.aborted, true, 'sans filtre d’âge, plus aucune résolution anticipée ni quota consommé');
});

test('SEENIT-PROVIDER-002 revue Codex #973 : une page suivante en échec propose « Réessayer » au lieu de finir le défilement', async () => {
  // Filtre Canal+ : l'échec d'une source remonte depuis la découverte fusionnée ; Explorer doit pouvoir redemander la page.
  const { ports, exports } = await loadHomePages();
  ports.failPopular = true;
  const series = { ...query, activeCategory: 'Séries' };
  const next = await exports.loadExplorerHomePage(series, 2);
  assert.equal((next as { pageError?: string | null }).pageError, 'La suite n’a pas pu être chargée.');
  assert.equal(next!.hasMore, false, 'Réessayer recharge la même page, sans en sauter');
  const first = await exports.loadExplorerHomePage(series, 1);
  assert.equal((first as { pageError?: string | null }).pageError, null, 'page 1 : rien d’affiché, pas d’erreur de pagination');
  ports.failPopular = false;
  assert.equal(((await exports.loadExplorerHomePage(series, 2)) as { pageError?: string | null }).pageError, null);
});
