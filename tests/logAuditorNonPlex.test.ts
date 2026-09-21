import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { buildOperationalEvent } from '../src/features/runtime/operationalEvent.ts';

const require = createRequire(import.meta.url);
interface AuditGroup {
  code: string;
  context: Record<string, unknown>;
  count: number;
  decision: string;
}
interface AuditAnalysis {
  candidates: AuditGroup[];
  groups: AuditGroup[];
}
const {
  RULES,
  analyzeLogEntries,
  buildIssueTitle,
} = require('../scripts/audit-structured-logs.cjs') as {
  RULES: Record<string, { autoIssue: boolean; threshold: number }>;
  analyzeLogEntries: (entries: unknown[]) => AuditAnalysis;
  buildIssueTitle: (group: AuditGroup & { priority?: string; domain?: string; title?: string }) => string;
};

test('SEENIT-OBSERVABILITY-001 couvre les domaines non-Plex et pondère les agrégats', () => {
  const provider = analyzeLogEntries([
    buildOperationalEvent({
      code: 'PROVIDER_UPSTREAM_FAILED',
      context: { provider: 'tmdb', status: 503, count: 5 },
      domain: 'providers',
      level: 'warn',
    }),
    buildOperationalEvent({
      code: 'PROVIDER_UPSTREAM_FAILED',
      context: { provider: 'tmdb', status: 503, count: 5 },
      domain: 'providers',
      level: 'warn',
    }),
  ]);
  assert.equal(provider.candidates.length, 1);
  assert.equal(provider.candidates[0].count, 10);
  assert.deepEqual(provider.candidates[0].context, {
    provider: 'tmdb',
    status: 503,
    count: 5,
  });

  const parental = analyzeLogEntries([
    buildOperationalEvent({
      code: 'PARENTAL_RATING_PROVIDER_FAILED',
      context: { count: 12 },
      domain: 'providers',
      level: 'warn',
    }),
  ]);
  assert.equal(parental.candidates.length, 1);
  assert.equal(parental.candidates[0].count, 12);

  const firestore = analyzeLogEntries([
    buildOperationalEvent({
      code: 'FIRESTORE_CLIENT_SYNC_FAILED',
      context: { count: 5, uid: 'interdit', message: 'interdit' },
      domain: 'firestore',
      level: 'warn',
    }),
  ]);
  assert.equal(firestore.candidates.length, 1);
  assert.deepEqual(firestore.candidates[0].context, { count: 5 });

  assert.equal(RULES.NOTIFICATION_CLIENT_FAILED.autoIssue, true);
  assert.equal(RULES.DOWNLOAD_CLIENT_SYNC_FAILED.autoIssue, true);
  assert.equal(RULES.APP_UPDATE_CLIENT_FAILED.autoIssue, true);
  assert.equal(RULES.CACHE_CLIENT_STORAGE_FAILED.autoIssue, true);
});

test('SEENIT-OBSERVABILITY-001 garde les indisponibilités de services privés en report-only', () => {
  const privateServiceOffline = analyzeLogEntries(
    Array.from({ length: 20 }, () => buildOperationalEvent({
      code: 'DOWNLOAD_SERVICE_PROXY_FAILED',
      context: { errorCode: 'TIMEOUT', url: 'http://adresse-privee/' },
      domain: 'downloads',
      level: 'warn',
    }))
  );

  assert.equal(privateServiceOffline.candidates.length, 0);
  assert.equal(privateServiceOffline.groups[0].decision, 'known_report_only');
  assert.deepEqual(privateServiceOffline.groups[0].context, { errorCode: 'TIMEOUT' });
});

test('SEENIT-OBSERVABILITY-001 produit des titres GitHub par domaine sans contexte personnel', () => {
  const update = analyzeLogEntries([
    buildOperationalEvent({
      code: 'APP_UPDATE_CLIENT_FAILED',
      context: { count: 4 },
      domain: 'release',
      level: 'warn',
    }),
  ]);
  const candidate = update.candidates[0];
  assert.match(buildIssueTitle({ ...candidate, priority: 'P1', domain: 'release', title: 'Échecs répétés' }), /\[Mise à jour\]/);
});
