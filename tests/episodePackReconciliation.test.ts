import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeLateOptimisticMetadata } from '../src/features/downloads/downloadReconciliation.ts';

test('un pack Sonarr conserve le scope SxxEyy exact demandé dans SeenIt', () => {
  const remote = {
    id: 'sonarr_42',
    downloadId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    mediaType: 'tv' as const,
    title: 'Ted Lasso',
    seriesTitle: 'Ted Lasso',
    tmdbId: 97546,
    tvdbId: 383203,
    seasonNumber: 1,
    episodeNumber: 2,
    size: 5_200_000_000,
    sizeleft: 4_000_000_000,
    progress: 23.4,
    status: 'downloading',
    statusText: 'Téléchargement en cours',
    speedBytesPerSec: 4_000_000,
    isOptimistic: false
  };
  const request = {
    id: 'opt_ted_s01e01',
    requestId: 'opt_ted_s01e01',
    downloadId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    mediaType: 'tv' as const,
    title: 'Ted Lasso (S01E01)',
    seriesTitle: 'Ted Lasso',
    tmdbId: 97546,
    tvdbId: 383203,
    seasonNumber: 1,
    episodeNumber: 1,
    posterPath: '/ted.jpg',
    size: 0,
    sizeleft: 0,
    progress: 0,
    status: 'searching',
    statusText: 'Recherche en cours',
    isOptimistic: true
  };

  const merged = mergeLateOptimisticMetadata(remote, request);
  assert.equal(merged.seasonNumber, 1);
  assert.equal(merged.episodeNumber, 1);
  assert.equal(merged.progress, 23.4);
  assert.equal(merged.status, 'downloading');
  assert.equal(merged.speedBytesPerSec, 4_000_000);
  assert.equal(merged.posterPath, '/ted.jpg');
  assert.equal(merged.seriesTitle, 'Ted Lasso');
});
