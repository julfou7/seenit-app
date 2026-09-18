import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const {
  buildWorkflowDispatchRequest,
  findMainValidationRun,
  parseReleaseControlCommand,
  validateReleasePreflight,
  waitForSuccessfulMainValidation
} = require('../scripts/release-control.cjs') as {
  buildWorkflowDispatchRequest: (android12Smoke: boolean, fastTerrain?: boolean) => any;
  findMainValidationRun: (runs: any[], mainSha: string) => any;
  parseReleaseControlCommand: (body: string) => any;
  validateReleasePreflight: (input: any) => any;
  waitForSuccessfulMainValidation: (input: any) => Promise<any>;
};
const { buildRepositoryDispatchRequest } = require('../scripts/dispatch-release-update.cjs') as {
  buildRepositoryDispatchRequest: (input: { runId: number; headSha: string; fastTerrain?: boolean }) => any;
};
const { buildFinalReleaseSummary } = require('../scripts/notify-release-update.cjs') as {
  buildFinalReleaseSummary: (input: any) => string;
};

const releaseWorkflow = readFileSync('.github/workflows/build-apk.yml', 'utf8');
const controlWorkflow = readFileSync('.github/workflows/release-control.yml', 'utf8');
const agentRules = readFileSync('AGENTS.md', 'utf8');
const delivery = readFileSync('docs/process/delivery.md', 'utf8');
const releaseSpec = readFileSync('docs/specifications/release-control.md', 'utf8');

test('issue #368 expose une commande terrain distincte sans changer la release complète', () => {
  assert.deepEqual(parseReleaseControlCommand('/release-terrain'), {
    action: 'release',
    android12Smoke: false,
    fastTerrain: true,
    command: '/release-terrain'
  });
  assert.equal(parseReleaseControlCommand('/release-terrain '), null);
  assert.equal(parseReleaseControlCommand('/release-terrain android12_smoke=true'), null);

  assert.deepEqual(buildWorkflowDispatchRequest(false), {
    method: 'POST',
    body: { ref: 'main', inputs: { release_apk: 'true', android12_smoke: 'false' } }
  });
  assert.deepEqual(buildWorkflowDispatchRequest(false, true), {
    method: 'POST',
    body: {
      ref: 'main',
      inputs: { release_apk: 'true', android12_smoke: 'false', fast_terrain: 'true' }
    }
  });

  const preflight = validateReleasePreflight({
    defaultBranch: 'main',
    checkoutSha: 'a'.repeat(40),
    mainSha: 'a'.repeat(40),
    mainVersion: '1.4.158',
    latestReleaseTag: 'v1.4.157',
    fastTerrain: true
  });
  assert.equal(preflight.inputs.fast_terrain, 'true');
  assert.throws(() => validateReleasePreflight({
    defaultBranch: 'main',
    checkoutSha: 'a'.repeat(40),
    mainSha: 'a'.repeat(40),
    mainVersion: '1.4.158',
    latestReleaseTag: 'v1.4.157',
    fastTerrain: true,
    android12Smoke: true
  }), /terrain rapide.*Android 12/i);
});

test('issue #368 exige une validation push verte du SHA main exact avant le fast terrain', async () => {
  const mainSha = 'd'.repeat(40);
  const otherSha = 'e'.repeat(40);
  const exact = {
    id: 91,
    event: 'push',
    head_branch: 'main',
    head_sha: mainSha,
    status: 'completed',
    conclusion: 'success',
    html_url: 'https://example.test/run/91'
  };
  assert.equal(findMainValidationRun([
    { ...exact, id: 90, head_sha: otherSha },
    exact
  ], mainSha)?.id, 91);

  let reads = 0;
  const success = await waitForSuccessfulMainValidation({
    mainSha,
    pollLimit: 3,
    sleep: async () => undefined,
    request: async () => {
      reads += 1;
      return {
        workflow_runs: reads === 1
          ? [{ ...exact, status: 'in_progress', conclusion: null }]
          : [exact]
      };
    }
  });
  assert.equal(success.id, 91);
  assert.equal(reads, 2);

  await assert.rejects(waitForSuccessfulMainValidation({
    mainSha,
    pollLimit: 1,
    sleep: async () => undefined,
    request: async () => ({
      workflow_runs: [{ ...exact, conclusion: 'failure' }]
    })
  }), /validation main.*failure.*fast terrain refusé/i);

  await assert.rejects(waitForSuccessfulMainValidation({
    mainSha,
    pollLimit: 1,
    sleep: async () => undefined,
    request: async () => ({ workflow_runs: [{ ...exact, head_sha: otherSha }] })
  }), /aucune validation main verte.*fast terrain refusé/i);
});

test('issue #368 garde le build installable et retire seulement le cérémonial du chemin critique terrain', () => {
  assert.match(releaseWorkflow, /fast_terrain:/);
  assert.match(controlWorkflow, /\/release-terrain/);

  for (const step of [
    'Classify Release Candidate',
    'Specification Change Contract',
    'Release Automated Tests',
    'Production Dependency Audit',
    'Upload Android Upgrade Test Harness',
    'Download and Verify Previous Official Release',
    'Enable KVM',
    'Run N to N\+1 Upgrade Smoke on Android 36'
  ]) {
    const index = releaseWorkflow.indexOf(`- name: ${step}`);
    assert.ok(index >= 0, `${step} absent`);
    const block = releaseWorkflow.slice(index, index + 500);
    assert.match(block, /if: inputs\.fast_terrain != true/, `${step} doit être hors fast terrain`);
  }

  assert.match(releaseWorkflow, /Build Web Assets/);
  assert.match(releaseWorkflow, /Sync Capacitor Android/);
  assert.match(releaseWorkflow, /Revalidate Android Contract After Capacitor Sync/);
  assert.match(releaseWorkflow, /:app:assembleDebug --stacktrace/);
  assert.match(releaseWorkflow, /Prepare Named APK/);
  assert.match(releaseWorkflow, /sha256sum/);
  assert.match(releaseWorkflow, /Publish GitHub Release/);
  assert.match(releaseWorkflow, /Queue Android Update Notification/);
  assert.match(releaseWorkflow, /RELEASE_FAST_TERRAIN: \$\{\{ inputs\.fast_terrain \}\}/);
  assert.match(releaseWorkflow, /inputs\.fast_terrain != true && inputs\.android12_smoke == true/);
});

test('issue #368 propage le mode terrain au checkpoint sans changer le payload historique', () => {
  const headSha = 'b'.repeat(40);
  assert.deepEqual(buildRepositoryDispatchRequest({ runId: 12, headSha }), {
    event_type: 'seenit_apk_release_published',
    client_payload: { release_run_id: 12, release_head_sha: headSha }
  });
  assert.deepEqual(buildRepositoryDispatchRequest({ runId: 12, headSha, fastTerrain: true }), {
    event_type: 'seenit_apk_release_published',
    client_payload: { release_run_id: 12, release_head_sha: headSha, fast_terrain: true }
  });

  const summary = buildFinalReleaseSummary({
    release: {
      tag_name: 'v1.4.158',
      assets: [{
        name: 'SeenIt-v1.4.158.apk',
        browser_download_url: 'https://example.test/SeenIt-v1.4.158.apk',
        digest: `sha256:${'c'.repeat(64)}`
      }]
    },
    sourceRunId: 42,
    sourceHeadSha: headSha,
    notification: { status: 'sent', sent: 1, alreadySent: 0, invalid: 0 },
    fastTerrain: true
  });
  assert.match(summary, /Mode : ⚡ terrain rapide/);
  assert.match(summary, /Smoke Android 36 : ⏭️ non bloquant/);
  assert.match(summary, /Notification Android : ✅ 1 envoyée/);
});

test('issue #368 formalise la boucle terrain automatique et le SLO téléphone', () => {
  assert.match(agentRules, /release terrain/i);
  assert.match(agentRules, /\/release-terrain/);
  assert.match(agentRules, /(?:ne doit pas avoir à relancer séparément|sans nouvelle demande utilisateur)/i);
  assert.match(agentRules, /premier.*terrain.*(?:rouge|KO)/is);
  assert.match(agentRules, /chemin.*production/i);
  assert.match(agentRules, /<!-- seenit-resume -->/);
  assert.match(agentRules, /(?:mis|mettre) à jour.*en place/i);

  assert.match(delivery, /release terrain/i);
  assert.match(delivery, /10 minutes/i);
  assert.match(delivery, /mise à jour\s+(?:intégrée\s+)?installable/i);
  assert.match(delivery, /<!-- seenit-resume -->/);
  assert.match(releaseSpec, /\/release-terrain/);
  assert.match(releaseSpec, /terrain rapide/i);
});