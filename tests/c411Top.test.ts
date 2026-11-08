import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { buildC411TopParams, c411TmdbIdentity, parseC411TopRelease, rankC411TopMedia } from '../src/features/downloads/c411Top.ts';
import { C411TopError, fetchC411TopMedia } from '../src/features/downloads/c411Backend.ts';

// #900 — décision du propriétaire du 08/11 : « Un filtre dans Explorer, car au final c'est presque plus pertinent
// que TMDB parfois. »
const read = (path: string) => readFileSync(path, 'utf8');
const hash = (index: number) => index.toString(16).padStart(40, '0');
const release = (index: number, seeders: number, tmdb?: { id: number; type?: string }, subcat?: number) => ({
  id: index, infoHash: hash(index), name: `Release.${index}.1080p`, seeders,
  ...(tmdb ? { metadata: { tmdbData: tmdb } } : {}), ...(subcat ? { subcategory: { id: subcat } } : {}),
});

test('SEENIT-C411-004 identité TMDB exacte lue dans les métadonnées C411, jamais le titre', () => {
  assert.deepEqual(c411TmdbIdentity(release(1, 5, { id: 550, type: 'movie' })), { mediaType: 'movie', tmdbId: 550 });
  assert.deepEqual(c411TmdbIdentity(release(2, 5, { id: 1399 }, 7)), { mediaType: 'tv', tmdbId: 1399 }, 'type par la sous-catégorie explicite');
  assert.equal(c411TmdbIdentity(release(3, 5, { id: 550, type: 'movie' }, 7)), null, 'désaccord type/sous-catégorie : écartée');
  assert.equal(c411TmdbIdentity(release(4, 5, { id: 550 })), null, 'type inconnu : écartée');
  assert.equal(c411TmdbIdentity({ name: 'Dune.Part.Two.2024.1080p', seeders: 900 }), null, 'un nom de release seul ne rattache jamais une fiche');
  assert.equal(c411TmdbIdentity(release(5, 5, { id: -3, type: 'movie' })), null);
  const params = buildC411TopParams('tv', 2);
  assert.equal(params.toString(), 'category=1&sortBy=seeders&sortOrder=desc&page=2&perPage=100&viewMode=flat&subcat=7');
  assert.equal(buildC411TopParams('videos', 1).has('subcat'), false);
});

test('SEENIT-C411-004 un titre par identité exacte, au rang de sa release la plus partagée', () => {
  const releases = [release(1, 40, { id: 1, type: 'movie' }), release(2, 900, { id: 2, type: 'tv' }), release(3, 300, { id: 1, type: 'movie' }), release(4, 700), release(5, 300, { id: 3, type: 'movie' })]
    .map(item => parseC411TopRelease(item)!);
  const { entries, unresolved } = rankC411TopMedia(releases);
  assert.deepEqual(entries, [
    { mediaType: 'tv', tmdbId: 2, rank: 1, seeders: 900, releases: 1 },
    { mediaType: 'movie', tmdbId: 1, rank: 2, seeders: 300, releases: 2 },
    { mediaType: 'movie', tmdbId: 3, rank: 3, seeders: 300, releases: 1 },
  ], 'ex æquo : ordre de C411 ; plusieurs versions d’un titre comptées une fois');
  assert.equal(unresolved, 1);
  assert.equal(parseC411TopRelease({ name: 'X', seeders: -1, infoHash: hash(9) }), null, 'seeders invalides');
});

test('SEENIT-C411-004 serveur : pages de C411, détail des releases sans identité (cache), pannes distinctes', async () => {
  const calls: string[] = [];
  const page = (offset: number) => Array.from({ length: 25 }, (_, index) => release(offset + index, 1000 - offset - index, (offset + index) % 2 ? { id: offset + index, type: 'movie' } : undefined));
  const fetcher = (async (url: string) => {
    calls.push(url);
    const json = (body: unknown, status = 200) => ({ ok: status < 400, status, headers: new Headers(), json: async () => body }) as unknown as Response;
    if (url.includes('/api/torrents/')) return json({ data: { metadata: { tmdbData: { id: 777, type: 'tv' } } } });
    const number = Number(new URL(url).searchParams.get('page'));
    return json({ data: page((number - 1) * 25), meta: { perPage: 25, totalPages: 9 } });
  }) as typeof fetch;
  const cache = new Map();
  const signal = () => new AbortController().signal;
  const top = await fetchC411TopMedia({ apiKey: 'k', scope: 'videos', signal, fetcher, identityCache: cache });
  assert.equal(top.scanned, 100, 'quatre pages de 25 : 100 releases');
  assert.equal(calls.filter(url => url.includes('/api/torrents?')).length, 4);
  assert.equal(calls.filter(url => url.includes('/api/torrents/')).length, 30, 'détail des 30 premières sans identité, pas plus');
  assert.ok(top.entries.some(entry => entry.mediaType === 'tv' && entry.tmdbId === 777));
  calls.length = 0;
  await fetchC411TopMedia({ apiKey: 'k', scope: 'videos', signal, fetcher, identityCache: cache });
  assert.equal(calls.filter(url => url.includes('/api/torrents/')).length, 0, 'identité d’une release en cache : pas relue');

  const failing = (status: number, body: unknown = {}) => (async () => ({ ok: status < 400, status, headers: new Headers({ 'retry-after': '30' }), json: async () => body })) as unknown as typeof fetch;
  for (const [status, body, code] of [[401, {}, 'C411_AUTH_REJECTED'], [429, {}, 'C411_RATE_LIMITED'], [503, {}, 'C411_UNAVAILABLE'], [200, { error: 'x' }, 'C411_INVALID_RESPONSE']] as const) {
    await assert.rejects(fetchC411TopMedia({ apiKey: 'k', scope: 'movie', signal, fetcher: failing(status, body) }), (error: unknown) => error instanceof C411TopError && error.code === code, code);
  }
  const route = read('server.ts');
  assert.match(route, /app\.post\('\/api\/c411\/top', requireAuth, rateLimit\('c411-top', 6, 60_000\)/);
  assert.match(route, /configSnapshot\.get\('downloadsEnabled'\) !== true\) return res\.status\(403\)\.json\(\{ code: 'DOWNLOADS_DISABLED'/);
  assert.match(route, /if \(!apiKey\) return res\.status\(409\)\.json\(\{ code: 'C411_NOT_CONFIGURED'/);
  assert.match(route, /return res\.json\(\{ scope, items: top\.entries, unresolved: top\.unresolved, scanned: top\.scanned \}\);/, 'jamais la clé ni les releases brutes');
});

test('SEENIT-C411-004 Explorer : catégorie sous le réglage Téléchargements, fiches TMDB exactes, panne dite', async () => {
  const bundle = await build({ entryPoints: ['src/features/discover/c411TopMedia.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'top-ports', setup(builder) {
      builder.onResolve({ filter: /shows\/tmdb$|services\/c411$/ }, args => ({ path: args.path, namespace: 'ports' }));
      builder.onLoad({ filter: /.*/, namespace: 'ports' }, args => ({ contents: args.path.endsWith('tmdb')
        ? `export const tmdb={getMediaDetails:async(id,type)=>id===404?{ok:false}:{ok:true,value:{id,title:type==='movie'?'Film '+id:undefined,name:type==='tv'?'Série '+id:undefined,poster_path:'/p'+id+'.jpg',genres:[{id:18}],vote_average:7}}};`
        : 'export const getC411Top=async()=>{throw new Error("unused")};' }));
    } }] });
  const module = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`) as { loadC411TopMedia: (isCurrent: () => boolean, load: () => Promise<unknown>) => Promise<{ media: Array<Record<string, unknown>>; notice: string | null }> };
  const top = await module.loadC411TopMedia(() => true, async () => ({ unresolved: 2, items: [
    { mediaType: 'tv', tmdbId: 1399, rank: 1, seeders: 2400, releases: 3 }, { mediaType: 'movie', tmdbId: 404, rank: 2, seeders: 900, releases: 1 }, { mediaType: 'movie', tmdbId: 550, rank: 3, seeders: 500, releases: 1 }] }));
  assert.deepEqual(top.media.map(item => [item.media_type, item.id, item.name || item.title, (item.seenitC411 as { rank: number }).rank]), [['tv', 1399, 'Série 1399', 1], ['movie', 550, 'Film 550', 3]], 'fiche introuvable écartée sans décaler les rangs');
  assert.deepEqual(top.media[0].genre_ids, [18], 'genres disponibles pour les filtres d’Explorer');
  assert.equal(top.notice, null);
  assert.equal((await module.loadC411TopMedia(() => true, async () => { throw new Error('Clé C411 refusée.'); })).notice, 'Clé C411 refusée.', 'une panne est dite, jamais une grille vide muette');

  const screen = read('src/screens/DiscoverScreen.tsx');
  assert.match(screen, /const c411Available = useDownloadConfigStore\(state => isDownloadFeatureEnabled\(state\) && Boolean\(state\.c411ApiKey\?\.trim\(\)\)\);/);
  assert.match(screen, /if \(activeCategory === 'Top C411'\) return true;/, 'sans les seuils de popularité ni de date');
  assert.match(read('src/screens/DiscoverViewCore.tsx'), /CATEGORIES\.filter\(category => category\.id !== 'Top C411' \|\| model\.c411Available\)/);
  assert.match(read('src/features/discover/explorerHomePages.ts'), /if \(activeCategory === 'Top C411'\) \{[\s\S]{0,300}loadC411TopMedia\(isCurrent\)/);
  assert.match(read('src/components/GridMediaCard.tsx'), /media\.seenitC411 \? \(/, 'rang et seeders sur la carte');
});
