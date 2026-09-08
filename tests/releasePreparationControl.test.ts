import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PREPARE_COMMAND,
  buildCandidateBranchName,
  evaluateRemoteCandidate,
  resolvePreparationTarget,
  sameReleaseFiles,
  validatePrepareControlEvent
} from '../scripts/prepare-release-control.cjs';
import { RELEASE_VERSION_FILES } from '../scripts/prepare-release.cjs';
import { buildFinalReleaseSummary } from '../scripts/notify-release-update.cjs';

const workflow = readFileSync(new URL('../.github/workflows/release-control.yml', import.meta.url), 'utf8');
const notificationWorkflow = readFileSync(new URL('../.github/workflows/release-update-push.yml', import.meta.url), 'utf8');
const agents = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');
const bootstrapAgents = readFileSync(new URL('../.agents/AGENTS.md', import.meta.url), 'utf8');
const releaseControlSpec = readFileSync(new URL('../docs/specifications/release-control.md', import.meta.url), 'utf8');

function event(body = PREPARE_COMMAND) {
  return {
    repository: { full_name: 'julfou7/seenit-app', default_branch: 'main', owner: { login: 'julfou7' } },
    issue: { number: 102 },
    comment: { body, author_association: 'OWNER', user: { login: 'julfou7' }, created_at: '2026-09-08T10:00:00Z' }
  };
}

test('SEENIT-RELEASE-005 autorise uniquement /prepare-release-apk sur #102 par OWNER', () => {
  assert.equal(validatePrepareControlEvent(event()).command, PREPARE_COMMAND);
  assert.throws(() => validatePrepareControlEvent(event('/prepare-release-apk ')), /Commande refusée/);
  const wrongIssue = event();
  wrongIssue.issue.number = 103;
  assert.throws(() => validatePrepareControlEvent(wrongIssue), /issue de contrôle #102/);
  const wrongActor = event();
  wrongActor.comment.user.login = 'other';
  assert.throws(() => validatePrepareControlEvent(wrongActor), /Auteur non autorisé/);
});

test('SEENIT-RELEASE-005 calcule la candidate depuis la dernière release sans consommer un numéro déjà préparé', () => {
  assert.deepEqual(resolvePreparationTarget({ mainVersion: '1.4.122', latestReleaseTag: 'v1.4.122' }), {
    action: 'prepare', latestVersion: '1.4.122', targetVersion: '1.4.123'
  });
  assert.deepEqual(resolvePreparationTarget({ mainVersion: '1.4.123', latestReleaseTag: 'v1.4.122' }), {
    action: 'ready_to_release', latestVersion: '1.4.122', targetVersion: '1.4.123'
  });
  assert.throws(
    () => resolvePreparationTarget({ mainVersion: '1.4.125', latestReleaseTag: 'v1.4.122' }),
    /État de version inattendu/
  );
  assert.equal(buildCandidateBranchName('1.4.123'), 'release/v1.4.123');
});

test('SEENIT-RELEASE-005 ne réutilise qu’une candidate exactement à +1 commit et 8 surfaces', () => {
  const files = RELEASE_VERSION_FILES.map(filename => ({ filename }));
  assert.equal(sameReleaseFiles(files), true);
  assert.deepEqual(evaluateRemoteCandidate({
    mainSha: 'a'.repeat(40),
    branchSha: 'b'.repeat(40),
    branchVersion: '1.4.123',
    compare: {
      targetVersion: '1.4.123',
      merge_base_commit: { sha: 'a'.repeat(40) },
      ahead_by: 1,
      behind_by: 0,
      files
    }
  }), { reusable: true });

  assert.equal(evaluateRemoteCandidate({
    mainSha: 'a'.repeat(40),
    branchSha: 'b'.repeat(40),
    branchVersion: '1.4.123',
    compare: {
      targetVersion: '1.4.123',
      merge_base_commit: { sha: 'a'.repeat(40) },
      ahead_by: 2,
      behind_by: 0,
      files
    }
  }).reusable, false);

  assert.equal(sameReleaseFiles([...files, { filename: 'src/App.tsx' }]), false);
});

test('workflow de contrôle sépare les permissions préparation et publication', () => {
  assert.match(workflow, /github\.event\.comment\.body == '\/prepare-release-apk'/);
  assert.match(workflow, /prepare_candidate:[\s\S]*?contents: write[\s\S]*?pull-requests: write/);
  assert.match(workflow, /release_control:[\s\S]*?actions: write[\s\S]*?contents: read/);
  assert.doesNotMatch(workflow.match(/release_control:[\s\S]*$/)?.[0] || '', /pull-requests: write/);
});

test('les consignes interdisent le fallback manuel tant que #102 sait préparer la candidate', () => {
  for (const source of [agents, bootstrapAgents, releaseControlSpec]) {
    assert.match(source, /\/prepare-release-apk/);
  }
  assert.match(agents, /ne justifie plus la reproduction manuelle des huit fichiers/);
  assert.match(bootstrapAgents, /n'est jamais un motif pour reproduire manuellement les huit fichiers/);
  assert.match(releaseControlSpec, /n’est pas un blocage/);
  assert.match(releaseControlSpec, /seenit-release-summary:<runId>/);
});

test('notification post-release peut écrire le checkpoint final sur #102', () => {
  assert.match(notificationWorkflow, /issues: write/);
  const body = buildFinalReleaseSummary({
    release: {
      tag_name: 'v1.4.123',
      assets: [{
        name: 'SeenIt-v1.4.123.apk',
        browser_download_url: 'https://example.test/SeenIt-v1.4.123.apk',
        digest: `sha256:${'c'.repeat(64)}`
      }]
    },
    sourceRunId: 12345,
    sourceHeadSha: 'd'.repeat(40),
    notification: { status: 'sent', sent: 1, alreadySent: 0, invalid: 0 }
  });
  assert.match(body, /seenit-release-summary:12345/);
  assert.match(body, /Release v1\.4\.123 finalisée/);
  assert.match(body, /Smoke Android 36 : ✅/);
  assert.match(body, new RegExp('c'.repeat(64)));
  assert.match(body, /Notification Android : ✅ 1 envoyée/);
});

test('checkpoint final reste publié quand la notification échoue', () => {
  const body = buildFinalReleaseSummary({
    release: { tag_name: 'v1.4.123', assets: [] },
    sourceRunId: 12345,
    sourceHeadSha: 'd'.repeat(40),
    notification: null,
    notificationError: new Error('Backend indisponible')
  });
  assert.match(body, /notification en échec/);
  assert.match(body, /Notification Android : ❌ Backend indisponible/);
});
