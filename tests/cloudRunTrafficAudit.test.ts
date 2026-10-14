import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

interface TrafficRoute {
  route: string;
  requests: number;
  responseBytes: number;
  maxResponseBytes: number;
  statusClasses: Record<string, number>;
}

interface CloudRunTrafficReport {
  requestedWindow: { startTimestamp: string; endTimestamp: string };
  window: { firstTimestamp: string | null; lastTimestamp: string | null };
  sourceWindow: { firstTimestamp: string | null; lastTimestamp: string | null };
  quality: {
    status: string;
    sourceStatus: string;
    complete: boolean;
    stale: boolean;
    saturated: boolean;
    reasons: string[];
  };
  regions: string[];
  inputEntries: number;
  acceptedEntries: number;
  rejectedEntries: number;
  outOfWindowEntries: number;
  collectionLimit: number;
  totals: { requests: number; responseBytes: number };
  routes: TrafficRoute[];
}

const {
  MAX_INPUT_ENTRIES,
  analyzeCloudRunTraffic,
  buildMarkdownSummary,
  normalizeRoute
} = require('../scripts/summarize-cloud-run-traffic.cjs') as {
  MAX_INPUT_ENTRIES: number;
  analyzeCloudRunTraffic: (entries: unknown[], options?: {
    now?: Date;
    windowStart?: string;
    windowEnd?: string;
    sourceStatus?: string;
  }) => CloudRunTrafficReport;
  buildMarkdownSummary: (report: CloudRunTrafficReport) => string;
  normalizeRoute: (url: string) => string;
};

const requestedWindow = {
  now: new Date('2026-10-14T13:00:00.000Z'),
  windowStart: '2026-10-14T07:00:00.000Z',
  windowEnd: '2026-10-14T13:00:00.000Z'
};

function requestEntry(timestamp: string, requestUrl = 'https://seenit.ai.studio/api/health', responseSize = '512') {
  return {
    timestamp,
    resource: { labels: { location: 'us-west1' } },
    httpRequest: { requestUrl, responseSize, status: 200 }
  };
}

test('SEENIT-COST-001 agrège le trafic récent par route sans conserver URL ni identifiant', () => {
  assert.equal(normalizeRoute('https://seenit.ai.studio/assets/app-123.js?token=secret'), '/assets/*');
  assert.equal(normalizeRoute('https://seenit.ai.studio/api/media/tmdb/tv/42?api_key=secret'), '/api/media/tmdb/*');
  assert.equal(normalizeRoute('https://seenit.ai.studio/api/devices/private-installation'), '/api/devices/:installation');
  assert.equal(normalizeRoute('https://seenit.ai.studio/api/webhook/sonarr/private-endpoint'), '/api/webhook/:source/:endpoint');

  const report = analyzeCloudRunTraffic([
    requestEntry('2026-10-14T10:00:00.000Z', 'https://seenit.ai.studio/assets/app-123.js?token=secret', '1048576'),
    requestEntry('2026-10-14T10:01:00.000Z', 'https://seenit.ai.studio/api/media/tmdb/tv/42?api_key=secret'),
    { timestamp: '2026-10-14T10:02:00.000Z', textPayload: 'pas une requête' }
  ], requestedWindow);

  assert.deepEqual(report.regions, ['us-west1']);
  assert.equal(report.quality.status, 'ok');
  assert.equal(report.quality.complete, true);
  assert.equal(report.acceptedEntries, 2);
  assert.equal(report.rejectedEntries, 1);
  assert.equal(report.outOfWindowEntries, 0);
  assert.equal(report.totals.responseBytes, 1049088);
  assert.deepEqual(report.routes.map(route => route.route), ['/assets/*', '/api/media/tmdb/*']);
  assert.deepEqual(report.requestedWindow, {
    startTimestamp: '2026-10-14T07:00:00.000Z',
    endTimestamp: '2026-10-14T13:00:00.000Z'
  });
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /secret|app-123|private-installation|api_key/);

  const summary = buildMarkdownSummary(report);
  assert.match(summary, /Qualité : \*\*ok\*\* \(complet\)/);
  assert.match(summary, /Fenêtre demandée/);
  assert.doesNotMatch(summary, /secret|app-123|api_key/);
});

test('SEENIT-COST-001 refuse comme stale une source hors de la fenêtre demandée', () => {
  const report = analyzeCloudRunTraffic([
    requestEntry('2026-10-13T10:00:00.000Z', 'https://seenit.ai.studio/api/plex/history')
  ], requestedWindow);

  assert.equal(report.quality.status, 'stale');
  assert.equal(report.quality.complete, false);
  assert.equal(report.quality.stale, true);
  assert.deepEqual(report.quality.reasons, ['entries_outside_requested_window']);
  assert.equal(report.acceptedEntries, 0);
  assert.equal(report.outOfWindowEntries, 1);
  assert.equal(report.totals.responseBytes, 0);
  assert.equal(report.sourceWindow.lastTimestamp, '2026-10-13T10:00:00.000Z');
  assert.equal(report.routes.length, 0);
});

test('SEENIT-COST-001 signale la saturation à 10 000 entrées au lieu de prétendre le rapport complet', () => {
  const entries = Array.from({ length: MAX_INPUT_ENTRIES }, () => requestEntry('2026-10-14T12:00:00.000Z'));
  const report = analyzeCloudRunTraffic(entries, requestedWindow);

  assert.equal(report.acceptedEntries, 10_000);
  assert.equal(report.inputEntries, 10_000);
  assert.equal(report.collectionLimit, 10_000);
  assert.equal(report.quality.status, 'saturated');
  assert.equal(report.quality.saturated, true);
  assert.equal(report.quality.complete, false);
  assert.match(buildMarkdownSummary(report), /Saturation : \*\*oui\*\*/);
});

test('SEENIT-COST-001 considère une fenêtre vide récente comme complète et non périmée', () => {
  const report = analyzeCloudRunTraffic([], requestedWindow);

  assert.equal(report.quality.status, 'empty');
  assert.equal(report.quality.complete, true);
  assert.equal(report.quality.stale, false);
  assert.equal(report.quality.saturated, false);
  assert.equal(report.acceptedEntries, 0);
  assert.equal(report.window.lastTimestamp, null);
});
