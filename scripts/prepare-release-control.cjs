const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { RELEASE_VERSION_FILES } = require('./prepare-release.cjs');
const { prepareReleaseFiles, validateAlignedReleaseFiles } = require('./prepare-release-files.cjs');
const { nextPatch, parseSemver } = require('./release-status.cjs');
const { CONTROL_ISSUE, MAIN_BRANCH, createGitHubRequester } = require('./release-control.cjs');

const PREPARE_COMMAND = '/prepare-release-apk';
const BOT_NAME = 'github-actions[bot]';
const BOT_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com';

function runGit(args, options = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  }).trim();
}

function validatePrepareControlEvent(event) {
  const repository = event?.repository;
  const comment = event?.comment;
  const issue = event?.issue;
  const owner = repository?.owner?.login;
  const actor = comment?.user?.login;
  const association = String(comment?.author_association || '').toUpperCase();

  if (!repository?.full_name || !owner) throw new Error('Dépôt GitHub introuvable dans l’événement.');
  if (Number(issue?.number) !== CONTROL_ISSUE || issue?.pull_request) {
    throw new Error(`La préparation de release est réservée à l’issue de contrôle #${CONTROL_ISSUE}.`);
  }
  if (!actor || actor !== owner || association !== 'OWNER') {
    throw new Error('Auteur non autorisé : seul le propriétaire du dépôt peut préparer une release.');
  }
  if (String(comment?.body || '') !== PREPARE_COMMAND) {
    throw new Error(`Commande refusée : utiliser exactement ${PREPARE_COMMAND}.`);
  }

  return {
    repository: repository.full_name,
    owner,
    actor,
    issueNumber: CONTROL_ISSUE,
    requestedAt: comment?.created_at || null,
    command: PREPARE_COMMAND
  };
}

function resolvePreparationTarget({ mainVersion, latestReleaseTag }) {
  if (!parseSemver(mainVersion)) throw new Error(`Version main invalide : ${mainVersion || '(absente)'}.`);
  const latestVersion = String(latestReleaseTag || '').replace(/^v/, '');
  if (!parseSemver(latestVersion)) throw new Error(`Dernière release SemVer introuvable : ${latestReleaseTag || '(absente)'}.`);
  const expectedNextVersion = nextPatch(latestVersion);

  if (mainVersion === latestVersion) {
    return { action: 'prepare', latestVersion, targetVersion: expectedNextVersion };
  }
  if (mainVersion === expectedNextVersion) {
    return { action: 'ready_to_release', latestVersion, targetVersion: mainVersion };
  }
  throw new Error(
    `État de version inattendu : main=${mainVersion}, dernière release=${latestVersion}, prochaine=${expectedNextVersion}.`
  );
}

function sameReleaseFiles(files) {
  const actual = [...new Set((files || []).map(file => typeof file === 'string' ? file : file?.filename).filter(Boolean))].sort();
  const expected = [...RELEASE_VERSION_FILES].sort();
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function evaluateRemoteCandidate({ mainSha, branchSha, compare, branchVersion }) {
  if (!mainSha || !branchSha) return { reusable: false, reason: 'SHA de candidate absent.' };
  if (branchVersion !== compare?.targetVersion && compare?.targetVersion) {
    return { reusable: false, reason: `Version candidate ${branchVersion} différente de ${compare.targetVersion}.` };
  }
  if (compare?.merge_base_commit?.sha !== mainSha) {
    return { reusable: false, reason: 'La candidate n’est pas basée exactement sur le main canonique.' };
  }
  if (Number(compare?.ahead_by) !== 1 || Number(compare?.behind_by) !== 0) {
    return { reusable: false, reason: `La candidate doit contenir exactement 1 commit (ahead=${compare?.ahead_by}, behind=${compare?.behind_by}).` };
  }
  if (!sameReleaseFiles(compare?.files)) {
    return { reusable: false, reason: 'La candidate modifie des fichiers hors des 8 surfaces de version.' };
  }
  return { reusable: true };
}

function buildCandidateBranchName(version) {
  if (!parseSemver(version)) throw new Error(`Version candidate invalide : ${version}`);
  return `release/v${version}`;
}

function buildCandidatePrBody({ version, mainSha }) {
  return [
    '## Release APK',
    '',
    `Préparation automatique de **SeenIt ${version}** depuis le \`main\` canonique \`${mainSha}\`.`,
    '',
    '- exactement les 8 surfaces canoniques de version ;',
    '- un seul commit release-only ;',
    '- aucune modification métier ;',
    '- publication uniquement après CI verte + merge + commande `/release-apk` sur #102.',
    '',
    'Refs #102'
  ].join('\n');
}

function elapsedSeconds(startedAt) {
  if (!startedAt) return null;
  const parsed = Date.parse(startedAt);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round((Date.now() - parsed) / 100) / 10);
}

async function addControlComment(request, body) {
  return request(`/issues/${CONTROL_ISSUE}/comments`, { method: 'POST', body: { body } });
}

async function readRemotePackageVersion(request, ref) {
  const data = await request(`/contents/package.json?ref=${encodeURIComponent(ref)}`);
  const text = Buffer.from(String(data?.content || '').replace(/\n/g, ''), 'base64').toString('utf8');
  return JSON.parse(text).version;
}

async function findOpenCandidatePr(request, owner, branchName) {
  const prs = await request(`/pulls?state=open&base=${MAIN_BRANCH}&head=${encodeURIComponent(`${owner}:${branchName}`)}&per_page=10`);
  return Array.isArray(prs) ? prs[0] || null : null;
}

async function createCandidatePr(request, { branchName, version, mainSha }) {
  return request('/pulls', {
    method: 'POST',
    body: {
      title: `chore(release): préparer SeenIt ${version}`,
      head: branchName,
      base: MAIN_BRANCH,
      body: buildCandidatePrBody({ version, mainSha })
    }
  });
}

async function reuseExistingCandidate({ request, owner, mainSha, branchName, targetVersion, branchRef }) {
  const branchSha = branchRef?.object?.sha;
  const [compare, branchVersion] = await Promise.all([
    request(`/compare/${mainSha}...${branchSha}`),
    readRemotePackageVersion(request, branchName)
  ]);
  compare.targetVersion = targetVersion;
  const evaluation = evaluateRemoteCandidate({ mainSha, branchSha, compare, branchVersion });
  if (!evaluation.reusable) throw new Error(`Candidate ${branchName} incompatible : ${evaluation.reason}`);

  let pr = await findOpenCandidatePr(request, owner, branchName);
  if (!pr) pr = await createCandidatePr(request, { branchName, version: targetVersion, mainSha });
  return { branchSha, pr, reused: true };
}

function prepareLocalCandidate({ targetVersion, branchName, mainSha }) {
  const checkoutSha = runGit(['rev-parse', 'HEAD']);
  if (checkoutSha !== mainSha) throw new Error(`Checkout non canonique : ${checkoutSha} au lieu de main ${mainSha}.`);
  if (runGit(['status', '--porcelain'])) throw new Error('Workspace sale avant préparation de release.');

  const result = prepareReleaseFiles(targetVersion, { requireAllEight: true });
  if (!sameReleaseFiles(result.changedFiles)) {
    throw new Error(`Préparation inattendue : ${result.changedFiles.join(', ')}`);
  }
  validateAlignedReleaseFiles(targetVersion);
  runGit(['diff', '--check']);
  const changed = runGit(['diff', '--name-only']).split('\n').filter(Boolean);
  if (!sameReleaseFiles(changed)) throw new Error('Le diff préparé ne correspond pas exactement aux 8 surfaces de version.');

  runGit(['config', 'user.name', BOT_NAME]);
  runGit(['config', 'user.email', BOT_EMAIL]);
  runGit(['switch', '-c', branchName]);
  runGit(['add', '--', ...RELEASE_VERSION_FILES]);
  runGit([
    'commit',
    '-m', `chore(release): préparer SeenIt ${targetVersion}`,
    '-m', 'Changelog: aucun\n\nDétails techniques:\n- Aligne atomiquement les 8 surfaces canoniques de version.\n- Préparation créée par le contrôleur connector-only #102.'
  ]);
  const commitCount = Number(runGit(['rev-list', '--count', `${mainSha}..HEAD`]));
  if (commitCount !== 1) throw new Error(`La candidate doit contenir exactement 1 commit, trouvé ${commitCount}.`);
  const commitSha = runGit(['rev-parse', 'HEAD']);
  runGit(['push', '--set-upstream', 'origin', branchName]);
  return { commitSha };
}

async function runPrepareReleaseControl({ event, token = process.env.GITHUB_TOKEN } = {}) {
  const validatedEvent = validatePrepareControlEvent(event);
  const request = createGitHubRequester({ repository: validatedEvent.repository, token });
  const [branch, latestRelease] = await Promise.all([
    request(`/branches/${MAIN_BRANCH}`),
    request('/releases/latest')
  ]);
  const mainSha = branch?.commit?.sha;
  const checkoutSha = runGit(['rev-parse', 'HEAD']);
  if (event?.repository?.default_branch !== MAIN_BRANCH) throw new Error('SeenIt exige main comme branche par défaut.');
  if (!mainSha || checkoutSha !== mainSha) throw new Error(`Checkout non canonique : ${checkoutSha} au lieu de main ${mainSha}.`);

  const mainVersion = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
  const target = resolvePreparationTarget({ mainVersion, latestReleaseTag: latestRelease?.tag_name });
  const metric = () => elapsedSeconds(validatedEvent.requestedAt);

  if (target.action === 'ready_to_release') {
    await addControlComment(request, [
      `✅ **v${target.targetVersion}** est déjà préparée sur \`main\` \`${mainSha}\`.`,
      '',
      '- Aucune nouvelle branche ni PR créée.',
      '- Prochaine action exacte : publier `/release-apk` sur #102.',
      metric() === null ? null : `- Demande → décision : **${metric()} s**`
    ].filter(Boolean).join('\n'));
    return { action: 'ready_to_release', version: target.targetVersion, mainSha };
  }

  const targetVersion = target.targetVersion;
  const tag = `v${targetVersion}`;
  const branchName = buildCandidateBranchName(targetVersion);
  const [existingRelease, existingTag, branchRef] = await Promise.all([
    request(`/releases/tags/${tag}`, { allow404: true }),
    request(`/git/ref/tags/${tag}`, { allow404: true }),
    request(`/git/ref/heads/${encodeURIComponent(branchName)}`, { allow404: true })
  ]);
  if (existingRelease || existingTag) throw new Error(`${tag} existe déjà : une release publiée est immuable.`);

  let candidate;
  if (branchRef) {
    candidate = await reuseExistingCandidate({ request, owner: validatedEvent.owner, mainSha, branchName, targetVersion, branchRef });
  } else {
    const prepared = prepareLocalCandidate({ targetVersion, branchName, mainSha });
    const pr = await createCandidatePr(request, { branchName, version: targetVersion, mainSha });
    candidate = { branchSha: prepared.commitSha, pr, reused: false };
  }

  const seconds = metric();
  await addControlComment(request, [
    `${candidate.reused ? '♻️ Candidate réutilisée' : '🧩 Candidate créée'} pour **v${targetVersion}**.`,
    '',
    `- Base main : \`${mainSha}\``,
    `- Branche : \`${branchName}\``,
    `- Commit release-only : \`${candidate.branchSha}\``,
    `- PR : ${candidate.pr?.html_url || `#${candidate.pr?.number || '?'}`}`,
    '- Portée : exactement 8 surfaces de version, 1 commit, aucun fichier métier.',
    '- Prochaine action exacte : attendre la CI de cette PR, fusionner si verte, puis `/release-apk` sur #102.',
    seconds === null ? null : `- Demande → PR : **${seconds} s**`
  ].filter(Boolean).join('\n'));

  return {
    action: candidate.reused ? 'reused' : 'created',
    version: targetVersion,
    mainSha,
    branch: branchName,
    commitSha: candidate.branchSha,
    prNumber: candidate.pr?.number || null,
    prUrl: candidate.pr?.html_url || null,
    requestToPrSeconds: seconds
  };
}

async function main() {
  try {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath) throw new Error('GITHUB_EVENT_PATH absent.');
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    const result = await runPrepareReleaseControl({ event });
    console.log(`PREPARE_RELEASE_CONTROL_JSON=${JSON.stringify(result)}`);
  } catch (error) {
    console.error(`[Prepare Release Control] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  BOT_EMAIL,
  BOT_NAME,
  PREPARE_COMMAND,
  buildCandidateBranchName,
  buildCandidatePrBody,
  evaluateRemoteCandidate,
  resolvePreparationTarget,
  runPrepareReleaseControl,
  sameReleaseFiles,
  validatePrepareControlEvent
};

if (require.main === module) void main();
