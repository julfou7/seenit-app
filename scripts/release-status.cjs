const { execFileSync, spawnSync } = require('node:child_process');

const RELEASE_WORKFLOW = 'build-apk.yml';
const RELEASE_BRANCH_PREFIX = 'release/v';
const PASSING_CONCLUSIONS = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);
const PASSING_STATES = new Set(['SUCCESS']);
const PENDING_STATES = new Set(['PENDING', 'EXPECTED']);

function parseSemver(value) {
  const match = String(value || '').trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function formatSemver(version) {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function compareSemver(left, right) {
  const a = typeof left === 'string' ? parseSemver(left) : left;
  const b = typeof right === 'string' ? parseSemver(right) : right;
  if (!a || !b) throw new Error('Comparaison SemVer impossible.');
  if (a.major !== b.major) return Math.sign(a.major - b.major);
  if (a.minor !== b.minor) return Math.sign(a.minor - b.minor);
  return Math.sign(a.patch - b.patch);
}

function nextPatch(value) {
  const parsed = parseSemver(value);
  if (!parsed) throw new Error(`Version SemVer invalide : ${value}.`);
  return formatSemver({ ...parsed, patch: parsed.patch + 1 });
}

function normalizeReleaseTag(value) {
  const parsed = parseSemver(value);
  return parsed ? `v${formatSemver(parsed)}` : null;
}

function summarizeChecks(checks = []) {
  if (!checks.length) return 'none';
  let pending = false;
  for (const check of checks) {
    const state = String(check.state || '').toUpperCase();
    if (state) {
      if (PASSING_STATES.has(state)) continue;
      if (PENDING_STATES.has(state)) {
        pending = true;
        continue;
      }
      return 'failed';
    }

    const status = String(check.status || '').toUpperCase();
    const conclusion = String(check.conclusion || '').toUpperCase();
    if (status !== 'COMPLETED' || !conclusion) {
      pending = true;
      continue;
    }
    if (!PASSING_CONCLUSIONS.has(conclusion)) return 'failed';
  }
  return pending ? 'pending' : 'green';
}

function computeExpectedVersion(mainVersion, latestReleaseTag) {
  const main = parseSemver(mainVersion);
  if (!main) throw new Error(`Version main invalide : ${mainVersion}.`);
  const latest = latestReleaseTag ? parseSemver(latestReleaseTag) : null;
  if (!latest) return mainVersion;
  const comparison = compareSemver(main, latest);
  if (comparison < 0) {
    throw new Error(`main (${mainVersion}) est en retard sur la dernière release (${normalizeReleaseTag(latestReleaseTag)}).`);
  }
  return comparison > 0 ? mainVersion : nextPatch(mainVersion);
}

function buildReleaseStatus({
  mainSha,
  mainVersion,
  latestReleaseTag = null,
  candidatePr = null,
  candidateBranchExists = false,
  candidateBasedOnMain = true
}) {
  const expectedNextVersion = computeExpectedVersion(mainVersion, latestReleaseTag);
  const candidateBranch = `${RELEASE_BRANCH_PREFIX}${expectedNextVersion}`;
  const latestReleaseVersion = latestReleaseTag ? formatSemver(parseSemver(latestReleaseTag)) : null;
  const mainAheadOfRelease = latestReleaseVersion
    ? compareSemver(mainVersion, latestReleaseVersion) > 0
    : false;
  const checks = candidatePr ? summarizeChecks(candidatePr.statusCheckRollup || []) : 'none';

  let nextAction;
  let action = 'prepare';

  if (mainAheadOfRelease && mainVersion === expectedNextVersion) {
    action = 'dispatch';
    nextAction = `Déclencher ${RELEASE_WORKFLOW} sur main avec release_apk=true.`;
  } else if (candidatePr) {
    if (!candidateBasedOnMain) {
      action = 'repair_candidate';
      nextAction = `La candidate ${candidateBranch} n'est pas basée sur le main canonique : la remettre à jour avant toute fusion, sans créer une seconde candidate.`;
    } else if (checks === 'green') {
      action = 'merge_then_dispatch';
      nextAction = `Fusionner la PR #${candidatePr.number}, puis déclencher ${RELEASE_WORKFLOW} sur main avec release_apk=true.`;
    } else if (checks === 'pending' || checks === 'none') {
      action = 'wait_checks';
      nextAction = `Attendre uniquement les checks requis de la PR #${candidatePr.number}; ne pas recréer de candidate.`;
    } else {
      action = 'fix_checks';
      nextAction = `Corriger les checks en échec de la PR #${candidatePr.number}; ne pas créer une nouvelle branche de release.`;
    }
  } else if (candidateBranchExists) {
    if (!candidateBasedOnMain) {
      action = 'repair_candidate';
      nextAction = `La branche ${candidateBranch} existe mais n'est pas basée sur le main canonique : la remettre à jour et réutiliser cette branche.`;
    } else {
      action = 'reuse_branch';
      nextAction = `Réutiliser ${candidateBranch} et ouvrir/réutiliser sa PR vers main; ne pas créer une seconde branche.`;
    }
  } else {
    nextAction = `Exécuter npm run release:prepare -- ${expectedNextVersion}.`;
  }

  return {
    schemaVersion: 1,
    main: { sha: mainSha, version: mainVersion },
    latestRelease: latestReleaseTag ? { tag: normalizeReleaseTag(latestReleaseTag), version: latestReleaseVersion } : null,
    expectedNextVersion,
    candidate: candidatePr ? {
      branch: candidateBranch,
      prNumber: candidatePr.number,
      url: candidatePr.url || null,
      headSha: candidatePr.headRefOid || null,
      basedOnMain: Boolean(candidateBasedOnMain),
      checks
    } : candidateBranchExists ? {
      branch: candidateBranch,
      prNumber: null,
      url: null,
      headSha: null,
      basedOnMain: Boolean(candidateBasedOnMain),
      checks: 'none'
    } : null,
    action,
    nextAction
  };
}

function run(command, args, options = {}) {
  const output = execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  });
  return typeof output === 'string' ? output.trim() : '';
}

function tryRun(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  });
  if (result.status !== 0) return null;
  return String(result.stdout || '').trim();
}

function ensureGh() {
  const result = spawnSync('gh', ['--version'], { encoding: 'utf8', stdio: 'ignore' });
  if (result.status !== 0) {
    throw new Error('GitHub CLI `gh` est requis pour release:status lorsqu’aucun outil GitHub direct n’est disponible. Ne pas chercher de contournement Web/plugin.');
  }
}

function resolveRepository() {
  const configured = String(process.env.SEENIT_RELEASE_REPOSITORY || '').trim();
  if (configured) return configured;
  return run('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
}

function readLatestReleaseTag(repository) {
  return tryRun('gh', ['api', `repos/${repository}/releases/latest`, '--jq', '.tag_name']);
}

function readCandidatePr(repository, branch) {
  const raw = run('gh', [
    'pr', 'list', '--repo', repository, '--state', 'open', '--base', 'main', '--head', branch,
    '--json', 'number,url,headRefName,headRefOid,baseRefOid,statusCheckRollup'
  ]);
  const list = JSON.parse(raw || '[]');
  return list[0] || null;
}

function fetchCandidateBranch(branch) {
  const remoteRef = `refs/remotes/origin/${branch}`;
  const remoteExists = Boolean(tryRun('git', ['ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${branch}`]));
  if (!remoteExists) return { exists: false, basedOnMain: true };
  run('git', ['fetch', '--quiet', 'origin', `refs/heads/${branch}:${remoteRef}`]);
  const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', 'refs/remotes/origin/main', remoteRef], { stdio: 'ignore' });
  return { exists: true, basedOnMain: ancestry.status === 0 };
}

function readRepositoryStatus() {
  ensureGh();
  run('git', ['fetch', '--quiet', 'origin', 'main', '--tags', '--prune']);
  const repository = resolveRepository();
  const mainSha = run('git', ['rev-parse', 'refs/remotes/origin/main']);
  const mainPackage = JSON.parse(run('git', ['show', `${mainSha}:package.json`]));
  const latestReleaseTag = readLatestReleaseTag(repository);
  const expectedNextVersion = computeExpectedVersion(mainPackage.version, latestReleaseTag);
  const branch = `${RELEASE_BRANCH_PREFIX}${expectedNextVersion}`;
  const branchState = fetchCandidateBranch(branch);
  const candidatePr = readCandidatePr(repository, branch);
  return buildReleaseStatus({
    mainSha,
    mainVersion: mainPackage.version,
    latestReleaseTag,
    candidatePr,
    candidateBranchExists: branchState.exists,
    candidateBasedOnMain: branchState.basedOnMain
  });
}

function printHuman(status) {
  console.log('[Release Status]');
  console.log(`main SHA           : ${status.main.sha}`);
  console.log(`version main       : ${status.main.version}`);
  console.log(`dernière release   : ${status.latestRelease?.tag || 'aucune'}`);
  console.log(`prochaine version  : ${status.expectedNextVersion}`);
  console.log(`candidate          : ${status.candidate ? `${status.candidate.branch}${status.candidate.prNumber ? ` / PR #${status.candidate.prNumber}` : ''}` : 'absente'}`);
  console.log(`checks             : ${status.candidate?.checks || 'none'}`);
  console.log(`action              : ${status.nextAction}`);
  console.log(`RELEASE_STATUS_JSON=${JSON.stringify(status)}`);
}

function main() {
  try {
    const status = readRepositoryStatus();
    if (process.argv.includes('--json')) {
      process.stdout.write(`${JSON.stringify(status)}\n`);
    } else {
      printHuman(status);
    }
  } catch (error) {
    console.error(`[Release Status] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  RELEASE_BRANCH_PREFIX,
  RELEASE_WORKFLOW,
  buildReleaseStatus,
  compareSemver,
  computeExpectedVersion,
  formatSemver,
  nextPatch,
  normalizeReleaseTag,
  parseSemver,
  summarizeChecks
};

if (require.main === module) main();
