import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { canalOriginDiscoverVariant, mergeCanalOriginDiscover, pageCanalOriginDiscover } from '../src/features/providers/canalOriginDiscover.ts';

test('SEENIT-PROVIDER-002 retour v1.4.303 : la puce Canal+ d’Explorer inclut les séries dont Canal+ est la chaîne d’origine', () => {
  // « Si Canal+ est le diffuseur d’origine, Canal+ le restera » : la découverte TMDB filtrée sur Canal+ (381)
  // est complétée par le réseau Canal+ (285), pour les séries seulement.
  const tv = new URL('https://seenit.invalid/api/media/tmdb/discover/tv?language=fr-FR&sort_by=popularity.desc&watch_region=FR&with_watch_providers=8|381&page=2');
  const variant = canalOriginDiscoverVariant(tv);
  assert.ok(variant);
  assert.equal(variant.searchParams.get('with_networks'), '285');
  assert.equal(variant.searchParams.get('with_watch_providers'), null);
  assert.equal(variant.searchParams.get('watch_region'), null);
  assert.equal(variant.searchParams.get('page'), '2');
  assert.equal(variant.searchParams.get('sort_by'), 'popularity.desc');
  assert.equal(canalOriginDiscoverVariant(new URL('https://seenit.invalid/api/media/tmdb/discover/movie?with_watch_providers=381')), null, 'films : pas de chaîne d’origine');
  assert.equal(canalOriginDiscoverVariant(new URL('https://seenit.invalid/api/media/tmdb/discover/tv?with_watch_providers=8')), null, 'sans Canal+ : requête inchangée');
  assert.equal(canalOriginDiscoverVariant(variant), null, 'la requête complémentaire ne s’appelle pas elle-même');

  const merged = mergeCanalOriginDiscover(
    { results: [{ id: 1, popularity: 50 }, { id: 2, popularity: 10 }], total_pages: 3, total_results: 40 },
    { results: [{ id: 335510, popularity: 30 }, { id: 2, popularity: 10 }], total_pages: 5, total_results: 90 },
    'popularity.desc',
  );
  assert.deepEqual(merged.results?.map(item => item.id), [1, 335510, 2], 'union sans doublon, dans l’ordre de tri');
  assert.equal(merged.total_pages, 5);
  // Revue Codex #973 : champ et sens de tri respectés (dates, titres, ordre croissant), valeur absente en fin de liste.
  const primary = { results: [{ id: 1, first_air_date: '2020-01-01', name: 'Bravo', vote_average: 8 }, { id: 2, first_air_date: '', name: 'Alpha', vote_average: 6 }] };
  const origin = { results: [{ id: 3, first_air_date: '2026-09-23', name: 'Le Gang des souris vertes', vote_average: 7 }] };
  assert.deepEqual(mergeCanalOriginDiscover(primary, origin, 'first_air_date.desc').results?.map(item => item.id), [3, 1, 2]);
  assert.deepEqual(mergeCanalOriginDiscover(primary, origin, 'first_air_date.asc').results?.map(item => item.id), [1, 3, 2]);
  assert.deepEqual(mergeCanalOriginDiscover(primary, origin, 'vote_average.asc').results?.map(item => item.id), [2, 3, 1]);
  assert.deepEqual(mergeCanalOriginDiscover(primary, origin, 'name.asc').results?.map(item => item.id), [2, 1, 3]);
  assert.deepEqual(mergeCanalOriginDiscover(primary, origin, null).results?.map(item => item.id), [1, 2, 3], 'défaut popularity.desc, sans popularité : ordre stable');

  // Revue Codex #973 : pagination de l'union triée. Catalogue page 1 = 100..81, page 2 = 80..61 ; réseau page 1 = 10..1.
  const catalog = (start: number) => ({ results: Array.from({ length: 20 }, (_, index) => ({ id: start - index, popularity: start - index })), total_pages: 2, total_results: 40 });
  const network = { results: Array.from({ length: 10 }, (_, index) => ({ id: 1000 + index, popularity: 10 - index })), total_pages: 1, total_results: 10 };
  const page1 = pageCanalOriginDiscover([catalog(100)], [network], 'popularity.desc', 1);
  const page2 = pageCanalOriginDiscover([catalog(100), catalog(80)], [network, { results: [] }], 'popularity.desc', 2);
  const page3 = pageCanalOriginDiscover([catalog(100), catalog(80), { results: [] }], [network, { results: [] }, { results: [] }], 'popularity.desc', 3);
  assert.deepEqual(page1.results?.map(item => item.popularity), Array.from({ length: 20 }, (_, index) => 100 - index));
  assert.deepEqual(page2.results?.map(item => item.popularity), Array.from({ length: 20 }, (_, index) => 80 - index), 'le catalogue mieux classé passe avant le réseau');
  assert.deepEqual(page3.results?.map(item => item.popularity), Array.from({ length: 10 }, (_, index) => 10 - index));
  assert.equal(new Set([...page1.results!, ...page2.results!, ...page3.results!].map(item => item.id)).size, 50, 'aucun doublon entre pages');
  assert.equal(page1.total_pages, 3);

  const client = readFileSync(new URL('../src/features/shows/tmdbClient.ts', import.meta.url), 'utf8');
  assert.match(client, /const originUrl = canalOriginDiscoverVariant\(requestUrl\);/);
  assert.match(client, /pageCanalOriginDiscover\(primaryOk, originOk\.length === page \? originOk : \[\], sortBy, page\)/);
  assert.match(client, /Array\.from\(\{ length: page \}, \(_, index\) => index \+ 1\)/);
  assert.match(readFileSync(new URL('../src/features/providers/mediaProviderBackendCore.ts', import.meta.url), 'utf8'), /'with_watch_providers', 'with_networks',/);
});
