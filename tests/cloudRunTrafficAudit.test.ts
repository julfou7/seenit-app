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
  regions: string[];
  acceptedEntries: number;
  rejectedEntries: number;
  totals: { requests: number; responseBytes: number };
  routes: TrafficRoute[];
}

const {
  analyzeCloudRunTraffic,
  buildMarkdownSummary,
  normalizeRoute
} = require('../scripts/summarize-cloud-run-traffic.cjs') as {
  analyzeCloudRunTraffic: (entries: unknown[], options?: { now: Date }) => CloudRunTrafficReport;
  buildMarkdownSummary: (report: CloudRunTrafficReport, sourceStatus?: string) => string;
  normalizeRoute: (url: string) => string;
};

test('SEENIT-COST-001 agrège le trafic Cloud Run par route sans conserver URL ni identifiant', () => {
  assert.equal(normalizeRoute('https://seenit.ai.studio/assets/app-123.js?token=secret'), '/assets/*');
  assert.equal(normalizeRoute('https://seenit.ai.studio/api/media/tmdb/tv/42?api_key=secret'), '/api/media/tmdb/*');
  assert.equal(normalizeRoute('https://seenit.ai.studio/api/devices/private-installation'), '/api/devices/:installation');
  assert.equal(normalizeRoute('https://seenit.ai.studio/api/webhook/sonarr/private-endpoint'), '/api/webhook/:source/:endpoint');

  const report = analyzeCloudRunTraffic([
    {
      timestamp: '2026-09-20T10:00:00.000Z',
      resource: { labels: { location: 'us-west1' } },
      httpRequest: {
        requestUrl: 'https://seenit.ai.studio/assets/app-123.js?token=secret',
        responseSize: '1048576',
        status: 200
      }
    },
    {
      timestamp: '2026-09-20T10:01:00.000Z',
      resource: { labels: { location: 'us-west1' } },
      httpRequest: {
        requestUrl: 'https://seenit.ai.studio/api/media/tmdb/tv/42?api_key=secret',
        responseSize: '512',
        status: 304
      }
    },
    { timestamp: '2026-09-20T10:02:00.000Z', textPayload: 'pas une requête' }
  ], { now: new Date('2026-09-20T11:00:00.000Z') });

  assert.deepEqual(report.regions, ['us-west1']);
  assert.equal(report.acceptedEntries, 2);
  assert.equal(report.rejectedEntries, 1);
  assert.equal(report.totals.responseBytes, 1049088);
  assert.deepEqual(report.routes.map(route => route.route), ['/assets/*', '/api/media/tmdb/*']);
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /secret|app-123|private-installation|api_key/);

  const summary = buildMarkdownSummary(report);
  assert.match(summary, /Trafic Cloud Run agrégé/);
  assert.doesNotMatch(summary, /secret|app-123|api_key/);
});
