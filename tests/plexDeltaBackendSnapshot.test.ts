import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPlexDeltaAuthoritativeWatchState,
  buildPlexFullWatchedDeltaBaseline,
  mergePlexDeltaWatchedSnapshot
} from '../src/features/runtime/backendRuntime.ts';
import type { PlexDeltaWatchedLocator } from '../src/features/plex/plexDeltaUnwatch.ts';

test('SEENIT-PLEX-005 la delta ajoute un état library-watched courant sans dépendre de la date du curseur', () => {
  const payload = {
    history: [],
    watchlist: [],
    stats: { libraryWatchedItems: 0 },
    integrity: { collectionComplete: true }
  };

  const merged = mergePlexDeltaWatchedSnapshot(payload, {
    items: [{
      type: 'movie',
      title: 'Film test',
      Guid: [{ id: 'tmdb://1234' }],
      viewCount: 1,
      lastViewedAt: 1,
      sourceKind: 'library-watched'
    }],
    watchStates: [],
    scannedServers: 1,
    skippedServers: 0,
    explicitUnwatchItems: 0
  });

  assert.equal(merged.history.length, 1);
  assert.equal(merged.history[0].sourceKind, 'library-watched');
  assert.equal(merged.stats.libraryWatchedItems, 1);
  assert.equal(merged.stats.deltaWatchedSnapshotServers, 1);
  assert.equal(merged.integrity.deltaWatchedSnapshotComplete, true);
});

test('SEENIT-PLEX-005 la delta déduplique une preuve PMS déjà présente par identité technique', () => {
  const existing = {
    type: 'movie',
    Guid: [{ id: 'tmdb://1234' }],
    viewCount: 1,
    sourceKind: 'pms-history'
  };
  const current = {
    ...existing,
    sourceKind: 'library-watched'
  };

  const merged = mergePlexDeltaWatchedSnapshot(
    { history: [existing], watchlist: [] },
    {
      items: [current],
      watchStates: [],
      scannedServers: 1,
      skippedServers: 0,
      explicitUnwatchItems: 0
    }
  );

  assert.equal(merged.history.length, 1);
  assert.equal(merged.history[0].sourceKind, 'pms-history');
});

test('SEENIT-PLEX-005 le full complet initialise la baseline watched de la delta', () => {
  const baseline = buildPlexFullWatchedDeltaBaseline({
    history: [
      {
        type: 'movie',
        sourceKind: 'library-watched',
        serverId: 'server-a',
        ratingKey: '101',
        Guid: [{ id: 'tmdb://51' }]
      },
      {
        type: 'episode',
        sourceKind: 'library-watched',
        serverId: 'server-b',
        ratingKey: '202',
        grandparentGuids: [{ id: 'tmdb://900' }],
        parentIndex: 0,
        index: 2
      },
      {
        type: 'movie',
        sourceKind: 'pms-history',
        serverId: 'server-a',
        ratingKey: '303',
        Guid: [{ id: 'tmdb://303' }]
      },
      {
        type: 'movie',
        sourceKind: 'library-watched',
        serverId: 'server-a',
        ratingKey: '404',
        title: 'Titre seul interdit'
      }
    ],
    integrity: {
      libraryInventoryScanComplete: true,
      syncedServers: [{ id: 'server-a' }, { id: 'server-b' }],
      skippedServers: []
    }
  });

  assert.deepEqual(baseline, [
    {
      serverId: 'server-a',
      ratingKey: '101',
      mediaType: 'movie',
      tmdbId: 51
    },
    {
      serverId: 'server-b',
      ratingKey: '202',
      mediaType: 'episode',
      tmdbId: 900,
      seasonNumber: 0,
      episodeNumber: 2
    }
  ]);

  const incomplete = buildPlexFullWatchedDeltaBaseline({
    history: [],
    integrity: {
      libraryInventoryScanComplete: true,
      syncedServers: [{ id: 'server-a' }],
      skippedServers: [{ id: 'server-b' }]
    }
  });
  assert.equal(incomplete, null);
});

test('SEENIT-PLEX-005 le recontrôle delta interprète un viewCount omis comme zéro uniquement sur le ratingKey exact', () => {
  const locator: PlexDeltaWatchedLocator = {
    serverId: 'server-a',
    ratingKey: '101',
    mediaType: 'movie',
    tmdbId: 51
  };

  assert.deepEqual(
    buildPlexDeltaAuthoritativeWatchState(locator, { ratingKey: '101' }),
    { mediaType: 'movie', tmdbId: 51, watched: false, serverId: 'server-a' }
  );
  assert.deepEqual(
    buildPlexDeltaAuthoritativeWatchState(locator, { ratingKey: '101', viewCount: 0 }),
    { mediaType: 'movie', tmdbId: 51, watched: false, serverId: 'server-a' }
  );
  assert.deepEqual(
    buildPlexDeltaAuthoritativeWatchState(locator, { ratingKey: '101', viewCount: 1 }),
    { mediaType: 'movie', tmdbId: 51, watched: true, serverId: 'server-a' }
  );
  assert.equal(buildPlexDeltaAuthoritativeWatchState(locator, { ratingKey: '999' }), null);
  assert.equal(buildPlexDeltaAuthoritativeWatchState(locator, null), null);
  assert.equal(buildPlexDeltaAuthoritativeWatchState(locator, { ratingKey: '101', viewCount: 'unknown' }), null);
});
