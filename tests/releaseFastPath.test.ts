import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

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
const requirements = JSON.parse(readFileSync('docs/specifications/requirements.json', 'utf8'));
const prepareScript = readFileSync('scripts/prepare-release.cjs', 'utf8');
const dispatchScript = readFileSync('scripts/dispatch-release.cjs', 'utf8');

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
  assert.match(prepareScript, /npm['"], \['run', 'version:sync'\]/);
  assert.equal((prepareScript.match(/\['commit', '-m'/g) || []).length, 1);
  assert.match(prepareScript, /rev-list', '--count'/);
  assert.match(prepareScript, /commitCount !== 1/);
});

test('SEENIT-RELEASE-002 le fast path est autonome, borné et sans Web/plugin', () => {
  assert.equal(packageJson.scripts['release:status'], 'node scripts/release-status.cjs');
  assert.equal(packageJson.scripts['release:prepare'], 'node scripts/prepare-release.cjs');
  assert.equal(packageJson.scripts['release:dispatch'], 'node scripts/dispatch-release.cjs');
  assert.match(agentRules, /Fast path.*publication APK/is);
  assert.match(agentRules, /release:status/);
  assert.match(agentRules, /ni sur le Web ni via des plugins/is);
  assert.match(bootstrapRules, /fast path.*APK/is);
  assert.match(deliveryProcess, /release:status/);
  assert.match(deliveryProcess, /gh workflow run build-apk\.yml/);
  assert.match(deliveryProcess, /demande.*workflow/is);
  assert.match(dispatchScript, /release_apk=true/);
  assert.ok(POLL_LIMIT * POLL_DELAY_MS <= 30_000, 'la recherche du run déclenché doit rester bornée à 30 s');
  assert.equal(parseRequestStart('1725460000000'), 1725460000000);
});


test("SEENIT-RELEASE-005 rend l'agent autonome jusqu'au workflow avec fallback navigateur", () => {
  const releaseRequirement = requirements.requirements.find((entry: { id: string }) => entry.id === 'SEENIT-RELEASE-005');
  assert.ok(releaseRequirement, 'l’exigence durable doit être cataloguée');
  assert.match(agentRules, /demande explicite de publication autorise l'agent à déclencher lui-même/is);
  assert.match(agentRules, /interface GitHub Actions via un navigateur authentifié contrôlable/is);
  assert.match(agentRules, /L'absence de `gh` ou de token shell ne constitue pas un blocage/is);
  assert.match(agentRules, /aucun run de release portant le même SHA\/version n'est déjà actif/is);
  assert.match(bootstrapRules, /autorise l'agent à déclencher et suivre lui-même la release jusqu'au résultat/is);
  assert.match(deliveryProcess, /vaut mandat opérationnel/is);
  assert.match(deliveryProcess, /interface GitHub Actions via un navigateur authentifié contrôlable/is);
  assert.match(deliveryProcess, /ne renvoie pas l'utilisateur vers « un clic\s+manuel »/is);
  assert.match(deliveryProcess, /épuisé les trois voies/is);
  assert.match(seenitSpec, /SEENIT-RELEASE-005/);
  assert.match(seenitSpec, /outil GitHub direct,[\s\S]*release:dispatch[\s\S]*navigateur authentifié/is);
});
