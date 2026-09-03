import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import type { Show } from '../src/types.ts';
import { applyPlexLibraryWatchState } from '../src/features/plex/plexProgressMerge.ts';

function makePlexImportedMovie(): Show {
  return {
    id: 'movie-51',
    userId: 'user-1',
    tmdbId: 51,
    title: 'Fixture Plex',
    mediaType: 'movie',
    posterPath: null,
    backdropPath: null,
    status: 'completed',
    isArchived: false,
    updatedAt: 100,
    createdAt: 10,
    seenEpisodes: ['movie'],
    episodeRecords: {
      movie: { watchedAt: 500, plexImported: true }
    },
    lastWatchedAt: 500
  };
}

test('SEENIT-PLEX-006 un viewCount=0 explicite retire une progression plexImported même sans ancien miroir', () => {
  const current = makePlexImportedMovie();
  assert.equal(current.plexWatchState?.movie, undefined);

  const result = applyPlexLibraryWatchState(current, {
    mediaType: 'movie',
    tmdbId: 51,
    watched: false
  });

  assert.equal(result.changed, true);
  assert.equal(result.unwatchApplied, true);
  assert.deepEqual(result.show.seenEpisodes, []);
  assert.equal(result.show.episodeRecords.movie, undefined);
  assert.equal(result.show.plexWatchState?.movie, false);
  assert.equal(result.show.status, 'plan_to_watch');
});

test('SEENIT-PLEX-006 le client transmet sa version avant de recevoir watched=false', () => {
  const apiAuthSource = fs.readFileSync(new URL('../src/lib/apiAuth.ts', import.meta.url), 'utf8');
  const serverSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

  assert.match(apiAuthSource, /X-Plex-Version/);
  assert.match(apiAuthSource, /CURRENT_APP_VERSION/);
  assert.match(serverSource, /supportsPlexOwnedUnwatch/);
});
