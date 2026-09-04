const { execFileSync, spawnSync } = require('node:child_process');

const root = require('node:path').resolve(__dirname, '..');
const WORKFLOW = 'build-apk.yml';
const POLL_LIMIT = 6;
const POLL_DELAY_MS = 5000;

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  }).trim();
}

function ensureGh() {
  const result = spawnSync('gh', ['--version'], { encoding: 'utf8', stdio: 'ignore' });
  if (result.status !== 0) {
    throw new Error('GitHub CLI `gh` est requis pour le fallback de workflow_dispatch. Utiliser l’outil GitHub direct s’il existe ; sinon ne pas chercher de contournement Web/plugin.');
  }
}

function resolveRepository() {
  const configured = String(process.env.SEENIT_RELEASE_REPOSITORY || '').trim();
  if (configured) return configured;
  return run('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
}

function parseRequestStart(value) {
  if (!value) return null;
  if (/^\d+$/.test(String(value))) {
    const numeric = Number(value);
    return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function sleep(milliseconds) {
  const wait = spawnSync(process.execPath, ['-e', `setTimeout(() => {}, ${milliseconds})`], { stdio: 'ignore' });
  if (wait.status !== 0) throw new Error('Attente bornée impossible.');
}

function findWorkflowRun(repository, mainSha, dispatchedAfterIso) {
  const raw = run('gh', [
    'run', 'list', '--repo', repository, '--workflow', WORKFLOW, '--branch', 'main', '--event', 'workflow_dispatch',
    '--limit', '5', '--json', 'databaseId,status,conclusion,url,headSha,createdAt'
  ]);
  const runs = JSON.parse(raw || '[]');
  return runs.find(entry => entry.headSha === mainSha && entry.createdAt >= dispatchedAfterIso) || null;
}

function dispatchRelease({ requestStartedAt = null, android12Smoke = false } = {}) {
  const localStart = Date.now();
  ensureGh();
  if (run('git', ['status', '--porcelain'])) {
    throw new Error('Workspace sale : le déclenchement de release n’effectue aucune mutation locale.');
  }
  run('git', ['fetch', '--quiet', 'origin', 'main']);
  const branch = run('git', ['branch', '--show-current']);
  const mainSha = run('git', ['rev-parse', 'refs/remotes/origin/main']);
  const headSha = run('git', ['rev-parse', 'HEAD']);
  if (branch !== 'main' || headSha !== mainSha) {
    throw new Error(`release:dispatch doit être lancé depuis le main canonique exact (${mainSha}).`);
  }

  const repository = resolveRepository();
  const dispatchStartedAt = new Date().toISOString();
  run('gh', [
    'workflow', 'run', WORKFLOW, '--repo', repository, '--ref', 'main',
    '-f', 'release_apk=true', '-f', `android12_smoke=${android12Smoke ? 'true' : 'false'}`
  ]);

  let workflowRun = null;
  for (let attempt = 0; attempt < POLL_LIMIT && !workflowRun; attempt += 1) {
    if (attempt > 0) sleep(POLL_DELAY_MS);
    workflowRun = findWorkflowRun(repository, mainSha, dispatchStartedAt);
  }
  if (!workflowRun) {
    throw new Error(`workflow_dispatch envoyé mais run non retrouvé après ${POLL_LIMIT * POLL_DELAY_MS / 1000}s. Vérifier uniquement GitHub Actions ; ne pas relancer aveuglément.`);
  }

  const requestedAt = parseRequestStart(requestStartedAt || process.env.SEENIT_RELEASE_REQUEST_STARTED_AT);
  const metricBase = requestedAt || localStart;
  const requestToWorkflowSeconds = Math.max(0, Math.round((Date.parse(workflowRun.createdAt) - metricBase) / 100) / 10);
  const result = {
    schemaVersion: 1,
    repository,
    mainSha,
    workflow: WORKFLOW,
    workflowRunId: workflowRun.databaseId,
    workflowUrl: workflowRun.url,
    status: workflowRun.status,
    requestToWorkflowSeconds,
    measuredFromRequest: Boolean(requestedAt),
    nextAction: `Suivre le run ${workflowRun.databaseId} jusqu’à la publication de l’APK et du SHA-256 : gh run watch ${workflowRun.databaseId} --repo ${repository} --exit-status`
  };
  console.log(`[Release Dispatch] Workflow lancé : ${workflowRun.url}`);
  console.log(`[Release Dispatch] demande → workflow : ${requestToWorkflowSeconds}s${requestedAt ? '' : ' (mesuré depuis release:dispatch)'}.`);
  console.log(`RELEASE_DISPATCH_JSON=${JSON.stringify(result)}`);
  return result;
}

function main() {
  try {
    const requestStartIndex = process.argv.indexOf('--request-start');
    const requestStartedAt = requestStartIndex >= 0 ? process.argv[requestStartIndex + 1] : null;
    dispatchRelease({
      requestStartedAt,
      android12Smoke: process.argv.includes('--android12-smoke')
    });
  } catch (error) {
    console.error(`[Release Dispatch] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  POLL_DELAY_MS,
  POLL_LIMIT,
  dispatchRelease,
  parseRequestStart
};

if (require.main === module) main();
