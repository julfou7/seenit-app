import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { mergeAdditivePlexProgress } from '../src/features/plex/plexAdditiveSync.ts';
import type { Show } from '../src/types.ts';

function makeShow(overrides: Partial<Show> = {}): Show {
  return {
    id: 'show-1',
    userId: 'user-1',
    tmdbId: 51,
    title: 'Fixture Plex additive',
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

test('SEENIT-PLEX-006 un dé-vu Plex ne retire jamais un film marqué vu dans SeenIt', () => {
  const manualSeenIt = makeShow({
    status: 'completed',
    seenEpisodes: ['movie'],
    episodeRecords: { movie: { watchedAt: 500, rating: 9, emotion: 'great' } },
    lastWatchedAt: 500,
    userRating: 9
  });
  const plexUnwatchedCandidate = makeShow({
    status: 'plan_to_watch',
    seenEpisodes: [],
    episodeRecords: {},
    lastWatchedAt: undefined,
    updatedAt: 200
  });

  const merged = mergeAdditivePlexProgress(manualSeenIt, plexUnwatchedCandidate);

  assert.deepEqual(merged.seenEpisodes, ['movie']);
  assert.deepEqual(merged.episodeRecords.movie, { watchedAt: 500, rating: 9, emotion: 'great' });
  assert.equal(merged.status, 'completed');
  assert.equal(merged.lastWatchedAt, 500);
  assert.equal(merged.userRating, 9);
});

test('SEENIT-PLEX-006 un dé-vu Plex conserve la progression manuelle des épisodes', () => {
  const manualSeenIt = makeShow({
    mediaType: 'tv',
    status: 'watching',
    seenEpisodes: ['1x2'],
    episodeRecords: { '1x2': { watchedAt: 700, rating: 8 } },
    lastWatchedAt: 700
  });
  const plexUnwatchedCandidate = makeShow({
    mediaType: 'tv',
    status: 'plan_to_watch',
    seenEpisodes: [],
    episodeRecords: {},
    updatedAt: 300
  });

  const merged = mergeAdditivePlexProgress(manualSeenIt, plexUnwatchedCandidate);

  assert.deepEqual(merged.seenEpisodes, ['1x2']);
  assert.deepEqual(merged.episodeRecords['1x2'], { watchedAt: 700, rating: 8 });
  assert.equal(merged.status, 'watching');
  assert.equal(merged.lastWatchedAt, 700);
});

test('SEENIT-PLEX-006 une nouvelle preuve Plex s’ajoute sans écraser les données SeenIt', () => {
  const manualSeenIt = makeShow({
    mediaType: 'tv',
    status: 'watching',
    seenEpisodes: ['1x2'],
    episodeRecords: { '1x2': { watchedAt: 700, rating: 8 } },
    lastWatchedAt: 700
  });
  const plexCandidate = makeShow({
    mediaType: 'tv',
    status: 'watching',
    seenEpisodes: ['1x2', '1x3'],
    episodeRecords: {
      '1x2': { watchedAt: 650, episodeTitle: 'Ancienne donnée Plex' },
      '1x3': { watchedAt: 900, episodeTitle: 'Nouvel épisode' }
    },
    lastWatchedAt: 900,
    updatedAt: 900
  });

  const merged = mergeAdditivePlexProgress(manualSeenIt, plexCandidate);

  assert.deepEqual(merged.seenEpisodes, ['1x2', '1x3']);
  assert.deepEqual(merged.episodeRecords['1x2'], { watchedAt: 700, episodeTitle: 'Ancienne donnée Plex', rating: 8 });
  assert.deepEqual(merged.episodeRecords['1x3'], { watchedAt: 900, episodeTitle: 'Nouvel épisode' });
  assert.equal(merged.lastWatchedAt, 900);
});

test('SEENIT-PLEX-006 la fusion additive est idempotente', () => {
  const current = makeShow({
    mediaType: 'tv',
    status: 'watching',
    seenEpisodes: ['1x2'],
    episodeRecords: { '1x2': { watchedAt: 700 } },
    lastWatchedAt: 700
  });
  const candidate = makeShow({
    mediaType: 'tv',
    status: 'watching',
    seenEpisodes: ['1x3'],
    episodeRecords: { '1x3': { watchedAt: 900 } },
    lastWatchedAt: 900,
    updatedAt: 900
  });

  const first = mergeAdditivePlexProgress(current, candidate);
  const second = mergeAdditivePlexProgress(first, candidate);
  assert.deepEqual(second, first);
});

test('SEENIT-PLEX-006 protège l’écriture Firestore de la synchro Plex avec un merge additif', () => {
  const source = readFileSync(new URL('../src/features/plex/syncPlex.ts', import.meta.url), 'utf8');
  assert.match(source, /mergeAdditivePlexProgress/);
  assert.match(source, /runTransaction\(db/);
  assert.match(source, /transaction\.get\(ref\)/);
});
