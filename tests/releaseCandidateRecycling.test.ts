import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOT_NAME,
  CONTROLLER_COMMIT_MARKER,
  deleteRemoteCandidateRef,
  evaluateRecyclableRemoteCandidate,
  isControllerGeneratedCandidateCommit
} from '../scripts/prepare-release-control.cjs';
import { RELEASE_VERSION_FILES } from '../scripts/prepare-release.cjs';

const targetVersion = '1.4.151';
const mainSha = 'b'.repeat(40);
const branchSha = 'c'.repeat(40);
const staleBaseSha = 'a'.repeat(40);
const releaseFiles = RELEASE_VERSION_FILES.map(filename => ({ filename }));

function controllerCommit(overrides: Record<string, unknown> = {}) {
  return {
    sha: branchSha,
    author: { login: BOT_NAME },
    committer: { login: BOT_NAME },
    commit: {
      message: [
        `chore(release): préparer SeenIt ${targetVersion}`,
        '',
        'Changelog: aucun',
        '',
        'Détails techniques:',
        '- Aligne atomiquement les 8 surfaces canoniques de version.',
        `- ${CONTROLLER_COMMIT_MARKER}`
      ].join('\n')
    },
    ...overrides
  };
}

function staleCompare(overrides: Record<string, unknown> = {}) {
  return {
    merge_base_commit: { sha: staleBaseSha },
    ahead_by: 1,
    behind_by: 1,
    files: releaseFiles,
    ...overrides
  };
}

test('SEENIT-RELEASE-005 recycle uniquement une candidate contrôleur abandonnée devenue obsolète par avance de main', () => {
  const commit = controllerCommit();
  assert.equal(isControllerGeneratedCandidateCommit(commit, targetVersion), true);
  assert.deepEqual(evaluateRecyclableRemoteCandidate({
    mainSha,
    branchSha,
    compare: staleCompare(),
    branchVersion: targetVersion,
    targetVersion,
    candidateCommit: commit,
    candidatePrs: []
  }), { recyclable: true });
});

test('SEENIT-RELEASE-005 recycle une candidate contrôleur après une PR fermée non mergée', () => {
  assert.deepEqual(evaluateRecyclableRemoteCandidate({
    mainSha,
    branchSha,
    compare: staleCompare(),
    branchVersion: targetVersion,
    targetVersion,
    candidateCommit: controllerCommit(),
    candidatePrs: [{ number: 483, state: 'closed', merged_at: null }]
  }), { recyclable: true });
});

test('SEENIT-RELEASE-005 refuse de recycler une branche humaine, une PR active ou mergée et un diff hors contrat', () => {
  const humanCommit = controllerCommit({
    author: { login: 'julfou7' },
    committer: { login: 'julfou7' }
  });
  assert.equal(isControllerGeneratedCandidateCommit(humanCommit, targetVersion), false);

  const baseInput = {
    mainSha,
    branchSha,
    compare: staleCompare(),
    branchVersion: targetVersion,
    targetVersion,
    candidateCommit: controllerCommit(),
    candidatePrs: [] as any[]
  };

  assert.equal(evaluateRecyclableRemoteCandidate({
    ...baseInput,
    candidateCommit: humanCommit
  }).recyclable, false);
  assert.equal(evaluateRecyclableRemoteCandidate({
    ...baseInput,
    candidatePrs: [{ number: 326, state: 'open', merged_at: null }]
  }).recyclable, false);
  assert.equal(evaluateRecyclableRemoteCandidate({
    ...baseInput,
    candidatePrs: [{ number: 327, state: 'closed', merged_at: '2026-09-21T12:00:00Z' }]
  }).recyclable, false);
  assert.equal(evaluateRecyclableRemoteCandidate({
    ...baseInput,
    compare: staleCompare({ files: [...releaseFiles, { filename: 'src/App.tsx' }] })
  }).recyclable, false);
  assert.equal(evaluateRecyclableRemoteCandidate({
    ...baseInput,
    compare: staleCompare({ ahead_by: 2 })
  }).recyclable, false);
  assert.equal(evaluateRecyclableRemoteCandidate({
    ...baseInput,
    compare: staleCompare({ merge_base_commit: { sha: mainSha }, behind_by: 0 })
  }).recyclable, false);
});

test('SEENIT-RELEASE-005 relit le SHA avant DELETE ref et refuse toute course sans force-push', async () => {
  const calls: Array<{ path: string; method: string }> = [];
  const request = async (path: string, options: { method?: string } = {}) => {
    const method = options.method || 'GET';
    calls.push({ path, method });
    if (method === 'GET') return { object: { sha: branchSha } };
    if (method === 'DELETE') return null;
    throw new Error(`Méthode inattendue ${method}`);
  };

  await deleteRemoteCandidateRef(request, 'release/v1.4.151', branchSha);
  assert.deepEqual(calls, [
    { path: '/git/ref/heads/release%2Fv1.4.151', method: 'GET' },
    { path: '/git/refs/heads/release%2Fv1.4.151', method: 'DELETE' }
  ]);

  const changedCalls: Array<{ path: string; method: string }> = [];
  const changedRequest = async (path: string, options: { method?: string } = {}) => {
    const method = options.method || 'GET';
    changedCalls.push({ path, method });
    return { object: { sha: 'd'.repeat(40) } };
  };
  await assert.rejects(
    () => deleteRemoteCandidateRef(changedRequest, 'release/v1.4.151', branchSha),
    /a changé pendant le recyclage/
  );
  assert.deepEqual(changedCalls, [
    { path: '/git/ref/heads/release%2Fv1.4.151', method: 'GET' }
  ]);
});
