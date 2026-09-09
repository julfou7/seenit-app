import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Show } from '../src/types.ts';
import {
  buildPlexWatchlistTrackingProvenance,
  getPlexWatchlistMediaIdentity,
  isAuthoritativePlexWatchlistEndpoint,
  isRecognizedPlexWatchlistPayload,
  selectPlexWatchlistTrackingRemovals
} from '../src/features/plex/plexWatchlistTracking.ts';

function watchlistOnlyShow(
  id: string,
  tmdbId: number,
  mediaType: 'movie' | 'tv'
): Show {
  return {
    id,
    userId: 'uid-fixture',
    tmdbId,
    title: `Fixture ${id}`,
    mediaType,
    posterPath: null,
    backdropPath: null,
    status: 'plan_to_watch',
    isArchived: false,
    updatedAt: 1,
    createdAt: 1,
    seenEpisodes: [],
    episodeRecords: {},
    trackingProvenance: buildPlexWatchlistTrackingProvenance(mediaType, tmdbId, 1)
  };
}

test('SEENIT-PLEX-009 retire un film et une série créés uniquement par la Watchlist', () => {
  const movie = watchlistOnlyShow('movie-doc', 101, 'movie');
  const series = watchlistOnlyShow('tv-doc', 202, 'tv');

  assert.deepEqual(selectPlexWatchlistTrackingRemovals([movie, series], {
    mode: 'full',
    complete: true,
    unresolvedItemCount: 0,
    mediaIdentities: new Set()
  }).map(show => show.id), ['movie-doc', 'tv-doc']);
});

test('SEENIT-PLEX-009 conserve les suivis manuels et toute intention SeenIt', () => {
  const manual = { ...watchlistOnlyShow('manual', 1, 'movie'), trackingProvenance: undefined };
  const progressed = { ...watchlistOnlyShow('progressed', 2, 'tv'), seenEpisodes: ['1x1'] };
  const recorded = {
    ...watchlistOnlyShow('recorded', 3, 'tv'),
    episodeRecords: { '1x1': { watchedAt: 1 } }
  };
  const favorite = { ...watchlistOnlyShow('favorite', 4, 'movie'), isFavorite: true };
  const rated = { ...watchlistOnlyShow('rated', 5, 'movie'), userRating: 8 };
  const reminded = { ...watchlistOnlyShow('reminded', 6, 'tv'), notificationsEnabled: true };
  const archived = { ...watchlistOnlyShow('archived', 7, 'tv'), isArchived: true };
  const abandoned = { ...watchlistOnlyShow('abandoned', 8, 'tv'), status: 'dropped' as const };
  const legacyProgress = { ...watchlistOnlyShow('legacy-progress', 9, 'movie'), lastWatchedAt: 1 };

  assert.deepEqual(selectPlexWatchlistTrackingRemovals([
    manual,
    progressed,
    recorded,
    favorite,
    rated,
    reminded,
    archived,
    abandoned,
    legacyProgress
  ], {
    mode: 'delta',
    complete: true,
    unresolvedItemCount: 0,
    mediaIdentities: new Set()
  }), []);
});

test('SEENIT-PLEX-009 refuse toute suppression sur un snapshot incomplet ou ambigu', () => {
  const movie = watchlistOnlyShow('movie-doc', 101, 'movie');
  const exactIdentity = getPlexWatchlistMediaIdentity('movie', 101);

  assert.deepEqual(selectPlexWatchlistTrackingRemovals([movie], {
    mode: 'full',
    complete: false,
    unresolvedItemCount: 0,
    mediaIdentities: new Set()
  }), []);
  assert.deepEqual(selectPlexWatchlistTrackingRemovals([movie], {
    mode: 'full',
    complete: true,
    unresolvedItemCount: 1,
    mediaIdentities: new Set()
  }), []);
  assert.deepEqual(selectPlexWatchlistTrackingRemovals([movie], {
    mode: 'full',
    complete: true,
    unresolvedItemCount: 0,
    mediaIdentities: new Set([exactIdentity!])
  }), []);

  const forgedFromTitle = {
    ...movie,
    trackingProvenance: {
      source: 'plex-watchlist' as const,
      mediaIdentity: 'movie:Fixture movie-doc',
      importedAt: 1
    }
  };
  assert.deepEqual(selectPlexWatchlistTrackingRemovals([forgedFromTitle], {
    mode: 'full',
    complete: true,
    unresolvedItemCount: 0,
    mediaIdentities: new Set()
  }), []);
});

test('SEENIT-PLEX-009 partage la même décision en full et en delta', () => {
  const movie = watchlistOnlyShow('movie-doc', 101, 'movie');
  const common = {
    complete: true,
    unresolvedItemCount: 0,
    mediaIdentities: new Set<string>()
  };

  const full = selectPlexWatchlistTrackingRemovals([movie], { ...common, mode: 'full' });
  const delta = selectPlexWatchlistTrackingRemovals([movie], { ...common, mode: 'delta' });
  assert.deepEqual(full, delta);
});

test('SEENIT-PLEX-009 n’accorde l’autorité qu’aux endpoints Watchlist exhaustifs', () => {
  assert.equal(isAuthoritativePlexWatchlistEndpoint(
    'https://discover.provider.plex.tv/library/sections/watchlist/all?includeUserState=1'
  ), true);
  assert.equal(isAuthoritativePlexWatchlistEndpoint(
    'https://metadata.provider.plex.tv/library/sections/watchlist/all?includeUserState=1'
  ), true);
  assert.equal(isAuthoritativePlexWatchlistEndpoint(
    'https://metadata.provider.plex.tv/library/sections/watchlist/today?includeUserState=1'
  ), false);
  assert.equal(isAuthoritativePlexWatchlistEndpoint('https://example.test/watchlist/all'), false);
  assert.equal(isRecognizedPlexWatchlistPayload({ MediaContainer: { size: 0 } }), true);
  assert.equal(isRecognizedPlexWatchlistPayload({ MediaContainer: { Metadata: [] } }), true);
  assert.equal(isRecognizedPlexWatchlistPayload({}), false);
});

test('SEENIT-PLEX-009 le runtime persiste la provenance et relit avant suppression', () => {
  const clientSource = readFileSync(new URL('../src/features/plex/syncPlex.ts', import.meta.url), 'utf8');
  const backendSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

  assert.match(clientSource, /trackingProvenance:\s*buildPlexWatchlistTrackingProvenance/);
  assert.match(clientSource, /selectPlexWatchlistTrackingRemovals/);
  assert.match(clientSource, /transaction\.get\(ref\)/);
  assert.match(clientSource, /transaction\.delete\(ref\)/);
  assert.match(backendSource, /watchlistCollectionComplete/);
  assert.match(backendSource, /isAuthoritativePlexWatchlistEndpoint/);
});
