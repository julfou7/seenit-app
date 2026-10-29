import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Show } from '../src/types.ts';
import type { CharacterRecord } from '../src/features/discover/characters.ts';
import {
  CHARACTER_SEARCH_CONCURRENCY,
  buildCharacterSearchBatchesFromKeys,
  orderedCharacterSearchKeys,
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

test('le hook Personnages ne rajoute plus un second debounce après celui d’Explorer', () => {
  const source = readFileSync(new URL('../src/hooks/useCharacterSearch.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /setTimeout\s*\(/);
  assert.match(source, /orderedCharacterSearchKeys/);
  assert.match(source, /runCharacterSearchBatches/);
  assert.match(source, /firstBatchSettled/);
});
