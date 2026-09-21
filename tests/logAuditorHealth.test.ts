import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  HEALTH_MARKER,
  buildHealthIssueBody,
  evaluateAuditorHealth,
  reportAuditorHealth,
} = require('../scripts/report-log-auditor-health.cjs') as {
  HEALTH_MARKER: string;
  buildHealthIssueBody: (health: any, env?: Record<string, string>) => string;
  evaluateAuditorHealth: (env?: Record<string, string>) => any;
  reportAuditorHealth: (input: any) => Promise<any>;
};

const healthyEnv = {
  SEENIT_LOG_AUDITOR_MODE: 'live',
  SEENIT_AUDITOR_AUTH_OUTCOME: 'success',
  SEENIT_AUDITOR_GCLOUD_OUTCOME: 'success',
  SEENIT_AUDITOR_COLLECT_OUTCOME: 'success',
  SEENIT_AUDITOR_TMDB_SUMMARY_OUTCOME: 'success',
  SEENIT_AUDITOR_TRAFFIC_SUMMARY_OUTCOME: 'success',
  SEENIT_AUDITOR_ENGINE_OUTCOME: 'success',
  SEENIT_AUDITOR_STRUCTURED_SOURCE_STATUS: 'ok',
  SEENIT_AUDITOR_TMDB_SOURCE_STATUS: 'ok',
  SEENIT_AUDITOR_TRAFFIC_SOURCE_STATUS: 'ok',
  GITHUB_REPOSITORY: 'julfou7/seenit-app',
  GITHUB_RUN_ID: '123',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_SHA: 'a'.repeat(40),
};

test('SEENIT-OBSERVABILITY-001 laisse un run sain sans issue watchdog', () => {
  const health = evaluateAuditorHealth(healthyEnv);
  assert.equal(health.degraded, false);
  assert.deepEqual(health.reasons, []);
});

test('SEENIT-OBSERVABILITY-001 détecte les angles morts de l’auditeur sans lire les logs', () => {
  const health = evaluateAuditorHealth({
    ...healthyEnv,
    SEENIT_AUDITOR_TMDB_SOURCE_STATUS: 'unavailable',
    SEENIT_AUDITOR_ENGINE_OUTCOME: 'failure',
  });
  assert.equal(health.degraded, true);
  assert.deepEqual(
    health.reasons.map((reason: any) => reason.surface),
    ['audit_engine', 'tmdb_source']
  );

  const body = buildHealthIssueBody(health, healthyEnv);
  assert.match(body, new RegExp(HEALTH_MARKER));
  assert.match(body, /tmdb_source/);
  assert.match(body, /audit_engine/);
  assert.doesNotMatch(body, /Bearer|token=|uid=|email|payload utilisateur.*:/i);
});

test('SEENIT-OBSERVABILITY-001 déduplique le watchdog et respecte son cooldown', async () => {
  const health = evaluateAuditorHealth({ ...healthyEnv, SEENIT_AUDITOR_STRUCTURED_SOURCE_STATUS: 'unavailable' });
  const calls: string[] = [];
  const github = {
    findOpenIssue: async () => ({ number: 42, updated_at: '2026-09-21T10:00:00.000Z' }),
    createIssue: async () => { calls.push('create'); return { number: 99 }; },
    commentIssue: async () => { calls.push('comment'); },
  };

  const result = await reportAuditorHealth({
    health,
    github,
    env: healthyEnv,
    now: new Date('2026-09-21T12:00:00.000Z'),
  });
  assert.equal(result.decision, 'cooldown');
  assert.deepEqual(calls, []);
});

test('SEENIT-OBSERVABILITY-001 crée puis enrichit une unique issue santé', async () => {
  const health = evaluateAuditorHealth({ ...healthyEnv, SEENIT_AUDITOR_TRAFFIC_SOURCE_STATUS: 'unavailable' });
  let existing: any = null;
  const calls: string[] = [];
  const github = {
    findOpenIssue: async () => existing,
    createIssue: async (body: string) => {
      calls.push('create');
      assert.match(body, /traffic_source/);
      existing = { number: 77, updated_at: '2026-09-21T00:00:00.000Z' };
      return existing;
    },
    commentIssue: async (number: number, body: string) => {
      calls.push(`comment:${number}`);
      assert.match(body, /traffic_source/);
    },
  };

  const created = await reportAuditorHealth({ health, github, env: healthyEnv, now: new Date('2026-09-21T12:00:00.000Z') });
  assert.equal(created.decision, 'created');

  const updated = await reportAuditorHealth({ health, github, env: healthyEnv, now: new Date('2026-09-21T12:00:00.000Z') });
  assert.equal(updated.decision, 'updated');
  assert.deepEqual(calls, ['create', 'comment:77']);
});
