import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { installAsyncRouteForwarding } from '../src/features/runtime/backendRuntime.ts';
import {
  getExactPlexMediaIdentityKeys,
  sanitizePlexSyncWatchEvidence
} from '../src/features/plex/plexWatchEvidence.ts';

const watchlistOnlyMovie = {
  type: 'movie',
  title: 'Fixture watchlist uniquement',
  guid: 'plex://movie/fixture-watchlist-only',
  sourceIdentity: 'plex:movie:fixture-watchlist-only'
};

const ambiguousCloudActivity = {
  ...watchlistOnlyMovie,
  viewedAt: 1_788_000_000_000,
  sourceKind: 'cloud',
  source: 'Plex Cloud Activity'
};

test('SEENIT-PLEX-005 une activité Cloud identique à la watchlist ne devient jamais un visionnage', () => {
  const payload = sanitizePlexSyncWatchEvidence({
    history: [ambiguousCloudActivity],
    watchlist: [watchlistOnlyMovie],
    stats: { normalizedHistoryItems: 1 },
    totalFound: 2
  });

  assert.deepEqual(payload.history, []);
  assert.deepEqual(payload.watchlist, [watchlistOnlyMovie]);
  assert.equal(payload.stats?.normalizedHistoryItems, 0);
  assert.equal((payload.stats as Record<string, any>)?.suppressedAmbiguousWatchlistHistory, 1);
  assert.equal(payload.totalFound, 1);
});

test('SEENIT-PLEX-005 conserve une vraie preuve de visionnage même si le film reste en watchlist', () => {
  for (const sourceKind of ['account-history', 'pms-history', 'pms-recent-fallback', 'library-watched']) {
    const watched = {
      ...watchlistOnlyMovie,
      sourceKind,
      viewedAt: 1_788_000_000_000
    };
    const payload = sanitizePlexSyncWatchEvidence({
      history: [watched],
      watchlist: [watchlistOnlyMovie]
    });
    assert.equal(payload.history?.length, 1, `source ${sourceKind}`);
  }
});

test('SEENIT-PLEX-005 ne rapproche jamais deux films par leur titre ou leur année', () => {
  const sameLabelDifferentIdentity = {
    ...watchlistOnlyMovie,
    guid: 'plex://movie/another-provider-id',
    sourceIdentity: 'plex:movie:another-provider-id',
    sourceKind: 'cloud'
  };

  assert.notDeepEqual(
    getExactPlexMediaIdentityKeys(watchlistOnlyMovie),
    getExactPlexMediaIdentityKeys(sameLabelDifferentIdentity)
  );

  const payload = sanitizePlexSyncWatchEvidence({
    history: [sameLabelDifferentIdentity],
    watchlist: [watchlistOnlyMovie]
  });
  assert.equal(payload.history?.length, 1);
});

test('SEENIT-PLEX-005 le filtrage du full Plex est idempotent', () => {
  const first = sanitizePlexSyncWatchEvidence({
    history: [ambiguousCloudActivity],
    watchlist: [watchlistOnlyMovie],
    stats: { normalizedHistoryItems: 1 }
  });
  const second = sanitizePlexSyncWatchEvidence(first);
  assert.deepEqual(second, first);
});

test('SEENIT-PLEX-005 protège réellement la réponse POST /api/plex/history', async () => {
  const app = express();
  installAsyncRouteForwarding(app);
  app.post('/api/plex/history', (_req, res) => {
    res.json({
      history: [ambiguousCloudActivity],
      watchlist: [watchlistOnlyMovie],
      stats: { normalizedHistoryItems: 1 },
      totalFound: 2
    });
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/plex/history`, { method: 'POST' });
    assert.equal(response.status, 200);
    const payload = await response.json() as any;
    assert.equal(payload.history.length, 0);
    assert.equal(payload.watchlist.length, 1);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
});
