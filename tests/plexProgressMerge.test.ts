import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Show } from '../src/types.ts';
import { applyExplicitPlexUnwatch, mergePlexProgressMutation } from '../src/features/plex/plexProgressMerge.ts';
import { buildPlexLibraryWatchState, mergePlexLibraryWatchStates } from '../src/features/plex/plexLibraryWatchState.ts';

function makeShow(overrides: Partial<Show> = {}): Show {
  return {
    id: 'show-1',
    userId: 'user-1',
    tmdbId: 51,
    title: 'Fixture Plex bidirectionnelle',
    mediaType: 'movie',
    posterPath: null,
    backdropPath: null,
    status: 'plan_to_watch',
    isArchived: false,
    updatedAt: 100,
    createdAt: 10,
    seenEpisodes: [],
    episodeRecords: {},
    ...overrides
  };
}

test('SEENIT-PLEX-006 un dé-vu Plex retire un film vu dans SeenIt', () => {
  const current = makeShow({
    status: 'completed',
    seenEpisodes: ['movie'],
    episodeRecords: { movie: { watchedAt: 500, rating: 9 } },
    lastWatchedAt: 500,
    isFavorite: true,
    userRating: 9
  });
  const state = buildPlexLibraryWatchState(
    { type: 'movie', viewCount: 0, Guid: [{ id: 'tmdb://51' }] },
    { mediaType: 'movie' }
  );
  assert.ok(state);

  const result = applyExplicitPlexUnwatch(current, state);
  assert.equal(result.changed, true);
  assert.deepEqual(result.show.seenEpisodes, []);
  assert.deepEqual(result.show.episodeRecords, {});
  assert.equal(result.show.status, 'plan_to_watch');
  assert.equal(result.show.lastWatchedAt, undefined);
  assert.equal(result.show.isFavorite, true);
  assert.equal(result.show.userRating, 9);
});

test('SEENIT-PLEX-006 un dé-vu Plex retire uniquement l’épisode visé', () => {
  const current = makeShow({
    mediaType: 'tv',
    status: 'watching',
    seenEpisodes: ['1x1', 'S1E2'],
    episodeRecords: {
      '1x1': { watchedAt: 400, rating: 8 },
      'S1E2': { watchedAt: 700, emotion: 'great' }
    },
    lastWatchedAt: 700
  });
  const result = applyExplicitPlexUnwatch(current, {
    mediaType: 'episode', tmdbId: 51, seasonNumber: 1, episodeNumber: 2, watched: false
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.show.seenEpisodes, ['1x1']);
  assert.deepEqual(result.show.episodeRecords, { '1x1': { watchedAt: 400, rating: 8 } });
  assert.equal(result.show.lastWatchedAt, 400);
  assert.equal(result.show.status, 'watching');
});

test('SEENIT-PLEX-006 une preuve vue ne passe pas par le chemin de dé-vu', () => {
  const current = makeShow({ status: 'completed', seenEpisodes: ['movie'] });
  const result = applyExplicitPlexUnwatch(current, {
    mediaType: 'movie', tmdbId: 51, watched: true
  });
  assert.equal(result.changed, false);
  assert.equal(result.show, current);
});

test('SEENIT-PLEX-006 le dé-vu est idempotent', () => {
  const current = makeShow({ status: 'completed', seenEpisodes: ['movie'], episodeRecords: { movie: { watchedAt: 500 } } });
  const state = { mediaType: 'movie' as const, tmdbId: 51, watched: false };
  const first = applyExplicitPlexUnwatch(current, state);
  const second = applyExplicitPlexUnwatch(first.show, state);
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
});

test('SEENIT-PLEX-006 une copie vue gagne sur une copie non vue du même média', () => {
  const merged = mergePlexLibraryWatchStates([
    { mediaType: 'movie', tmdbId: 51, watched: false, serverId: 'a' },
    { mediaType: 'movie', tmdbId: 51, watched: true, serverId: 'b' }
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].watched, true);
});

test('SEENIT-PLEX-006 la transaction conserve une action concurrente SeenIt non visée', () => {
  const baseline = makeShow({
    mediaType: 'tv', status: 'watching', seenEpisodes: ['1x1', '1x2'],
    episodeRecords: { '1x1': { watchedAt: 400 }, '1x2': { watchedAt: 500 } }
  });
  const candidate = makeShow({
    mediaType: 'tv', status: 'watching', seenEpisodes: ['1x1'],
    episodeRecords: { '1x1': { watchedAt: 400 } }
  });
  const current = makeShow({
    mediaType: 'tv', status: 'watching', seenEpisodes: ['1x1', '1x2', '1x3'],
    episodeRecords: { '1x1': { watchedAt: 400 }, '1x2': { watchedAt: 500 }, '1x3': { watchedAt: 900, rating: 10 } },
    userRating: 8
  });

  const merged = mergePlexProgressMutation(current, baseline, candidate);
  assert.deepEqual(merged.seenEpisodes, ['1x1', '1x3']);
  assert.equal(merged.episodeRecords['1x2'], undefined);
  assert.deepEqual(merged.episodeRecords['1x3'], { watchedAt: 900, rating: 10 });
  assert.equal(merged.userRating, 8);
  assert.equal(merged.lastWatchedAt, 900);
});

test('SEENIT-PLEX-006 le runtime transmet les états courants et remplace les cartes supprimées', () => {
  const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const syncSource = readFileSync(new URL('../src/features/plex/syncPlex.ts', import.meta.url), 'utf8');
  assert.match(serverSource, /libraryWatchStates/);
  assert.match(syncSource, /applyExplicitPlexUnwatch/);
  assert.match(syncSource, /mergePlexProgressMutation/);
  assert.match(syncSource, /transaction\.set\(ref, cleanData\);/);
});
