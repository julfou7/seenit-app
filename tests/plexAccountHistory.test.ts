import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isPlexLibraryItemWatched,
  normalizePlexAccountHistoryNode
} from '../src/features/plex/plexAccountHistory.ts';
import { readExplicitPlexCurrentWatchState } from '../src/features/runtime/plexAccountCurrentState.ts';
import { readFileSync } from 'node:fs';

test('normalise un film du Watch History Plex sans utiliser son titre comme identité', () => {
  const item = normalizePlexAccountHistoryNode({
    id: 'watch-1',
    metadataItem: {
      id: 'graphql_movie_1',
      guid: 'plex://movie/provider_movie_1',
      key: '/library/metadata/provider_movie_1',
      type: 'movie',
      title: 'Film de test'
    }
  });

  assert.equal(item?.guid, 'plex://movie/provider_movie_1');
  assert.equal(item?.accountMetadataId, 'graphql_movie_1');
  assert.equal(item?.ratingKey, undefined);
  assert.equal(item?.historyKey, 'community:watch-1');
});

test('normalise un épisode avec la saison et la série parentes', () => {
  const item = normalizePlexAccountHistoryNode({
    id: 'watch-2',
    metadataItem: {
      id: 'episode_6',
      guid: 'plex://episode/episode_6',
      key: '/library/metadata/episode_6',
      type: 'episode',
      title: 'Épisode 6',
      index: 6,
      parent: {
        id: 'season_1',
        guid: 'plex://season/season_1',
        key: '/library/metadata/season_1',
        type: 'season',
        title: 'Season 1',
        index: 1
      },
      grandparent: {
        id: 'show_1',
        guid: 'plex://show/show_1',
        key: '/library/metadata/show_1',
        type: 'show',
        title: 'Série de test'
      }
    }
  });

  assert.equal(item?.index, 6);
  assert.equal(item?.parentIndex, 1);
  assert.equal(item?.grandparentGuid, 'plex://show/show_1');
  assert.equal(item?.grandparentAccountMetadataId, 'show_1');
  assert.equal(item?.grandparentRatingKey, undefined);
});

test('le full scan ne retient comme vus que les items dont viewCount est positif', () => {
  assert.equal(isPlexLibraryItemWatched({ viewCount: 1 }), true);
  assert.equal(isPlexLibraryItemWatched({ viewCount: 4 }), true);
  assert.equal(isPlexLibraryItemWatched({ viewCount: 0, lastViewedAt: 123 }), false);
  assert.equal(isPlexLibraryItemWatched({}), false);
});


test('SEENIT-PLEX-005 le Watch History du compte exige un userState courant explicite', () => {
  assert.equal(readExplicitPlexCurrentWatchState({ guid: 'plex://movie/history-only' }), null);
  assert.equal(readExplicitPlexCurrentWatchState({ MediaContainer: { Metadata: [{ viewCount: 0 }] } }), false);
  assert.equal(readExplicitPlexCurrentWatchState({ MediaContainer: { Metadata: [{ viewCount: 2 }] } }), true);
  assert.equal(readExplicitPlexCurrentWatchState({ view_count: '0' }), false);
});

test('SEENIT-PLEX-005 le backend refuse un historique compte sans état courant vu', () => {
  const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  assert.ok(serverSource.includes('metadata.provider.plex.tv/library/metadata/'));
  assert.ok(serverSource.includes('/userState'));
  assert.ok(serverSource.includes("sourceKind === 'account-history'"));
  assert.ok(serverSource.includes('accountCurrentWatched !== true'));
  assert.ok(serverSource.includes('plexAccountCurrentUnwatched'));
});
