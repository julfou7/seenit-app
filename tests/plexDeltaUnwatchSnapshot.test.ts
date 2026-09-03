import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildExplicitPlexDeltaWatchState,
  findMissingPlexDeltaWatchedLocators,
  mergePlexDeltaWatchedLocators,
  type PlexDeltaWatchedLocator
} from '../src/features/plex/plexDeltaUnwatch.ts';

const previousMovie: PlexDeltaWatchedLocator = {
  serverId: 'server-a',
  ratingKey: '101',
  mediaType: 'movie',
  tmdbId: 51
};

const previousEpisode: PlexDeltaWatchedLocator = {
  serverId: 'server-b',
  ratingKey: '202',
  mediaType: 'episode',
  tmdbId: 900,
  seasonNumber: 1,
  episodeNumber: 2
};

test('SEENIT-PLEX-005 la delta recontrôle explicitement une identité vue disparue avant de produire watched=false', () => {
  const missing = findMissingPlexDeltaWatchedLocators(
    [previousMovie],
    [],
    new Set(['server-a'])
  );
  assert.deepEqual(missing, [previousMovie]);

  assert.equal(buildExplicitPlexDeltaWatchState(previousMovie, { ratingKey: '101' }), null);
  assert.equal(buildExplicitPlexDeltaWatchState(previousMovie, { ratingKey: '101', viewCount: null }), null);
  assert.equal(buildExplicitPlexDeltaWatchState(previousMovie, { ratingKey: '999', viewCount: 0 }), null);

  const explicitUnwatch = buildExplicitPlexDeltaWatchState(previousMovie, {
    ratingKey: '101',
    viewCount: 0
  });
  assert.deepEqual(explicitUnwatch, {
    mediaType: 'movie',
    tmdbId: 51,
    watched: false,
    serverId: 'server-a'
  });
});

test('SEENIT-PLEX-006 la delta ne transforme jamais une absence ou un serveur ignoré en dé-vu', () => {
  const missing = findMissingPlexDeltaWatchedLocators(
    [previousMovie, previousEpisode],
    [],
    new Set(['server-a'])
  );
  assert.deepEqual(missing, [previousMovie]);

  const unknownRecheck = buildExplicitPlexDeltaWatchState(previousMovie, { ratingKey: '101' });
  assert.equal(unknownRecheck, null);

  const retained = mergePlexDeltaWatchedLocators({
    previous: [previousMovie, previousEpisode],
    current: [],
    scannedServerIds: new Set(['server-a']),
    confirmedUnwatched: new Set()
  });
  assert.deepEqual(retained, [previousMovie, previousEpisode]);

  const removedOnlyAfterProof = mergePlexDeltaWatchedLocators({
    previous: [previousMovie, previousEpisode],
    current: [],
    scannedServerIds: new Set(['server-a']),
    confirmedUnwatched: new Set(['server-a:movie:51:101'])
  });
  assert.deepEqual(removedOnlyAfterProof, [previousEpisode]);
});
