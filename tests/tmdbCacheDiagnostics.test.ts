import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  summarizeTmdbCacheDiagnostics,
} = require('../scripts/summarize-tmdb-cache-diagnostics.cjs') as {
  summarizeTmdbCacheDiagnostics: (entries: unknown[], options?: { now?: Date; sourceStatus?: string }) => any;
};

function snapshot(
  timestamp: string,
  requests: number,
  families: Record<string, Record<string, number>>,
  instanceId = 'instance-secret-value',
) {
  return {
    timestamp,
    labels: { instanceId },
    jsonPayload: {
      seenitDiagnostic: {
        schemaVersion: 1,
        code: 'TMDB_REQUEST_CACHE_SUMMARY',
        timestamp,
        context: { requests, families },
      },
    },
  };
}

test('SEENIT-OBSERVABILITY-001 agrège les deltas TMDB sans archiver les snapshots cumulés ni les identités', () => {
  const report = summarizeTmdbCacheDiagnostics([
    snapshot('2026-09-18T21:00:00.000Z', 25, {
      details: { requests: 10, memoryHits: 2, inFlightHits: 0, upstream: 8, upstreamBytes: 800 },
      discover: { requests: 15, memoryHits: 5, inFlightHits: 0, upstream: 10, upstreamBytes: 200 },
    }),
    snapshot('2026-09-18T21:05:00.000Z', 50, {
      details: { requests: 20, memoryHits: 5, inFlightHits: 2, upstream: 13, upstreamBytes: 1300 },
      discover: { requests: 30, memoryHits: 14, inFlightHits: 0, upstream: 16, upstreamBytes: 500 },
    }),
    snapshot('2026-09-18T21:10:00.000Z', 75, {
      details: { requests: 30, memoryHits: 8, inFlightHits: 4, upstream: 18, upstreamBytes: 1800 },
      discover: { requests: 45, memoryHits: 25, inFlightHits: 0, upstream: 20, upstreamBytes: 800 },
    }),
  ], { now: new Date('2026-09-18T21:11:00.000Z'), sourceStatus: 'ok' });

  assert.equal(report.baselineStatus, 'ready');
  assert.equal(report.coverage.comparableIntervals, 2);
  assert.equal(report.coverage.exactComparableIntervals, 2);
  assert.equal(report.coverage.excludedInitialSnapshots, 1);
  assert.deepEqual(report.totals, {
    requests: 50,
    memoryHits: 26,
    inFlightHits: 4,
    upstream: 20,
    upstreamBytes: 1600,
    cacheAvoided: 30,
  });
  assert.equal(report.families.find((item: any) => item.family === 'details').upstream, 10);
  assert.equal(report.families.find((item: any) => item.family === 'discover').upstream, 10);
  assert.doesNotMatch(JSON.stringify(report), /instance-secret-value/);
});

test('issue #410 ignore les snapshots non comparables et reste report-only quand la baseline est insuffisante', () => {
  const report = summarizeTmdbCacheDiagnostics([
    snapshot('2026-09-18T21:00:00.000Z', 25, {
      season: { requests: 25, memoryHits: 0, inFlightHits: 0, upstream: 25, upstreamBytes: 2500 },
    }),
    {
      jsonPayload: {
        seenitDiagnostic: {
          schemaVersion: 1,
          code: 'ANOTHER_DIAGNOSTIC',
          timestamp: '2026-09-18T21:01:00.000Z',
          context: { query: 'secret-search', uid: 'secret-user' },
        },
      },
    },
  ], { sourceStatus: 'ok' });

  assert.equal(report.baselineStatus, 'insufficient');
  assert.equal(report.acceptedCount, 1);
  assert.equal(report.rejectedCount, 1);
  assert.equal(report.totals.requests, 0);
  assert.deepEqual(report.families, []);
  assert.doesNotMatch(JSON.stringify(report), /secret-search|secret-user|instance-secret-value/);
});
