import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { canalOriginDiscoverVariant, mergeCanalOriginDiscover } from '../src/features/providers/canalOriginDiscover.ts';

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

  const client = readFileSync(new URL('../src/features/shows/tmdbClient.ts', import.meta.url), 'utf8');
  assert.match(client, /const originUrl = canalOriginDiscoverVariant\(requestUrl\);/);
  assert.match(client, /mergeCanalOriginDiscover\(primary\.value, origin\.value, requestUrl\.searchParams\.get\('sort_by'\)\)/);
  assert.match(readFileSync(new URL('../src/features/providers/mediaProviderBackendCore.ts', import.meta.url), 'utf8'), /'with_watch_providers', 'with_networks',/);
});
