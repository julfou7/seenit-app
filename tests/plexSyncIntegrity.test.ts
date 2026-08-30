import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeIncompletePlexSync,
  describePlexServerSync,
  evaluatePlexSourceCompletion,
  getPlexServerSyncCounts,
  isPermanentPlexResolutionMiss,
  shouldCommitPlexCursor,
  shouldReplacePlexAvailabilityCache
} from '../src/features/plex/plexSyncIntegrity.ts';

test('distingue une absence TMDB définitive d’une panne à retenter', () => {
  assert.equal(isPermanentPlexResolutionMiss(new Error('TMDB Error: 404')), true);
  assert.equal(isPermanentPlexResolutionMiss('No media found on TMDB for external ID tt0000000'), true);
  assert.equal(isPermanentPlexResolutionMiss(new Error('TMDB Error: 429')), false);
  assert.equal(isPermanentPlexResolutionMiss(new TypeError('fetch failed')), false);
});

test('remplace le cache de disponibilité après au moins un inventaire full réussi', () => {
  assert.equal(shouldReplacePlexAvailabilityCache(false, {
    collectionComplete: false,
    libraryInventoryScanSucceeded: true,
    libraryInventoryScanComplete: false
  }), true);
  assert.equal(shouldReplacePlexAvailabilityCache(false, {
    collectionComplete: false,
    libraryInventoryScanSucceeded: false,
    libraryInventoryScanComplete: false
  }), false);
  assert.equal(shouldReplacePlexAvailabilityCache(true, {
    collectionComplete: true,
    libraryInventoryScanSucceeded: true,
    libraryInventoryScanComplete: true
  }), false);
});

test('résume les serveurs synchronisés et ignorés sans exposer leur connexion', () => {
  const integrity = {
    syncedServers: [
      { id: 'server-a', name: 'NAS' },
      { id: 'server-b', name: 'Maison' }
    ],
    skippedServers: [
      { id: 'server-c', name: 'PC-RUDY', reason: 'hors ligne ou délai dépassé' }
    ]
  };

  assert.equal(
    describePlexServerSync(integrity),
    'Synchronisés : NAS, Maison • Ignorés : PC-RUDY (hors ligne ou délai dépassé)'
  );
  assert.deepEqual(getPlexServerSyncCounts(integrity), { synced: 2, skipped: 1 });
});

test('un serveur hors ligne ne bloque ni les autres serveurs ni le curseur du full', () => {
  assert.deepEqual(evaluatePlexSourceCompletion({
    delta: false,
    serverCount: 3,
    completeInventoryServers: 2,
    completeHistoryServers: 2,
    accountHistoryAvailable: true,
    cloudCollectionSucceeded: false
  }), {
    libraryInventoryScanSucceeded: true,
    libraryInventoryScanComplete: false,
    historyCollectionComplete: true
  });
});

test('un delta peut se terminer avec un seul serveur PMS accessible', () => {
  assert.equal(evaluatePlexSourceCompletion({
    delta: true,
    serverCount: 3,
    completeInventoryServers: 0,
    completeHistoryServers: 1,
    accountHistoryAvailable: false,
    cloudCollectionSucceeded: false
  }).historyCollectionComplete, true);
});

test('ne valide le curseur qu’après collecte, résolution et écritures complètes', () => {
  assert.equal(shouldCommitPlexCursor({
    collectionComplete: true,
    retryableUnresolvedCount: 0,
    firestoreCommitted: true
  }), true);
  assert.equal(shouldCommitPlexCursor({
    collectionComplete: false,
    retryableUnresolvedCount: 0,
    firestoreCommitted: true
  }), false);
  assert.equal(shouldCommitPlexCursor({
    collectionComplete: true,
    retryableUnresolvedCount: 1,
    firestoreCommitted: true
  }), false);
  assert.equal(shouldCommitPlexCursor({
    collectionComplete: true,
    retryableUnresolvedCount: 0,
    firestoreCommitted: false
  }), false);
});

test('explique précisément les raisons qui imposent un nouvel essai', () => {
  assert.equal(
    describeIncompletePlexSync({
      collectionComplete: false,
      incompleteSources: ['inventaire serveur Maison']
    }, 2),
    'sources incomplètes : inventaire serveur Maison ; 2 identité(s) à retenter'
  );
});
