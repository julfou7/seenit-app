import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/release-update-push.yml', 'utf8');
const releaseWorkflow = readFileSync('.github/workflows/build-apk.yml', 'utf8');
const notifyScript = readFileSync('scripts/notify-release-update.cjs', 'utf8');
const server = readFileSync('server.ts', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const firebase = readFileSync('src/lib/firebase.ts', 'utf8');
const updateStore = readFileSync('src/store/updateStore.ts', 'utf8');
const require = createRequire(import.meta.url);
const {
  EVENT_TYPE,
  buildRepositoryDispatchRequest,
  validateReleaseDispatchInput
} = require('../scripts/dispatch-release-update.cjs') as {
  EVENT_TYPE: string;
  buildRepositoryDispatchRequest: (input: { runId: number; headSha: string }) => any;
  validateReleaseDispatchInput: (input: {
    repository: string;
    runId: number;
    headSha: string;
    token: string;
  }) => void;
};
const { validateSourceRun, waitForSuccessfulSourceRun } = require('../scripts/notify-release-update.cjs') as {
  validateSourceRun: (run: any, expected: { repository: string; headSha: string }) => boolean;
  waitForSuccessfulSourceRun: (options: {
    fetchImpl: (url: string) => Promise<any>;
    sleepImpl: (delay: number) => Promise<void>;
    repositoryName: string;
    sourceRunId: number;
    sourceHeadSha: string;
    token: string;
    pollLimit: number;
    pollDelayMs: number;
  }) => Promise<void>;
};

test('SEENIT-UPDATE-003 déclenche l’alerte seulement après un workflow de release réussi', () => {
  assert.doesNotMatch(workflow, /workflow_run:/);
  assert.match(workflow, /repository_dispatch:/);
  assert.match(workflow, /types: \[seenit_apk_release_published\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /release_run_id:/);
  assert.match(workflow, /release_head_sha:/);
  assert.match(workflow, /Checkout trusted notification workflow revision/);
  assert.doesNotMatch(workflow, /ref:.*release_head_sha/);
  assert.match(releaseWorkflow, /Publish GitHub Release[\s\S]*Queue Android Update Notification/);
  assert.match(releaseWorkflow, /continue-on-error: true/);
  assert.match(releaseWorkflow, /RELEASE_RUN_ID: \$\{\{ github\.run_id \}\}/);
  assert.match(releaseWorkflow, /RELEASE_HEAD_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /RELEASE_WAIT_FOR_COMPLETION: 'true'/);
  assert.match(notifyScript, /const maxAttempts = 3/);
  assert.match(notifyScript, /runPollLimit = 30/);
  assert.match(notifyScript, /https:\/\/seenit\.ai\.studio\/api\/releases\/notify/);
  assert.match(server, /app\.post\('\/api\/releases\/notify'/);
  assert.match(server, /processReleaseUpdateNotificationRequest/);

  const headSha = 'a'.repeat(40);
  assert.equal(EVENT_TYPE, 'seenit_apk_release_published');
  assert.deepEqual(buildRepositoryDispatchRequest({ runId: 123, headSha }), {
    event_type: EVENT_TYPE,
    client_payload: { release_run_id: 123, release_head_sha: headSha }
  });
  assert.doesNotThrow(() => validateReleaseDispatchInput({
    repository: 'julfou7/seenit-app', runId: 123, headSha, token: 'token'
  }));
  assert.throws(() => validateReleaseDispatchInput({
    repository: 'fork/seenit-app', runId: 123, headSha, token: 'token'
  }), /non canonique/);

  const canonicalRun = {
    repository: { full_name: 'julfou7/seenit-app' },
    path: '.github/workflows/build-apk.yml',
    event: 'workflow_dispatch',
    head_branch: 'main',
    head_sha: headSha,
    status: 'completed',
    conclusion: 'success'
  };
  assert.equal(validateSourceRun(canonicalRun, {
    repository: 'julfou7/seenit-app', headSha
  }), true);
  assert.throws(() => validateSourceRun({ ...canonicalRun, conclusion: 'failure' }, {
    repository: 'julfou7/seenit-app', headSha
  }), /failure/);
});

test('SEENIT-UPDATE-003 attend de façon bornée la réussite du run source exact', async () => {
  const headSha = 'b'.repeat(40);
  const baseRun = {
    repository: { full_name: 'julfou7/seenit-app' },
    path: '.github/workflows/build-apk.yml',
    event: 'workflow_dispatch',
    head_branch: 'main',
    head_sha: headSha,
    conclusion: null
  };
  const sourceStates = [
    { ...baseRun, status: 'in_progress' },
    { ...baseRun, status: 'completed', conclusion: 'success' }
  ];
  const requestedUrls: string[] = [];
  const delays: number[] = [];

  await waitForSuccessfulSourceRun({
    fetchImpl: async (url: string) => {
      requestedUrls.push(url);
      const payload = sourceStates.shift();
      return { ok: true, json: async () => payload };
    },
    sleepImpl: async (delay: number) => { delays.push(delay); },
    repositoryName: 'julfou7/seenit-app',
    sourceRunId: 456,
    sourceHeadSha: headSha,
    token: 'token',
    pollLimit: 2,
    pollDelayMs: 25
  });

  assert.deepEqual(requestedUrls, [
    'https://api.github.com/repos/julfou7/seenit-app/actions/runs/456',
    'https://api.github.com/repos/julfou7/seenit-app/actions/runs/456'
  ]);
  assert.deepEqual(delays, [25]);
});

test('SEENIT-UPDATE-003 branche le clic Android sur le contrôle de mise à jour existant', () => {
  assert.match(app, /handleAppUpdateAvailablePush/);
  assert.match(app, /isAppUpdateAvailablePush/);
  assert.match(app, /useUpdateStore\.getState\(\)\.checkForUpdates/);
  assert.match(firebase, /queueAppUpdateAvailablePush\(payload\)/);
  assert.match(app, /consumeAppUpdateAvailablePush\(\)/);
});

test('SEENIT-UPDATE-004 conserve le tap pendant le contrôle de démarrage concurrent', () => {
  assert.match(app, /handleTabChange\('watchlist'\)/);
  assert.match(app, /requestUpdateModal\(\)/);
  assert.match(updateStore, /inFlightUpdateCheck/);
  assert.doesNotMatch(updateStore, /if \(isChecking\) return get\(\)\.hasUpdate/);
});
