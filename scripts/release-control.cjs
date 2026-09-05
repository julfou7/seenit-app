const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { nextPatch, parseSemver } = require('./release-status.cjs');

const CONTROL_ISSUE = 102;
const RELEASE_WORKFLOW = 'build-apk.yml';
const MAIN_BRANCH = 'main';
const POLL_LIMIT = 20;
const POLL_DELAY_MS = 1500;
const ACTIVE_RUN_STATUSES = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending']);
const ALLOWED_COMMANDS = Object.freeze({
  '/release-apk': { action: 'release', android12Smoke: false },
  '/release-apk android12_smoke=true': { action: 'release', android12Smoke: true }
});

function parseReleaseControlCommand(raw) {
  const command = String(raw || '');
  const parsed = ALLOWED_COMMANDS[command];
  return parsed ? { ...parsed, command } : null;
}

function validateReleaseControlEvent(event) {
  const repository = event?.repository;
  const comment = event?.comment;
  const issue = event?.issue;
  const owner = repository?.owner?.login;
  const actor = comment?.user?.login;
  const association = String(comment?.author_association || '').toUpperCase();
  if (!repository?.full_name || !owner) throw new Error('Dépôt GitHub introuvable dans l’événement.');
  if (Number(issue?.number) !== CONTROL_ISSUE || issue?.pull_request) {
    throw new Error(`La commande de release est réservée à l’issue de contrôle #${CONTROL_ISSUE}.`);
  }
  if (!actor || actor !== owner || association !== 'OWNER') {
    throw new Error('Auteur non autorisé : seul le propriétaire du dépôt peut déclencher une release.');
  }
  const command = parseReleaseControlCommand(comment?.body);
  if (!command) {
    throw new Error('Commande refusée : utiliser exactement /release-apk ou /release-apk android12_smoke=true.');
  }
  return {
    repository: repository.full_name,
    owner,
    actor,
    issueNumber: CONTROL_ISSUE,
    requestedAt: comment?.created_at || null,
    ...command
  };
}

function validateReleasePreflight({
  defaultBranch,
  checkoutSha,
  mainSha,
  mainVersion,
  latestReleaseTag,
  tagExists = false,
  releaseExists = false,
  activeDuplicate = false,
  android12Smoke = false
}) {
  if (defaultBranch !== MAIN_BRANCH) {
    throw new Error(`Branche par défaut inattendue : ${defaultBranch || '(absente)'}. SeenIt exige main.`);
  }
  if (!checkoutSha || checkoutSha !== mainSha) {
    throw new Error(`Checkout non canonique : ${checkoutSha || '(absent)'} au lieu de main ${mainSha || '(absent)'}.`);
  }
  if (!parseSemver(mainVersion)) throw new Error(`Version main invalide : ${mainVersion || '(absente)'}.`);
  const latest = String(latestReleaseTag || '').replace(/^v/, '');
  if (!parseSemver(latest)) throw new Error(`Dernière release SemVer introuvable : ${latestReleaseTag || '(absente)'}.`);
  const expectedVersion = nextPatch(latest);
  if (mainVersion !== expectedVersion) {
    throw new Error(`Version attendue ${expectedVersion}, version main ${mainVersion}.`);
  }
  if (tagExists || releaseExists) {
    throw new Error(`v${mainVersion} existe déjà : une release publiée est immuable.`);
  }
  if (activeDuplicate) {
    throw new Error(`Un workflow de release est déjà actif pour le SHA main ${mainSha}.`);
  }
  return {
    expectedVersion,
    mainSha,
    mainVersion,
    ref: MAIN_BRANCH,
    inputs: {
      release_apk: 'true',
      android12_smoke: android12Smoke ? 'true' : 'false'
    }
  };
}

function buildWorkflowDispatchRequest(android12Smoke) {
  return {
    method: 'POST',
    body: {
      ref: MAIN_BRANCH,
      inputs: {
        release_apk: 'true',
        android12_smoke: android12Smoke ? 'true' : 'false'
      }
    }
  };
}

function findActiveDuplicateRun(runs, mainSha) {
  return (runs || []).find(run => run?.head_sha === mainSha && ACTIVE_RUN_STATUSES.has(String(run?.status || '').toLowerCase())) || null;
}

function findNewDispatchedRun(runs, mainSha, previousIds) {
  const previous = new Set(previousIds || []);
  return (runs || []).find(run => run?.event === 'workflow_dispatch' && run?.head_sha === mainSha && !previous.has(run.id)) || null;
}

async function dispatchReleaseWorkflow({
  request,
  mainSha,
  android12Smoke,
  previousRunIds = [],
  pollLimit = POLL_LIMIT,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
}) {
  const dispatch = buildWorkflowDispatchRequest(android12Smoke);
  await request(`/actions/workflows/${RELEASE_WORKFLOW}/dispatches`, dispatch);
  for (let attempt = 0; attempt < pollLimit; attempt += 1) {
    const data = await request(`/actions/workflows/${RELEASE_WORKFLOW}/runs?event=workflow_dispatch&branch=${MAIN_BRANCH}&per_page=30`);
    const run = findNewDispatchedRun(data?.workflow_runs, mainSha, previousRunIds);
    if (run) return run;
    if (attempt + 1 < pollLimit) await sleep(POLL_DELAY_MS);
  }
  return null;
}

function createGitHubRequester({ repository, token }) {
  if (!repository) throw new Error('GITHUB_REPOSITORY absent.');
  if (!token) throw new Error('GITHUB_TOKEN absent.');
  return async function request(apiPath, options = {}) {
    const method = options.method || 'GET';
    const response = await fetch(`https://api.github.com/repos/${repository}${apiPath}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'seenit-release-control'
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    if (options.allow404 && response.status === 404) return null;
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`GitHub API ${method} ${apiPath} -> ${response.status}: ${detail}`);
    }
    if (response.status === 204) return null;
    return response.json();
  };
}

function readCheckoutSha() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

function readMainVersion() {
  return JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
}

async function addControlComment(request, body) {
  return request(`/issues/${CONTROL_ISSUE}/comments`, { method: 'POST', body: { body } });
}

function elapsedSeconds(startedAt) {
  if (!startedAt) return null;
  const parsed = Date.parse(startedAt);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round((Date.now() - parsed) / 100) / 10);
}

async function runReleaseControl({ event, token = process.env.GITHUB_TOKEN } = {}) {
  const validatedEvent = validateReleaseControlEvent(event);
  const request = createGitHubRequester({ repository: validatedEvent.repository, token });
  const branch = await request(`/branches/${MAIN_BRANCH}`);
  const latestRelease = await request('/releases/latest');
  const mainSha = branch?.commit?.sha;
  const checkoutSha = readCheckoutSha();
  const mainVersion = readMainVersion();
  const versionTag = `v${mainVersion}`;
  const [existingRelease, existingTag, runs] = await Promise.all([
    request(`/releases/tags/${versionTag}`, { allow404: true }),
    request(`/git/ref/tags/${versionTag}`, { allow404: true }),
    request(`/actions/workflows/${RELEASE_WORKFLOW}/runs?event=workflow_dispatch&branch=${MAIN_BRANCH}&per_page=100`)
  ]);
  const activeDuplicate = findActiveDuplicateRun(runs?.workflow_runs, mainSha);
  const preflight = validateReleasePreflight({
    defaultBranch: event?.repository?.default_branch,
    checkoutSha,
    mainSha,
    mainVersion,
    latestReleaseTag: latestRelease?.tag_name,
    tagExists: Boolean(existingTag),
    releaseExists: Boolean(existingRelease),
    activeDuplicate: Boolean(activeDuplicate),
    android12Smoke: validatedEvent.android12Smoke
  });
  const previousRunIds = (runs?.workflow_runs || []).map(run => run.id);
  const run = await dispatchReleaseWorkflow({
    request,
    mainSha,
    android12Smoke: validatedEvent.android12Smoke,
    previousRunIds
  });
  const metric = elapsedSeconds(validatedEvent.requestedAt);
  if (!run) {
    await addControlComment(request, [
      `⚠️ Commande \`${validatedEvent.command}\` acceptée pour **${versionTag}** sur \`${mainSha}\`, mais le nouveau run n’a pas été retrouvé dans les 30 s.`,
      '',
      'Le dispatch GitHub a été accepté : ne pas relancer aveuglément. Vérifier les runs `workflow_dispatch` avant toute nouvelle commande.'
    ].join('\n'));
    throw new Error('Dispatch accepté mais run non retrouvé dans la fenêtre bornée de 30 s.');
  }
  await addControlComment(request, [
    `🚀 Release **${versionTag}** déclenchée nativement depuis #${CONTROL_ISSUE}.`,
    '',
    `- SHA main : \`${mainSha}\``,
    `- Android 12 smoke : **${validatedEvent.android12Smoke ? 'activé' : 'désactivé'}**`,
    `- Run : ${run.html_url || `#${run.id}`}`,
    metric === null ? null : `- Demande → workflow : **${metric} s**`
  ].filter(Boolean).join('\n'));
  return {
    schemaVersion: 1,
    command: validatedEvent.command,
    version: preflight.mainVersion,
    mainSha,
    android12Smoke: validatedEvent.android12Smoke,
    runId: run.id,
    runUrl: run.html_url || null,
    requestToWorkflowSeconds: metric
  };
}

async function main() {
  try {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath) throw new Error('GITHUB_EVENT_PATH absent.');
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    const result = await runReleaseControl({ event });
    console.log(`RELEASE_CONTROL_JSON=${JSON.stringify(result)}`);
  } catch (error) {
    console.error(`[Release Control] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  ACTIVE_RUN_STATUSES,
  ALLOWED_COMMANDS,
  CONTROL_ISSUE,
  MAIN_BRANCH,
  POLL_DELAY_MS,
  POLL_LIMIT,
  RELEASE_WORKFLOW,
  buildWorkflowDispatchRequest,
  createGitHubRequester,
  dispatchReleaseWorkflow,
  findActiveDuplicateRun,
  findNewDispatchedRun,
  parseReleaseControlCommand,
  runReleaseControl,
  validateReleaseControlEvent,
  validateReleasePreflight
};

if (require.main === module) void main();
