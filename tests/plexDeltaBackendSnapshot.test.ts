import assert from 'node:assert/strict';
import test from 'node:test';
import { mergePlexDeltaWatchedSnapshot } from '../src/features/runtime/backendRuntime.ts';

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
