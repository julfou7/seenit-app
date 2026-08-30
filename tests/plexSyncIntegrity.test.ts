import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeIncompletePlexSync,
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

test('ne remplace le cache de disponibilité qu’après un inventaire full complet', () => {
  assert.equal(shouldReplacePlexAvailabilityCache(false, {
    collectionComplete: false,
    libraryInventoryScanComplete: true
  }), true);
  assert.equal(shouldReplacePlexAvailabilityCache(false, {
    collectionComplete: false,
    libraryInventoryScanComplete: false
  }), false);
  assert.equal(shouldReplacePlexAvailabilityCache(true, {
    collectionComplete: true,
    libraryInventoryScanComplete: true
  }), false);
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
