import test from 'node:test';
import assert from 'node:assert/strict';
import { searchHighlight, searchLibrary, searchMediaKey, librarySearchStatus } from '../src/features/discover/searchPresentation.ts';
import { filterRemoteSearch } from '../src/features/discover/searchRemoteFilters.ts';
import type { Show } from '../src/types.ts';
import type { TMDBMedia } from '../src/features/shows/tmdbClient.ts';

test('SEENIT-DISCOVER-003 E-13 bibliothèque instantanée et surlignage des accents composés', () => {
  const show = { title: 'Les Atréides', mediaType: 'tv', seenEpisodes: [], status: 'plan_to_watch' } as Show;
  assert.equal(searchLibrary([show], 'atre').length, 1);
  assert.deepEqual(searchHighlight(show.title, 'ATRE'), ['Les ', 'Atré', 'ides']);
  assert.deepEqual(searchHighlight('Atréides', 'éides'), ['Atr', 'éides', '']);
  assert.deepEqual(searchHighlight('Atre\u0301ides', 'atre'), ['', 'Atre\u0301', 'ides']);
  assert.deepEqual(searchHighlight('Sans rapport', 'autre'), ['Sans rapport', '', '']);
  assert.equal(searchLibrary([show], '').length, 0);
  assert.equal(librarySearchStatus(show), 'À commencer');
  assert.notEqual(searchMediaKey(42, 'movie'), searchMediaKey(42, 'tv'));
  assert.equal(searchMediaKey(42, 'series'), searchMediaKey(42, 'tv'));
});

test('SEENIT-DISCOVER-003 E-14 filtres TMDB indépendants de la bibliothèque, inconnus exclus et concurrence bornée', async () => {
  const items = Array.from({ length: 16 }, (_, i) => ({ id: i + 1, media_type: 'tv' })) as TMDBMedia[];
  items.push({ id: 99, media_type: 'person', name: 'Acteur' } as TMDBMedia);
  let active = 0, maximum = 0;
  const ports = {
    ratings: async () => new Map(items.filter(item => item.id !== 3).map(item => [searchMediaKey(item.id, item.media_type), { content_ratings: { results: [{ iso_3166_1: 'US', rating: item.id === 2 ? 'TV-MA' : 'TV-PG' }] } }])),
    providerIds: async (item: TMDBMedia) => {
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 2)); active--;
      return item.id === 1 ? [8] : [119];
    },
  };
  const result = await filterRemoteSearch(items, 'age:13', ['netflix'], ports);
  assert.deepEqual(result.map(item => item.id), [1, 99]);
  assert.ok(maximum <= 4);
  let calls = 0;
  assert.equal((await filterRemoteSearch(items, 'Tous', [], { ratings: async () => { calls++; return new Map(); }, providerIds: async () => { calls++; return []; } })).length, items.length);
  assert.equal(calls, 0, 'aucune preuve réseau sans filtre strict');
  const controller = new AbortController(); controller.abort();
  assert.deepEqual(await filterRemoteSearch(items, 'Tous', ['netflix'], ports, controller.signal), []);
});
