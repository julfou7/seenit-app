import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPlexDeltaAuthoritativeWatchState,
  buildPlexFullWatchedDeltaBaseline,
  getPlexDeltaAuthoritativeUnwatchServerIds,
  mergePlexDeltaWatchedSnapshot
} from '../src/features/runtime/backendRuntime.ts';
import {
  buildPlexDeltaUnresolvedWatchedItem,
  canRecheckPlexDeltaUnwatchCandidate,
  isPlexDeltaWatchedQueryTechnicallyComplete
} from '../src/features/runtime/plexDeltaUnwatchSafety.ts';
import {
  findMissingPlexDeltaWatchedLocators,
  hydratePlexDeltaWatchedLocator,
  type PlexDeltaWatchedLocator
} from '../src/features/plex/plexDeltaUnwatch.ts';

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
      tmdbId: 51,
      resolutionKey: 'movie:tmdb:51'
    },
    {
      serverId: 'server-b',
      ratingKey: '202',
      mediaType: 'episode',
      tmdbId: 900,
      resolutionKey: 'tv:tmdb:900',
      seasonNumber: 0,
      episodeNumber: 2
    },
    {
      serverId: 'server-a',
      ratingKey: '404',
      mediaType: 'movie',
      resolutionKey: 'movie:server:server-a:rating:404'
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

test('SEENIT-PLEX-005 la baseline delta conserve un vu technique sans TMDB puis réutilise le cache de résolution', () => {
  const baseline = buildPlexFullWatchedDeltaBaseline({
    history: [{
      type: 'movie',
      sourceKind: 'library-watched',
      serverId: 'server-a',
      ratingKey: '404'
    }],
    integrity: {
      libraryInventoryScanComplete: true,
      syncedServers: [{ id: 'server-a' }],
      skippedServers: []
    }
  });

  assert.ok(baseline);
  assert.deepEqual(baseline[0], {
    serverId: 'server-a',
    ratingKey: '404',
    mediaType: 'movie',
    resolutionKey: 'movie:server:server-a:rating:404'
  });

  const hydrated = hydratePlexDeltaWatchedLocator(baseline[0], {
    'movie:server:server-a:rating:404': { id: 9876, title: 'Nom sans rôle identitaire' }
  });
  assert.equal(hydrated.tmdbId, 9876);
  assert.deepEqual(
    buildPlexDeltaAuthoritativeWatchState(hydrated, { ratingKey: '404', viewCount: 0 }),
    { mediaType: 'movie', tmdbId: 9876, watched: false, serverId: 'server-a' }
  );
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

test('SEENIT-PLEX-005 un média vu non résolu sans rapport ne bloque plus tous les non vus delta', () => {
  const movieCandidate: PlexDeltaWatchedLocator = {
    serverId: 'server-a',
    ratingKey: '101',
    mediaType: 'movie',
    tmdbId: 51,
    resolutionKey: 'movie:imdb:tt0000051'
  };
  const episodeCandidate: PlexDeltaWatchedLocator = {
    serverId: 'server-a',
    ratingKey: '202',
    mediaType: 'episode',
    tmdbId: 900,
    resolutionKey: 'tv:tvdb:900',
    seasonNumber: 1,
    episodeNumber: 2
  };

  const unresolvedEpisode = buildPlexDeltaUnresolvedWatchedItem(
    { ratingKey: '999', parentIndex: 1, index: 9, viewCount: 1 },
    'episode',
    'server-a'
  );
  assert.ok(unresolvedEpisode);
  assert.equal(
    isPlexDeltaWatchedQueryTechnicallyComplete([
      { ratingKey: '999', parentIndex: 1, index: 9, viewCount: 1 }
    ]),
    true
  );
  assert.equal(isPlexDeltaWatchedQueryTechnicallyComplete([{ title: 'sans ratingKey' }]), false);

  assert.equal(canRecheckPlexDeltaUnwatchCandidate(movieCandidate, [unresolvedEpisode]), true);
  assert.equal(canRecheckPlexDeltaUnwatchCandidate(episodeCandidate, [unresolvedEpisode]), true);

  const unrelatedStrongMovie = buildPlexDeltaUnresolvedWatchedItem(
    { ratingKey: '996', Guid: [{ id: 'imdb://tt9999999' }], viewCount: 1 },
    'movie',
    'server-b'
  );
  assert.ok(unrelatedStrongMovie);
  assert.equal(unrelatedStrongMovie.relationIdentity, 'imdb:tt9999999');
  assert.equal(canRecheckPlexDeltaUnwatchCandidate(movieCandidate, [unrelatedStrongMovie]), true);

  const sameStrongMovie = buildPlexDeltaUnresolvedWatchedItem(
    { ratingKey: '995', Guid: [{ id: 'imdb://tt0000051' }], viewCount: 1 },
    'movie',
    'server-b'
  );
  assert.ok(sameStrongMovie);
  assert.equal(canRecheckPlexDeltaUnwatchCandidate(movieCandidate, [sameStrongMovie]), false);

  const unrelatedStrongEpisode = buildPlexDeltaUnresolvedWatchedItem(
    {
      ratingKey: '994',
      grandparentGuids: [{ id: 'tvdb://901' }],
      parentIndex: 1,
      index: 2,
      viewCount: 1
    },
    'episode',
    'server-b'
  );
  assert.ok(unrelatedStrongEpisode);
  assert.equal(canRecheckPlexDeltaUnwatchCandidate(episodeCandidate, [unrelatedStrongEpisode]), true);

  const sameSeriesSameEpisode = buildPlexDeltaUnresolvedWatchedItem(
    {
      ratingKey: '993',
      grandparentGuids: [{ id: 'tvdb://900' }],
      parentIndex: 1,
      index: 2,
      viewCount: 1
    },
    'episode',
    'server-b'
  );
  assert.ok(sameSeriesSameEpisode);
  assert.equal(canRecheckPlexDeltaUnwatchCandidate(episodeCandidate, [sameSeriesSameEpisode]), false);

  const sameSeriesOtherEpisode = buildPlexDeltaUnresolvedWatchedItem(
    {
      ratingKey: '992',
      grandparentGuids: [{ id: 'tvdb://900' }],
      parentIndex: 1,
      index: 3,
      viewCount: 1
    },
    'episode',
    'server-b'
  );
  assert.ok(sameSeriesOtherEpisode);
  assert.equal(canRecheckPlexDeltaUnwatchCandidate(episodeCandidate, [sameSeriesOtherEpisode]), true);

  const unrelatedUnknownMovie = buildPlexDeltaUnresolvedWatchedItem(
    { ratingKey: '997', viewCount: 1 },
    'movie',
    'server-b'
  );
  assert.ok(unrelatedUnknownMovie);
  assert.equal(canRecheckPlexDeltaUnwatchCandidate(movieCandidate, [unrelatedUnknownMovie]), true);

  const sameTechnicalItem = buildPlexDeltaUnresolvedWatchedItem(
    { ratingKey: '101', viewCount: 1 },
    'movie',
    'server-a'
  );
  assert.ok(sameTechnicalItem);
  assert.equal(canRecheckPlexDeltaUnwatchCandidate(movieCandidate, [sameTechnicalItem]), false);
});

test('SEENIT-PLEX-006 un serveur ignoré ne bloque pas le non vu exact d’un autre serveur autoritatif', () => {
  const serverIds = getPlexDeltaAuthoritativeUnwatchServerIds([
    { serverId: 'server-a', scanned: true, completeForUnwatch: true },
    { serverId: 'server-b', scanned: false, completeForUnwatch: false },
    { serverId: 'server-c', scanned: true, completeForUnwatch: false }
  ]);

  assert.deepEqual([...serverIds], ['server-a']);

  const colony: PlexDeltaWatchedLocator = {
    serverId: 'server-a',
    ratingKey: '384',
    mediaType: 'movie',
    tmdbId: 1375646
  };
  const ignoredServerMovie: PlexDeltaWatchedLocator = {
    serverId: 'server-b',
    ratingKey: '999',
    mediaType: 'movie',
    tmdbId: 999
  };

  const missing = findMissingPlexDeltaWatchedLocators(
    [colony, ignoredServerMovie],
    [],
    serverIds
  );

  assert.deepEqual(missing, [colony]);
});
