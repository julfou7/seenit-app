const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { computeExpectedVersion, parseSemver } = require('./release-status.cjs');
const {
  RELEASE_VERSION_FILES,
  assertReleaseOnlyFiles,
  prepareReleaseFiles,
  updateGradleVersionName
} = require('./prepare-release-files.cjs');

const root = path.resolve(__dirname, '..');

function run(command, args, options = {}) {
  const output = execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  });
  return typeof output === 'string' ? output.trim() : '';
}

function tryRun(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  });
  if (result.status !== 0) return null;
  return String(result.stdout || '').trim();
}

function assertCleanWorkspace(status) {
  if (String(status || '').trim()) {
    throw new Error('Workspace sale : release:prepare exige un arbre Git propre avant toute préparation.');
  }
}

function validateRequestedVersion({ targetVersion, mainVersion, latestReleaseTag, tagExists = false, releaseExists = false }) {
  if (!parseSemver(targetVersion)) throw new Error(`Version SemVer invalide : ${targetVersion}.`);
  if (tagExists || releaseExists) {
    throw new Error(`La version v${targetVersion} existe déjà : une release publiée est immuable.`);
  }
  const expected = computeExpectedVersion(mainVersion, latestReleaseTag);
  if (targetVersion !== expected) {
    throw new Error(`Version attendue ${expected}, version demandée ${targetVersion}.`);
  }
  return expected;
}

function evaluateExistingCandidate({ targetVersion, branchVersion, basedOnMain, changedFiles, commitCount, prNumber = null }) {
  if (branchVersion !== targetVersion) {
    return { reusable: false, reason: `la branche porte ${branchVersion || 'une version inconnue'} au lieu de ${targetVersion}` };
  }
  if (!basedOnMain) {
    return { reusable: false, reason: 'la branche n’est pas basée sur le main canonique' };
  }
  try {
    assertReleaseOnlyFiles(changedFiles);
  } catch (error) {
    return { reusable: false, reason: error.message };
  }
  if (Number(commitCount) !== 1) {
    return { reusable: false, reason: `la préparation contient ${commitCount} commits au lieu d’un seul` };
  }
  return { reusable: true, prNumber };
}

function ensureGh() {
  const result = spawnSync('gh', ['--version'], { encoding: 'utf8', stdio: 'ignore' });
  if (result.status !== 0) {
    throw new Error('GitHub CLI `gh` est requis uniquement pour l’orchestration distante de release:prepare. La génération atomique des huit surfaces reste disponible via release:prepare:files sans gh.');
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

function existingOpenPr(repository, branch) {
  const raw = run('gh', ['pr', 'list', '--repo', repository, '--state', 'open', '--base', 'main', '--head', branch, '--json', 'number,url']);
  return JSON.parse(raw || '[]')[0] || null;
}

function createPr(repository, branch, version) {
  const existing = existingOpenPr(repository, branch);
  if (existing) return { ...existing, reused: true };
  const url = run('gh', [
    'pr', 'create', '--repo', repository, '--base', 'main', '--head', branch,
    '--title', `chore: préparer la release APK ${version}`,
    '--body', [
      `Préparation atomique de la release APK **${version}**.`,
      '',
      '- huit surfaces synchronisées via `release:prepare:files` ;',
      '- aucune modification métier hors surfaces de version ;',
      '- publication uniquement après validation de la PR puis déclenchement sécurisé sur `main`.',
      '',
      'Relatif à #102.'
    ].join('\n')
  ]);
  const numberMatch = url.match(/\/pull\/(\d+)/);
  return { number: numberMatch ? Number(numberMatch[1]) : null, url, reused: false };
}

function readRemoteCandidate(branch, targetVersion, repository) {
  const remoteRef = `refs/remotes/origin/${branch}`;
  if (!tryRun('git', ['ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${branch}`])) return null;

  run('git', ['fetch', '--quiet', 'origin', `refs/heads/${branch}:${remoteRef}`]);
  const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', 'refs/remotes/origin/main', remoteRef], { cwd: root, stdio: 'ignore' });
  const branchPackage = JSON.parse(run('git', ['show', `${remoteRef}:package.json`]));
  const changedFiles = run('git', ['diff', '--name-only', 'refs/remotes/origin/main', remoteRef]).split('\n').filter(Boolean);
  const commitCount = Number(run('git', ['rev-list', '--count', 'refs/remotes/origin/main..' + remoteRef]));
  const pr = existingOpenPr(repository, branch);
  return {
    ...evaluateExistingCandidate({
      targetVersion,
      branchVersion: branchPackage.version,
      basedOnMain: ancestry.status === 0,
      changedFiles,
      commitCount,
      prNumber: pr?.number || null
    }),
    branch,
    pr
  };
}

function rollbackLocalBranch(previousBranch, branch) {
  tryRun('git', ['reset', '--hard', 'refs/remotes/origin/main']);
  tryRun('git', ['switch', previousBranch]);
  tryRun('git', ['branch', '-D', branch]);
}

function prepareRelease(targetVersion) {
  const startedAt = Date.now();
  assertCleanWorkspace(run('git', ['status', '--porcelain']));
  run('git', ['fetch', '--quiet', 'origin', 'main', '--tags', '--prune']);

  const currentBranch = run('git', ['branch', '--show-current']);
  const headSha = run('git', ['rev-parse', 'HEAD']);
  const mainSha = run('git', ['rev-parse', 'refs/remotes/origin/main']);
  if (currentBranch !== 'main' || headSha !== mainSha) {
    throw new Error(`release:prepare doit démarrer sur le main canonique exact (${mainSha}); état courant ${currentBranch || '(detached)'} ${headSha}.`);
  }

  const mainPackage = JSON.parse(run('git', ['show', `${mainSha}:package.json`]));

  // Toute la génération des huit surfaces est désormais disponible sans GitHub CLI via
  // `npm run release:prepare:files -- X.Y.Z`. `gh` ne sert plus qu'à l'orchestration distante
  // historique (lecture release, PR et push) de cette commande complète.
  ensureGh();
  const repository = resolveRepository();
  const latestReleaseTag = readLatestReleaseTag(repository);
  const tagExists = Boolean(run('git', ['tag', '--list', `v${targetVersion}`]));
  const releaseExists = Boolean(tryRun('gh', ['release', 'view', `v${targetVersion}`, '--repo', repository, '--json', 'tagName']));
  validateRequestedVersion({
    targetVersion,
    mainVersion: mainPackage.version,
    latestReleaseTag,
    tagExists,
    releaseExists
  });

  const branch = `release/v${targetVersion}`;
  const existing = readRemoteCandidate(branch, targetVersion, repository);
  if (existing) {
    if (!existing.reusable) {
      throw new Error(`Candidate ${branch} existante incompatible : ${existing.reason}. Corriger/réutiliser cette branche ; ne pas en créer une seconde.`);
    }
    const pr = existing.pr || createPr(repository, branch, targetVersion);
    const result = {
      schemaVersion: 1,
      reused: true,
      version: targetVersion,
      branch,
      prNumber: pr.number || null,
      prUrl: pr.url || null,
      commitCount: 1,
      elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
      nextAction: `Attendre uniquement les checks requis de la PR #${pr.number || '?'} puis fusionner.`
    };
    console.log(`[Release Prepare] Candidate réutilisée : ${branch}.`);
    console.log(`RELEASE_PREPARE_JSON=${JSON.stringify(result)}`);
    return result;
  }

  run('git', ['switch', '-c', branch]);
  try {
    const generated = prepareReleaseFiles(targetVersion, { rootDir: root, requireAllEight: true });
    const changedFiles = run('git', ['diff', '--name-only']).split('\n').filter(Boolean);
    assertReleaseOnlyFiles(changedFiles);
    if (generated.changedFiles.length !== RELEASE_VERSION_FILES.length) {
      throw new Error(`Préparation non atomique : ${generated.changedFiles.length}/8 surfaces modifiées.`);
    }
    run('git', ['diff', '--check']);
    run('git', ['add', '--', ...RELEASE_VERSION_FILES]);
    run('git', [
      'commit',
      '-m', `chore: préparer la release APK ${targetVersion}`,
      '-m', 'Changelog: aucun\n\nDétails techniques:\n- Aligne atomiquement les huit surfaces de version.'
    ], { stdio: 'inherit' });

    const commitCount = Number(run('git', ['rev-list', '--count', 'refs/remotes/origin/main..HEAD']));
    if (commitCount !== 1) {
      throw new Error(`Préparation non atomique : ${commitCount} commits détectés.`);
    }

    run('git', ['push', '--set-upstream', 'origin', branch], { stdio: 'inherit' });
    const pr = createPr(repository, branch, targetVersion);
    const result = {
      schemaVersion: 1,
      reused: false,
      version: targetVersion,
      branch,
      prNumber: pr.number || null,
      prUrl: pr.url || null,
      commitCount,
      changedFiles,
      elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
      nextAction: `Attendre uniquement les checks requis de la PR #${pr.number || '?'} puis fusionner.`
    };
    console.log(`[Release Prepare] ${targetVersion} préparée en un commit sur ${branch}.`);
    console.log(`RELEASE_PREPARE_JSON=${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    rollbackLocalBranch(currentBranch, branch);
    throw error;
  }
}

function main() {
  const targetVersion = process.argv.slice(2).find(arg => !arg.startsWith('-'));
  if (!targetVersion) {
    console.error('[Release Prepare] Usage : npm run release:prepare -- X.Y.Z');
    process.exitCode = 1;
    return;
  }
  try {
    prepareRelease(targetVersion);
  } catch (error) {
    console.error(`[Release Prepare] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  RELEASE_VERSION_FILES,
  assertCleanWorkspace,
  assertReleaseOnlyFiles,
  evaluateExistingCandidate,
  prepareReleaseFiles,
  updateGradleVersionName,
  validateRequestedVersion
};

if (require.main === module) main();
