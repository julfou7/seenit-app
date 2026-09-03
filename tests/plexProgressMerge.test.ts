import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Show } from '../src/types.ts';
import { applyPlexLibraryWatchState, mergePlexProgressMutation } from '../src/features/plex/plexProgressMerge.ts';
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

test('SEENIT-PLEX-006 un jamais-vu Plex ne retire pas une action SeenIt', () => {
  const current = makeShow({
    status: 'completed',
    seenEpisodes: ['movie'],
    episodeRecords: { movie: { watchedAt: 500, rating: 9 } }
  });
  const firstObservation = applyPlexLibraryWatchState(current, {
    mediaType: 'movie', tmdbId: 51, watched: false
  });

  assert.equal(firstObservation.changed, true);
  assert.equal(firstObservation.unwatchApplied, false);
  assert.deepEqual(firstObservation.show.seenEpisodes, ['movie']);
  assert.deepEqual(firstObservation.show.episodeRecords, { movie: { watchedAt: 500, rating: 9 } });
  assert.equal(firstObservation.show.plexWatchState?.movie, false);
});

test('SEENIT-PLEX-006 un film manuel reste vu même si Plex avait aussi été observé vu', () => {
  const current = makeShow({
    status: 'completed',
    seenEpisodes: ['movie'],
    episodeRecords: { movie: { watchedAt: 500, rating: 9 } },
    plexWatchState: { movie: true }
  });

  const result = applyPlexLibraryWatchState(current, {
    mediaType: 'movie', tmdbId: 51, watched: false
  });

  assert.equal(result.changed, true);
  assert.equal(result.unwatchApplied, false);
  assert.deepEqual(result.show.seenEpisodes, ['movie']);
  assert.deepEqual(result.show.episodeRecords, { movie: { watchedAt: 500, rating: 9 } });
  assert.equal(result.show.plexWatchState?.movie, false);
  assert.equal(result.show.status, 'completed');
});

test('SEENIT-PLEX-006 une progression legacy sans provenance reste vue par défaut', () => {
  const current = makeShow({
    status: 'completed',
    seenEpisodes: ['movie'],
    episodeRecords: { movie: { watchedAt: 500 } },
    plexWatchState: { movie: true }
  });

  const result = applyPlexLibraryWatchState(current, {
    mediaType: 'movie', tmdbId: 51, watched: false
  });

  assert.equal(result.unwatchApplied, false);
  assert.deepEqual(result.show.seenEpisodes, ['movie']);
});

test('SEENIT-PLEX-006 un dé-vu Plex retire uniquement un film réellement importé par Plex', () => {
  const current = makeShow({
    status: 'completed',
    seenEpisodes: ['movie'],
    episodeRecords: { movie: { watchedAt: 500, rating: 9, plexImported: true } },
    lastWatchedAt: 500,
    isFavorite: true,
    userRating: 9,
    plexWatchState: { movie: true }
  });
  const state = buildPlexLibraryWatchState(
    { type: 'movie', viewCount: 0, Guid: [{ id: 'tmdb://51' }] },
    { mediaType: 'movie' }
  );
  assert.ok(state);

  const result = applyPlexLibraryWatchState(current, state);
  assert.equal(result.changed, true);
  assert.equal(result.unwatchApplied, true);
  assert.deepEqual(result.show.seenEpisodes, []);
  assert.deepEqual(result.show.episodeRecords, {});
  assert.equal(result.show.status, 'plan_to_watch');
  assert.equal(result.show.lastWatchedAt, undefined);
  assert.equal(result.show.isFavorite, true);
  assert.equal(result.show.userRating, 9);
  assert.equal(result.show.plexWatchState?.movie, false);
});

test('SEENIT-PLEX-006 un dé-vu Plex retire uniquement l’épisode Plex visé', () => {
  const current = makeShow({
    mediaType: 'tv',
    status: 'watching',
    seenEpisodes: ['1x1', 'S1E2'],
    episodeRecords: {
      '1x1': { watchedAt: 400, rating: 8 },
      'S1E2': { watchedAt: 700, emotion: 'great', plexImported: true }
    },
    lastWatchedAt: 700,
    plexWatchState: { '1x1': true, '1x2': true }
  });
  const result = applyPlexLibraryWatchState(current, {
    mediaType: 'episode', tmdbId: 51, seasonNumber: 1, episodeNumber: 2, watched: false
  });

  assert.equal(result.changed, true);
  assert.equal(result.unwatchApplied, true);
  assert.deepEqual(result.show.seenEpisodes, ['1x1']);
  assert.deepEqual(result.show.episodeRecords, { '1x1': { watchedAt: 400, rating: 8 } });
  assert.equal(result.show.lastWatchedAt, 400);
  assert.equal(result.show.status, 'watching');
  assert.equal(result.show.plexWatchState?.['1x2'], false);
});

test('SEENIT-PLEX-006 une preuve vue ne passe pas par le chemin de dé-vu', () => {
  const current = makeShow({ status: 'completed', seenEpisodes: ['movie'] });
  const result = applyPlexLibraryWatchState(current, {
    mediaType: 'movie', tmdbId: 51, watched: true
  });
  assert.equal(result.changed, true);
  assert.equal(result.unwatchApplied, false);
  assert.deepEqual(result.show.seenEpisodes, ['movie']);
  assert.equal(result.show.plexWatchState?.movie, true);
});

test('SEENIT-PLEX-006 le dé-vu Plex possédé est idempotent', () => {
  const current = makeShow({
    status: 'completed',
    seenEpisodes: ['movie'],
    episodeRecords: { movie: { watchedAt: 500, plexImported: true } },
    plexWatchState: { movie: true }
  });
  const state = { mediaType: 'movie' as const, tmdbId: 51, watched: false };
  const first = applyPlexLibraryWatchState(current, state);
  const second = applyPlexLibraryWatchState(first.show, state);
  assert.equal(first.unwatchApplied, true);
  assert.equal(second.changed, false);
  assert.equal(second.unwatchApplied, false);
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
    episodeRecords: {
      '1x1': { watchedAt: 400 },
      '1x2': { watchedAt: 500, plexImported: true }
    },
    plexWatchState: { '1x1': true, '1x2': true }
  });
  const candidate = makeShow({
    mediaType: 'tv', status: 'watching', seenEpisodes: ['1x1'],
    episodeRecords: { '1x1': { watchedAt: 400 } },
    plexWatchState: { '1x1': true, '1x2': false }
  });
  const current = makeShow({
    mediaType: 'tv', status: 'watching', seenEpisodes: ['1x1', '1x2', '1x3'],
    episodeRecords: {
      '1x1': { watchedAt: 400 },
      '1x2': { watchedAt: 500, plexImported: true },
      '1x3': { watchedAt: 900, rating: 10 }
    },
    plexWatchState: { '1x1': true, '1x2': true },
    userRating: 8
  });

  const merged = mergePlexProgressMutation(current, baseline, candidate);
  assert.deepEqual(merged.seenEpisodes, ['1x1', '1x3']);
  assert.equal(merged.episodeRecords['1x2'], undefined);
  assert.deepEqual(merged.episodeRecords['1x3'], { watchedAt: 900, rating: 10 });
  assert.equal(merged.userRating, 8);
  assert.equal(merged.lastWatchedAt, 900);
  assert.equal(merged.plexWatchState?.['1x2'], false);
});

test('SEENIT-PLEX-006 le runtime marque la provenance Plex et ne notifie qu’un vrai retrait', () => {
  const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const syncSource = readFileSync(new URL('../src/features/plex/syncPlex.ts', import.meta.url), 'utf8');
  assert.match(serverSource, /supportsPlexOwnedUnwatch/);
  assert.match(serverSource, /state\.watched !== false/);
  assert.match(syncSource, /plexImported:\s*true/);
  assert.match(syncSource, /if \(!result\.unwatchApplied\) continue;/);
  assert.match(syncSource, /mergePlexProgressMutation/);
  assert.match(syncSource, /transaction\.set\(ref, cleanData\);/);
});
