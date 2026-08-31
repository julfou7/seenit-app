import assert from 'node:assert/strict';
import test from 'node:test';
import {
  nextDownloadSourceBackoffMs,
  shouldFetchNextArrQueuePage
} from '../src/features/downloads/downloadPollingPolicy.ts';

test('le backoff progresse par source et reste plafonné', () => {
  assert.deepEqual([1, 2, 3, 4].map(nextDownloadSourceBackoffMs), [5_000, 10_000, 20_000, 40_000]);
  assert.equal(nextDownloadSourceBackoffMs(20), 300_000);
});

test('les files Arr continuent au-delà de 100 éléments jusqu’au total', () => {
  assert.equal(shouldFetchNextArrQueuePage(100, 250, 100), true);
  assert.equal(shouldFetchNextArrQueuePage(100, 250, 200), true);
  assert.equal(shouldFetchNextArrQueuePage(50, 250, 250), false);
  assert.equal(shouldFetchNextArrQueuePage(100, 200, 200), false);
});
