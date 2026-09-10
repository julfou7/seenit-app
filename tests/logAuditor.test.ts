import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { buildOperationalEvent } from '../src/features/runtime/operationalEvent.ts';

const require = createRequire(import.meta.url);
const {
  MAX_INPUT_EVENTS,
  analyzeLogEntries,
  buildIssueBody,
  executeAudit,
  sanitizeValue
} = require('../scripts/audit-structured-logs.cjs') as {
  MAX_INPUT_EVENTS: number;
  analyzeLogEntries: (entries: unknown[], options?: { now?: Date }) => any;
  buildIssueBody: (group: any) => string;
  executeAudit: (input: any) => Promise<any>;
  sanitizeValue: (value: unknown) => unknown;
};

function apiError(index: number, errorCode = 'PERMISSION_DENIED') {
  return buildOperationalEvent(
    {
      code: 'API_UNHANDLED_ERROR',
      context: { method: 'GET', errorCode },
      domain: 'runtime',
      level: 'error'
    },
    {
      correlationId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      now: new Date(Date.UTC(2026, 8, 10, 10, 0, index % 60))
    }
  );
}

test('SEENIT-OBSERVABILITY-001 agrège les anomalies et applique les seuils déterministes', () => {
  const isolated = analyzeLogEntries([apiError(1)]);
  assert.equal(isolated.candidates.length, 0);
  assert.equal(isolated.groups[0].decision, 'below_threshold');

  const repeated = analyzeLogEntries(Array.from({ length: 20 }, (_, index) => apiError(index + 1)));
  assert.equal(repeated.candidates.length, 1);
  assert.equal(repeated.candidates[0].count, 20);

  const distinct = analyzeLogEntries([
    ...Array.from({ length: 5 }, (_, index) => apiError(index + 1, 'PERMISSION_DENIED')),
    ...Array.from({ length: 5 }, (_, index) => apiError(index + 101, 'UPSTREAM_TIMEOUT'))
  ]);
  assert.equal(distinct.candidates.length, 2);
  assert.notEqual(distinct.candidates[0].fingerprint, distinct.candidates[1].fingerprint);

  const historical = JSON.parse(
    fs.readFileSync(new URL('./fixtures/log-auditor-historical-redacted.json', import.meta.url), 'utf8')
  );
  const replay = analyzeLogEntries(historical);
  assert.equal(replay.candidates.length, 1);
  assert.equal(replay.candidates[0].context.errorCode, 'PERMISSION_DENIED');

  const startupLoop = analyzeLogEntries([
    buildOperationalEvent({
      code: 'BACKEND_STARTUP_FAILED',
      context: { errorCode: 'CONFIGURATION_ERROR' },
      domain: 'runtime',
      level: 'error'
    }),
    buildOperationalEvent({
      code: 'BACKEND_STARTUP_FAILED',
      context: { errorCode: 'CONFIGURATION_ERROR' },
      domain: 'runtime',
      level: 'error'
    })
  ]);
  assert.equal(startupLoop.candidates.length, 1);

  const plexReportOnly = analyzeLogEntries(Array.from({ length: 20 }, () => buildOperationalEvent({
    code: 'PLEX_SYNC_PARTIAL',
    context: { mode: 'delta', incompleteSourceCount: 2 },
    domain: 'plex',
    level: 'warn'
  })));
  assert.equal(plexReportOnly.candidates.length, 0);
  assert.equal(plexReportOnly.groups[0].decision, 'known_report_only');
});

test('SEENIT-OBSERVABILITY-001 déduplique et borne les écritures GitHub', async () => {
  const analysis = analyzeLogEntries(Array.from({ length: 20 }, (_, index) => apiError(index + 1)));
  const calls = { comments: 0, creates: 0 };
  const existingGithub = {
    addIssueComment: async () => { calls.comments += 1; },
    countIssuesCreatedSinceUtcDay: async () => 0,
    createIssue: async () => { calls.creates += 1; return { number: 999 }; },
    findOpenIssue: async () => ({ number: 321, updatedAt: '2026-09-09T00:00:00.000Z' })
  };
  const updated = await executeAudit({
    analysis,
    github: existingGithub,
    mode: 'live',
    now: new Date('2026-09-10T12:00:00.000Z')
  });
  assert.equal(calls.comments, 1);
  assert.equal(calls.creates, 0);
  assert.equal(updated.actions[0].decision, 'existing_issue_updated');

  const cooldownGithub = {
    ...existingGithub,
    findOpenIssue: async () => ({ number: 321, updatedAt: '2026-09-10T11:00:00.000Z' })
  };
  const cooledDown = await executeAudit({
    analysis,
    github: cooldownGithub,
    mode: 'live',
    now: new Date('2026-09-10T12:00:00.000Z')
  });
  assert.equal(cooledDown.actions[0].decision, 'existing_issue_cooldown');
  assert.equal(calls.comments, 1);

  const storm = analyzeLogEntries(Array.from({ length: MAX_INPUT_EVENTS + 500 }, (_, index) => apiError(index + 1)));
  const creationGithub = {
    ...existingGithub,
    addIssueComment: async () => { throw new Error('inattendu'); },
    createIssue: async () => { calls.creates += 1; return { number: 654 }; },
    findOpenIssue: async () => null
  };
  const bounded = await executeAudit({ analysis: storm, github: creationGithub, mode: 'live' });
  assert.equal(storm.truncatedCount, 500);
  assert.equal(bounded.actions.filter((action: any) => action.decision === 'new_issue_created').length, 1);

  const dailyLimitGithub = {
    ...creationGithub,
    countIssuesCreatedSinceUtcDay: async () => 3
  };
  const rateLimited = await executeAudit({ analysis, github: dailyLimitGithub, mode: 'live' });
  assert.equal(rateLimited.actions[0].decision, 'daily_rate_limited');

  const fourCandidates = analyzeLogEntries([
    ...Array.from({ length: 5 }, (_, index) => apiError(index + 1, 'ERROR_ALPHA')),
    ...Array.from({ length: 5 }, (_, index) => apiError(index + 101, 'ERROR_BETA')),
    ...Array.from({ length: 5 }, (_, index) => apiError(index + 201, 'ERROR_GAMMA')),
    ...Array.from({ length: 5 }, (_, index) => apiError(index + 301, 'ERROR_DELTA'))
  ]);
  let runCreates = 0;
  const capped = await executeAudit({
    analysis: fourCandidates,
    github: {
      ...creationGithub,
      createIssue: async () => ({ number: 700 + ++runCreates }),
      countIssuesCreatedSinceUtcDay: async () => 0
    },
    mode: 'live'
  });
  assert.equal(runCreates, 3);
  assert.equal(capped.actions.filter((action: any) => action.decision === 'run_rate_limited').length, 1);

  const unavailable = await executeAudit({
    analysis,
    github: { findOpenIssue: async () => { throw new Error('GitHub offline'); } },
    mode: 'live'
  });
  assert.equal(unavailable.degraded, true);
  assert.equal(unavailable.actions[0].decision, 'github_unavailable');
  assert.equal(unavailable.groups[0].count, 20);

  const sourceUnavailable = await executeAudit({
    analysis,
    github: { findOpenIssue: async () => { throw new Error('ne doit pas être appelé'); } },
    mode: 'live',
    sourceStatus: 'unavailable'
  });
  assert.equal(sourceUnavailable.actions[0].decision, 'source_unavailable');
  assert.equal(sourceUnavailable.degraded, true);
});

test('SEENIT-OBSERVABILITY-001 exclut secrets UID emails et chemins privés des rapports', () => {
  const secretValues = {
    authorization: 'Bearer fake-token-value',
    email: 'personne@example.test',
    path: 'C:\\Users\\personne\\secret.txt',
    uid: 'firebase-user-uid-1234567890'
  };
  const entries = Array.from({ length: 5 }, (_, index) => ({
    ...apiError(index + 1),
    seenitEvent: {
      ...apiError(index + 1).seenitEvent,
      context: {
        ...apiError(index + 1).seenitEvent.context,
        ...secretValues,
        message: 'Bearer another-token personne@example.test /home/personne/private.txt',
        title: 'Titre personnel'
      }
    }
  }));
  const analysis = analyzeLogEntries(entries);
  const body = buildIssueBody(analysis.candidates[0]);
  const report = JSON.stringify(sanitizeValue({ analysis, secretValues }));

  for (const forbidden of [
    'fake-token-value',
    'another-token',
    'personne@example.test',
    'firebase-user-uid-1234567890',
    'secret.txt',
    'private.txt',
    'Titre personnel'
  ]) {
    assert.doesNotMatch(body, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(report, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(body, /seenit-log-fingerprint:/);
  assert.match(body, /Créée automatiquement par l’auditeur de logs SeenIt/);

  const guardedEnvelope = buildOperationalEvent(
    {
      code: 'API_UNHANDLED_ERROR',
      context: { method: 'GET', errorCode: 'Bearer not-a-code personne@example.test' },
      domain: 'runtime',
      level: 'error'
    },
    { correlationId: 'personne@example.test' }
  );
  assert.equal(guardedEnvelope.seenitEvent.context.errorCode, 'API_ERROR');
  assert.match(guardedEnvelope.seenitEvent.correlationId, /^[a-f0-9-]{36}$/);
  assert.doesNotMatch(JSON.stringify(guardedEnvelope), /personne@example\.test|not-a-code/);
});
