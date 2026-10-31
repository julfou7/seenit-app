import assert from 'node:assert/strict';
import test from 'node:test';
import type { Show } from '../src/types.ts';
import type { CharacterRecord } from '../src/features/discover/characters.ts';
import type { ActorIndex } from '../src/features/people/movieActors.ts';
import {
  CHARACTER_SEARCH_CONCURRENCY,
  buildCachedTrackedCharacterResults,
  buildCharacterSearchBatchesFromKeys,
  orderedCharacterSearchKeys,
  preferredCharacterSearchKeysFromActorIndex,
  runCharacterSearchBatches,
  sortCharacterSearchResults,
} from '../src/features/discover/characterSearch.ts';

function show(tmdbId: number, overrides: Partial<Show> = {}): Show {
  return {
    id: `show-${tmdbId}`,
    userId: 'user-a',
    tmdbId,
    title: `Show ${tmdbId}`,
    mediaType: 'tv',
    posterPath: null,
    backdropPath: null,
    status: 'completed',
    isArchived: false,
    updatedAt: tmdbId,
    createdAt: tmdbId,
    seenEpisodes: [],
    episodeRecords: {},
    ...overrides,
  };
}

function character(name: string, workKey: string): CharacterRecord {
  return {
    id: `universe:${name.toLowerCase()}`,
    name,
    aliases: [name],
    universe: 'Univers test',
    universeId: 'universe',
    seed: workKey,
    actors: [],
    works: [{ key: workKey, id: Number(workKey.split(':')[1]), type: 'tv', title: workKey, poster: null, creditCount: 1 }],
  };
}

test('SEENIT-DISCOVER-004 priorise les séries suivies actives avant le tri technique TMDB', () => {
  const shows = Array.from({ length: 20 }, (_, index) => show(1000 + index, { status: 'plan_to_watch' }));
  shows.push(show(44217, { title: 'Vikings', status: 'watching', lastWatchedAt: 50_000, updatedAt: 50_000 }));
  shows.push(show(99999, { title: 'Favori', status: 'completed', isFavorite: true, updatedAt: 40_000 }));

  const keys = orderedCharacterSearchKeys(shows);
  assert.equal(keys[0], 'tv:44217');
  assert.equal(keys[1], 'tv:99999');

  const batches = buildCharacterSearchBatchesFromKeys(keys);
  assert.equal(batches[0].length, 8);
  assert.equal(batches[0][0], 'tv:44217');
  assert.ok(batches.slice(1).every(batch => batch.length <= 16));
});

test('terrain v1.4.234 : un rôle connu localement sort Vikings du fond de bibliothèque avant le réseau', () => {
  const shows = Array.from({ length: 80 }, (_, index) => show(1000 + index, { status: 'completed', updatedAt: 80_000 - index }));
  shows.push(show(44217, { title: 'Vikings', status: 'completed', updatedAt: 1, lastWatchedAt: 1 }));
  const actorIndex: ActorIndex = {
    43943: {
      name: 'Travis Fimmel',
      profile_path: '/travis.jpg',
      seen: [{ mediaType: 'tv', tmdbId: 44217, title: 'Vikings', posterPath: null, backdropPath: null, character: 'Ragnar Lothbrok', episodes: 49, minutes: 2205 }],
    },
  };

  const preferred = preferredCharacterSearchKeysFromActorIndex(actorIndex, 'Ragnar');
  assert.deepEqual(preferred, ['tv:44217']);
  const keys = orderedCharacterSearchKeys(shows, preferred);
  assert.equal(keys[0], 'tv:44217');
  const batches = buildCharacterSearchBatchesFromKeys(keys, preferred.length);
  assert.deepEqual(batches[0], ['tv:44217'], 'le média prouvé localement ne doit plus attendre un lot de 8/16 titres');
});

test('terrain v1.4.234 : le cache TMDB suivi produit Ragnar Lothbrok sans attendre le scan réseau', () => {
  const vikings = show(44217, { title: 'Vikings', status: 'completed', firstAirDate: '2013-03-03', updatedAt: 1 });
  const metadata = new Map<string, unknown>([['tv:44217', {
    aggregate_credits: { cast: [
      { id: 43943, name: 'Travis Fimmel', profile_path: '/travis.jpg', roles: [{ character: 'Ragnar Lothbrok', episode_count: 49 }] },
      { id: 12572, name: 'Katheryn Winnick', profile_path: '/katheryn.jpg', roles: [{ character: 'Lagertha', episode_count: 71 }] },
    ] },
  }]]);

  const results = buildCachedTrackedCharacterResults([vikings], metadata, 'Ragnar');
  assert.equal(results.length, 1);
  assert.equal(results[0].name, 'Ragnar Lothbrok');
  assert.equal(results[0].seed, 'tv:44217');
  assert.equal(results[0].actors[0].name, 'Travis Fimmel');
  assert.equal(results[0].works[0].title, 'Vikings');
});

test('SEENIT-DISCOVER-004 classe Ragnar Lothbrok avant une correspondance interne moins pertinente', () => {
  const orderedKeys = ['tv:44217', 'tv:71912'];
  const results = sortCharacterSearchResults([
    character('Earl Ragnar', 'tv:71912'),
    character('Ragnar Lothbrok', 'tv:44217'),
  ], orderedKeys, 'Ragnar');
  assert.equal(results[0].name, 'Ragnar Lothbrok');
  assert.equal(results[1].name, 'Earl Ragnar');
});

test('SEENIT-DISCOVER-004 borne les lots concurrents sans sérialiser toute la bibliothèque', async () => {
  const batches = Array.from({ length: 7 }, (_, index) => [`tv:${index + 1}`]);
  let active = 0;
  let maxActive = 0;
  const completed: number[] = [];
  await runCharacterSearchBatches(
    batches,
    async (_batch, index) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>(resolve => setImmediate(resolve));
      active -= 1;
      return index;
    },
    value => completed.push(value),
    new AbortController().signal,
  );
  assert.equal(maxActive, CHARACTER_SEARCH_CONCURRENCY);
  assert.deepEqual(completed.sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6]);
});
