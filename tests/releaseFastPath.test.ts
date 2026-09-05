import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const {
  buildReleaseStatus,
  computeExpectedVersion,
  summarizeChecks
} = require('../scripts/release-status.cjs') as {
  buildReleaseStatus: (input: {
    mainSha: string;
    mainVersion: string;
    latestReleaseTag?: string | null;
    candidatePr?: any;
    candidateBranchExists?: boolean;
    candidateBasedOnMain?: boolean;
  }) => any;
  computeExpectedVersion: (mainVersion: string, latestReleaseTag?: string | null) => string;
  summarizeChecks: (checks: any[]) => string;
};
const {
  RELEASE_VERSION_FILES,
  assertCleanWorkspace,
  assertReleaseOnlyFiles,
  evaluateExistingCandidate,
  updateGradleVersionName,
  validateRequestedVersion
} = require('../scripts/prepare-release.cjs') as {
  RELEASE_VERSION_FILES: string[];
  assertCleanWorkspace: (status: string) => void;
  assertReleaseOnlyFiles: (files: string[]) => string[];
  evaluateExistingCandidate: (input: any) => { reusable: boolean; reason?: string; prNumber?: number | null };
  updateGradleVersionName: (source: string, version: string) => string;
  validateRequestedVersion: (input: any) => string;
};
const {
  prepareReleaseFiles,
  validateAlignedReleaseFiles
} = require('../scripts/prepare-release-files.cjs') as {
  prepareReleaseFiles: (version: string, options?: { rootDir?: string; requireAllEight?: boolean }) => {
    changedFiles: string[];
    version: string;
    versionCode: number;
    surfaces: number;
  };
  validateAlignedReleaseFiles: (version: string, options?: { rootDir?: string }) => any;
};
const {
  buildWorkflowDispatchRequest,
  dispatchReleaseWorkflow,
  parseReleaseControlCommand,
  validateReleaseControlEvent,
  validateReleasePreflight
} = require('../scripts/release-control.cjs') as {
  buildWorkflowDispatchRequest: (android12Smoke: boolean) => any;
  dispatchReleaseWorkflow: (input: any) => Promise<any>;
  parseReleaseControlCommand: (body: string) => any;
  validateReleaseControlEvent: (event: any) => any;
  validateReleasePreflight: (input: any) => any;
};
const { parseRequestStart, POLL_LIMIT, POLL_DELAY_MS } = require('../scripts/dispatch-release.cjs') as {
  parseRequestStart: (value: string | number | null) => number | null;
  POLL_LIMIT: number;
  POLL_DELAY_MS: number;
};

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const agentRules = readFileSync('AGENTS.md', 'utf8');
const bootstrapRules = readFileSync('.agents/AGENTS.md', 'utf8');
const deliveryProcess = readFileSync('docs/process/delivery.md', 'utf8');
const seenitSpec = readFileSync('docs/specifications/seenit.md', 'utf8');
const connectorReleaseSpec = readFileSync('docs/specifications/release-control.md', 'utf8');
const requirements = JSON.parse(readFileSync('docs/specifications/requirements.json', 'utf8'));
const prepareScript = readFileSync('scripts/prepare-release.cjs', 'utf8');
const prepareFilesScript = readFileSync('scripts/prepare-release-files.cjs', 'utf8');
const dispatchScript = readFileSync('scripts/dispatch-release.cjs', 'utf8');
const connectorControlScript = readFileSync('scripts/release-control.cjs', 'utf8');
const connectorControlWorkflow = readFileSync('.github/workflows/release-control.yml', 'utf8');

function writeFixture(root: string, relative: string, content: string) {
  const target = join(root, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

function createVersionFixture() {
  const root = mkdtempSync(join(tmpdir(), 'seenit-release-files-'));
  writeFixture(root, 'android/app/build.gradle', 'versionCode 104113\nversionName "1.4.113"\n');
  writeFixture(root, 'src/store/updateStore.ts', "export const CURRENT_APP_VERSION = '1.4.113';\n");
  writeFixture(root, 'server.ts', "const headers = { 'X-Plex-Version': '1.4.113' };\n");
  writeFixture(root, 'package.json', '{"name":"seenit-app","version":"1.4.113"}\n');
  writeFixture(root, 'package-lock.json', '{"name":"seenit-app","version":"1.4.113","packages":{"":{"name":"seenit-app","version":"1.4.113"}}}\n');
  writeFixture(root, 'docs/specifications/requirements.json', '{"schemaVersion":1,"applicationVersion":"1.4.113","requirements":[]}\n');
  writeFixture(root, 'docs/specifications/android-contract.json', '{"schemaVersion":1,"applicationVersion":"1.4.113","versionCode":104113}\n');
  writeFixture(root, 'docs/specifications/seenit.md', '# SeenIt\n\nVersion applicative : **1.4.113**\n');
  return root;
}

test('SEENIT-RELEASE-002 release:status expose l’état minimal et la prochaine action exacte', () => {
  const status = buildReleaseStatus({
    mainSha: 'a'.repeat(40),
    mainVersion: '1.4.112',
    latestReleaseTag: 'v1.4.112'
  });
  assert.equal(status.main.sha, 'a'.repeat(40));
  assert.equal(status.main.version, '1.4.112');
  assert.equal(status.latestRelease.tag, 'v1.4.112');
  assert.equal(status.expectedNextVersion, '1.4.113');
  assert.equal(status.candidate, null);
  assert.equal(status.action, 'prepare');
  assert.match(status.nextAction, /release:prepare -- 1\.4\.113/);
  assert.equal(computeExpectedVersion('1.4.113', 'v1.4.112'), '1.4.113');
});

test('SEENIT-RELEASE-002 release:status réutilise une candidate verte sans exploration supplémentaire', () => {
  const candidate = {
    number: 101,
    url: 'https://github.com/julfou7/seenit-app/pull/101',
    headRefOid: 'b'.repeat(40),
    statusCheckRollup: [
      { status: 'COMPLETED', conclusion: 'SUCCESS' },
      { status: 'COMPLETED', conclusion: 'SKIPPED' }
    ]
  };
  const status = buildReleaseStatus({
    mainSha: 'a'.repeat(40),
    mainVersion: '1.4.112',
    latestReleaseTag: 'v1.4.112',
    candidatePr: candidate,
    candidateBranchExists: true,
    candidateBasedOnMain: true
  });
  assert.equal(status.candidate.prNumber, 101);
  assert.equal(status.candidate.checks, 'green');
  assert.equal(status.action, 'merge_then_dispatch');
  assert.match(status.nextAction, /Fusionner la PR #101/);
  assert.equal(summarizeChecks([{ status: 'IN_PROGRESS', conclusion: null }]), 'pending');
  assert.equal(summarizeChecks([{ status: 'COMPLETED', conclusion: 'FAILURE' }]), 'failed');
});

test('SEENIT-RELEASE-002 release:status détecte une version déjà candidate sur main et passe au dispatch', () => {
  const status = buildReleaseStatus({
    mainSha: 'c'.repeat(40),
    mainVersion: '1.4.113',
    latestReleaseTag: 'v1.4.112'
  });
  assert.equal(status.expectedNextVersion, '1.4.113');
  assert.equal(status.action, 'dispatch');
  assert.match(status.nextAction, /release_apk=true/);
});

test('SEENIT-RELEASE-002 release:prepare valide la candidate, l’immuabilité et le workspace propre', () => {
  assert.doesNotThrow(() => assertCleanWorkspace(''));
  assert.throws(() => assertCleanWorkspace(' M src/App.tsx'), /Workspace sale/);
  assert.equal(validateRequestedVersion({
    targetVersion: '1.4.113',
    mainVersion: '1.4.112',
    latestReleaseTag: 'v1.4.112'
  }), '1.4.113');
  assert.throws(() => validateRequestedVersion({
    targetVersion: '1.4.113',
    mainVersion: '1.4.112',
    latestReleaseTag: 'v1.4.112',
    releaseExists: true
  }), /existe déjà/);
  assert.throws(() => validateRequestedVersion({
    targetVersion: '1.4.114',
    mainVersion: '1.4.112',
    latestReleaseTag: 'v1.4.112'
  }), /Version attendue 1\.4\.113/);
  assert.match(updateGradleVersionName('versionCode 104112\nversionName "1.4.112"', '1.4.113'), /versionName "1\.4\.113"/);
});

test('SEENIT-RELEASE-002 réutilise uniquement une branche et une PR compatibles', () => {
  const reusable = evaluateExistingCandidate({
    targetVersion: '1.4.113',
    branchVersion: '1.4.113',
    basedOnMain: true,
    changedFiles: RELEASE_VERSION_FILES,
    commitCount: 1,
    prNumber: 101
  });
  assert.equal(reusable.reusable, true);
  assert.equal(reusable.prNumber, 101);

  const stale = evaluateExistingCandidate({
    targetVersion: '1.4.113',
    branchVersion: '1.4.113',
    basedOnMain: false,
    changedFiles: RELEASE_VERSION_FILES,
    commitCount: 1
  });
  assert.equal(stale.reusable, false);
  assert.match(stale.reason || '', /main canonique/);

  const fragmented = evaluateExistingCandidate({
    targetVersion: '1.4.113',
    branchVersion: '1.4.113',
    basedOnMain: true,
    changedFiles: RELEASE_VERSION_FILES,
    commitCount: 7
  });
  assert.equal(fragmented.reusable, false);
  assert.match(fragmented.reason || '', /7 commits/);
});

test('SEENIT-RELEASE-002 la préparation est atomique et release-only', () => {
  assert.deepEqual(RELEASE_VERSION_FILES, [
    'android/app/build.gradle',
    'src/store/updateStore.ts',
    'server.ts',
    'package.json',
    'package-lock.json',
    'docs/specifications/requirements.json',
    'docs/specifications/android-contract.json',
    'docs/specifications/seenit.md'
  ]);
  assert.deepEqual(assertReleaseOnlyFiles(RELEASE_VERSION_FILES), RELEASE_VERSION_FILES);
  assert.throws(() => assertReleaseOnlyFiles([...RELEASE_VERSION_FILES, 'src/screens/HomeScreen.tsx']), /hors surfaces de version/);
  assert.match(prepareScript, /prepareReleaseFiles\(targetVersion/);
  assert.match(prepareScript, /rev-list', '--count'/);
  assert.match(prepareScript, /commitCount !== 1/);
  assert.doesNotMatch(prepareFilesScript, /spawnSync\(['"]gh|execFileSync\(['"]gh|ensureGh/);

  const root = createVersionFixture();
  try {
    const result = prepareReleaseFiles('1.4.114', { rootDir: root });
    assert.deepEqual(result.changedFiles, RELEASE_VERSION_FILES);
    assert.equal(result.version, '1.4.114');
    assert.equal(result.versionCode, 104114);
    assert.equal(result.surfaces, 8);
    assert.deepEqual(validateAlignedReleaseFiles('1.4.114', { rootDir: root }), {
      version: '1.4.114', versionCode: 104114, surfaces: 8
    });
    assert.match(readFileSync(join(root, 'server.ts'), 'utf8'), /X-Plex-Version': '1\.4\.114'/);
    assert.equal(JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')).packages[''].version, '1.4.114');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('SEENIT-RELEASE-002 le fast path est autonome, borné et sans Web/plugin', () => {
  assert.equal(packageJson.scripts['release:status'], 'node scripts/release-status.cjs');
  assert.equal(packageJson.scripts['release:prepare'], 'node scripts/prepare-release.cjs');
  assert.equal(packageJson.scripts['release:prepare:files'], 'node scripts/prepare-release-files.cjs');
  assert.equal(packageJson.scripts['release:dispatch'], 'node scripts/dispatch-release.cjs');
  assert.match(agentRules, /Fast path.*publication APK/is);
  assert.match(agentRules, /release:status/);
  assert.match(agentRules, /ni sur le Web ni via des plugins/is);
  assert.match(bootstrapRules, /fast path.*APK/is);
  assert.match(deliveryProcess, /release:status/);
  assert.match(deliveryProcess, /gh workflow run build-apk\.yml/);
  assert.match(dispatchScript, /release_apk=true/);
  assert.ok(POLL_LIMIT * POLL_DELAY_MS <= 30_000, 'la recherche du run déclenché doit rester bornée à 30 s');
  assert.equal(parseRequestStart('1725460000000'), 1725460000000);
});

test('SEENIT-RELEASE-005 refuse réellement auteur, issue, version, immuabilité et doublon', () => {
  const baseEvent = {
    repository: { full_name: 'julfou7/seenit-app', default_branch: 'main', owner: { login: 'julfou7' } },
    issue: { number: 102 },
    comment: {
      body: '/release-apk android12_smoke=true',
      author_association: 'OWNER',
      user: { login: 'julfou7' },
      created_at: '2026-09-05T07:00:00Z'
    }
  };
  assert.equal(validateReleaseControlEvent(baseEvent).android12Smoke, true);
  assert.equal(parseReleaseControlCommand('/release-apk')?.android12Smoke, false);
  assert.equal(parseReleaseControlCommand('/release-apk android12_smoke=true')?.android12Smoke, true);
  assert.equal(parseReleaseControlCommand('/release-apk android12_smoke=false'), null);
  assert.equal(parseReleaseControlCommand('/release-apk '), null);
  assert.throws(() => validateReleaseControlEvent({ ...baseEvent, issue: { number: 103 } }), /#102/);
  assert.throws(() => validateReleaseControlEvent({
    ...baseEvent,
    comment: { ...baseEvent.comment, user: { login: 'intrus' }, author_association: 'MEMBER' }
  }), /Auteur non autorisé/);

  const ok = {
    defaultBranch: 'main',
    checkoutSha: 'a'.repeat(40),
    mainSha: 'a'.repeat(40),
    mainVersion: '1.4.114',
    latestReleaseTag: 'v1.4.113',
    android12Smoke: true
  };
  assert.equal(validateReleasePreflight(ok).inputs.android12_smoke, 'true');
  assert.throws(() => validateReleasePreflight({ ...ok, checkoutSha: 'b'.repeat(40) }), /Checkout non canonique/);
  assert.throws(() => validateReleasePreflight({ ...ok, mainVersion: '1.4.115' }), /Version attendue 1\.4\.114/);
  assert.throws(() => validateReleasePreflight({ ...ok, tagExists: true }), /immuable/);
  assert.throws(() => validateReleasePreflight({ ...ok, releaseExists: true }), /immuable/);
  assert.throws(() => validateReleasePreflight({ ...ok, activeDuplicate: true }), /déjà actif/);
});

test("SEENIT-RELEASE-005 rend l'agent autonome jusqu'au workflow avec fallback navigateur", async () => {
  const releaseRequirement = requirements.requirements.find((entry: { id: string }) => entry.id === 'SEENIT-RELEASE-005');
  assert.ok(releaseRequirement, 'l’exigence durable doit être cataloguée');
  assert.match(connectorReleaseSpec, /extension normative de `SEENIT-RELEASE-005`/);
  assert.match(connectorControlWorkflow, /issue_comment:/);
  assert.match(connectorControlWorkflow, /github\.event\.issue\.number == 102/);
  assert.match(connectorControlWorkflow, /author_association == 'OWNER'/);
  assert.match(connectorControlWorkflow, /actions: write/);
  assert.match(connectorControlWorkflow, /cancel-in-progress: false/);
  assert.doesNotMatch(connectorControlScript, /\bgh\b|browser|navigateur/i);

  const calls: Array<{ path: string; options?: any }> = [];
  const request = async (path: string, options?: any) => {
    calls.push({ path, options });
    if (path.endsWith('/dispatches')) return null;
    return {
      workflow_runs: [{
        id: 700,
        event: 'workflow_dispatch',
        head_sha: 'a'.repeat(40),
        status: 'queued',
        html_url: 'https://github.com/julfou7/seenit-app/actions/runs/700'
      }]
    };
  };
  const run = await dispatchReleaseWorkflow({
    request,
    mainSha: 'a'.repeat(40),
    android12Smoke: true,
    previousRunIds: [699],
    pollLimit: 1,
    sleep: async () => undefined
  });
  assert.equal(run.id, 700);
  assert.equal(calls[0].path, '/actions/workflows/build-apk.yml/dispatches');
  assert.deepEqual(calls[0].options, buildWorkflowDispatchRequest(true));
  assert.deepEqual(calls[0].options.body, {
    ref: 'main',
    inputs: { release_apk: 'true', android12_smoke: 'true' }
  });
  assert.match(bootstrapRules, /connecteur GitHub/i);
  assert.match(seenitSpec, /SEENIT-RELEASE-005/);
});
