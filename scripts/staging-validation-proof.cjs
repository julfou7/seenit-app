const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const SHA = /^[0-9a-f]{40}$/;
const AGENT_WORKFLOW_PATH = '.github/workflows/agent-remote-validate.yml';
const AGENT_JOB = 'Validate exact staging SHA';
const STAGING_ARTIFACT_PREFIX = 'SeenIt-Agent-Validated-';
const TREE_ARTIFACT_PREFIX = 'SeenIt-Validated-Tree-';

function git(args, cwd = root) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function normalizePath(file) {
  return String(file || '').trim().replace(/\\/g, '/');
}

function currentTree(cwd = root) {
  const tree = git(['rev-parse', 'HEAD^{tree}'], cwd);
  if (!SHA.test(tree)) throw new Error(`Arbre Git invalide : ${tree}`);
  return tree;
}

function stagingArtifactName(headSha, baseSha, tree) {
  for (const [label, value] of [['head', headSha], ['base', baseSha], ['tree', tree]]) {
    if (!SHA.test(String(value || ''))) throw new Error(`${label} Git invalide : ${value}`);
  }
  return `${STAGING_ARTIFACT_PREFIX}${headSha}-${baseSha}-${tree}`;
}

function treeArtifactName(tree) {
  if (!SHA.test(String(tree || ''))) throw new Error(`Arbre Git invalide : ${tree}`);
  return `${TREE_ARTIFACT_PREFIX}${tree}`;
}

function changedFiles(baseSha, headSha, cwd = root) {
  if (!SHA.test(String(baseSha || '')) || !SHA.test(String(headSha || ''))) return [];
  return git(['diff', '--name-only', `${baseSha}..${headSha}`], cwd)
    .split(/\r?\n/)
    .map(normalizePath)
    .filter(Boolean);
}

function isValidationInfrastructureFile(file) {
  const normalized = normalizePath(file);
  return normalized.startsWith('.github/')
    || normalized.startsWith('.devcontainer/')
    || normalized.startsWith('scripts/')
    || normalized === 'package.json'
    || normalized === 'package-lock.json'
    || /^tsconfig(?:\..+)?\.json$/.test(normalized)
    || /^vite\.config\./.test(normalized)
    || normalized === 'docs/specifications/quality-gates.json';
}

function validationInfrastructureChanged(baseSha, headSha, cwd = root) {
  return changedFiles(baseSha, headSha, cwd).some(isValidationInfrastructureFile);
}

function githubRequest({ token, apiUrl = 'https://api.github.com', fetchImpl = fetch }) {
  return async route => {
    const response = await fetchImpl(`${apiUrl}${route}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
    if (!response.ok) throw new Error(`GitHub ${response.status} sur ${route.split('?')[0]}`);
    return response.json();
  };
}

function isTrustedStagingRun(run, repository, headSha) {
  return run?.event === 'push'
    && run.path === AGENT_WORKFLOW_PATH
    && run.head_sha === headSha
    && String(run.head_branch || '').startsWith('agent-staging/')
    && run.status === 'completed'
    && run.conclusion === 'success'
    && run.repository?.full_name === repository
    && run.head_repository?.full_name === repository;
}

function stagingJobSucceeded(jobs) {
  const job = (jobs || []).find(item => item?.name === AGENT_JOB);
  return job?.status === 'completed' && job.conclusion === 'success';
}

async function findStagingProof({ repository, headSha, baseSha, tree, request }) {
  const name = stagingArtifactName(headSha, baseSha, tree);
  const listing = await request(`/repos/${repository}/actions/artifacts?name=${encodeURIComponent(name)}&per_page=20`);
  for (const artifact of listing?.artifacts || []) {
    const ref = artifact?.workflow_run;
    if (artifact?.name !== name || artifact.expired || !ref?.id) continue;
    if (!ref.repository_id || ref.repository_id !== ref.head_repository_id) continue;
    const run = await request(`/repos/${repository}/actions/runs/${ref.id}`);
    if (!isTrustedStagingRun(run, repository, headSha)) continue;
    const { jobs } = await request(`/repos/${repository}/actions/runs/${run.id}/jobs?per_page=50`);
    if (!stagingJobSucceeded(jobs)) continue;
    return { runId: run.id, url: run.html_url, headSha: run.head_sha, artifactName: name };
  }
  return null;
}

async function resolveStagingProof({
  event,
  repository,
  headSha,
  baseSha,
  tree,
  request,
  infrastructureChanged = validationInfrastructureChanged,
  log = console.log
}) {
  const plan = {
    reused: false,
    tree,
    proof: null,
    reason: 'preuve staging non applicable'
  };
  if (event !== 'pull_request') return plan;
  if (!request || !repository) return { ...plan, reason: 'API GitHub indisponible' };
  if (!SHA.test(String(headSha || '')) || !SHA.test(String(baseSha || '')) || !SHA.test(String(tree || ''))) {
    return { ...plan, reason: 'identité PR incomplète' };
  }
  try {
    if (infrastructureChanged(baseSha, headSha)) {
      return { ...plan, reason: 'infrastructure de validation modifiée : PR complète requise' };
    }
    const proof = await findStagingProof({ repository, headSha, baseSha, tree, request });
    if (!proof) return { ...plan, reason: 'aucune preuve staging exacte et de confiance' };
    return {
      reused: true,
      tree,
      proof,
      reason: `staging ${headSha.slice(0, 12)} / base ${baseSha.slice(0, 12)} / arbre ${tree.slice(0, 12)} validé (run ${proof.runId})`
    };
  } catch (error) {
    log(`[Preuve staging] ⚠️ ${error.message} : validation PR complète.`);
    return { ...plan, reason: `erreur de lecture de preuve (${error.message})` };
  }
}

function writeOutputs(plan, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) return;
  const lines = [
    `reused=${plan.reused ? 'true' : 'false'}`,
    `tree=${plan.tree || ''}`,
    `tree_artifact_name=${plan.tree ? treeArtifactName(plan.tree) : ''}`,
    `proof_url=${plan.proof?.url || ''}`,
    `reason=${String(plan.reason || '').replace(/[\r\n]+/g, ' ')}`
  ];
  fs.appendFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
}

function writeReport(plan, { headSha, baseSha } = {}) {
  fs.mkdirSync(path.join(root, 'quality-reports'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'quality-reports', 'validated-tree.json'),
    `${JSON.stringify({
      mode: plan.reused ? 'staging' : 'full',
      tree: plan.tree,
      headSha: headSha || null,
      baseSha: baseSha || null,
      reason: plan.reason,
      proof: plan.proof
    }, null, 2)}\n`,
    'utf8'
  );
}

async function main() {
  const tree = currentTree();
  const headSha = String(process.env.SEENIT_PR_HEAD_SHA || '').trim();
  const baseSha = String(process.env.SEENIT_VALIDATE_BASE_SHA || '').trim();
  const token = process.env.GITHUB_TOKEN;
  const plan = await resolveStagingProof({
    event: process.env.GITHUB_EVENT_NAME,
    repository: process.env.GITHUB_REPOSITORY,
    headSha,
    baseSha,
    tree,
    request: token ? githubRequest({ token, apiUrl: process.env.GITHUB_API_URL }) : null
  });
  writeReport(plan, { headSha, baseSha });
  writeOutputs(plan);
  console.log(`[Preuve staging] ${plan.reused ? 'Réutilisée' : 'Non réutilisée'} : ${plan.reason}.`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[Preuve staging] ⚠️ ${error.message} : validation PR complète.`);
    process.exitCode = 0;
  });
}

module.exports = {
  AGENT_JOB,
  AGENT_WORKFLOW_PATH,
  STAGING_ARTIFACT_PREFIX,
  TREE_ARTIFACT_PREFIX,
  changedFiles,
  currentTree,
  findStagingProof,
  githubRequest,
  isTrustedStagingRun,
  isValidationInfrastructureFile,
  resolveStagingProof,
  stagingArtifactName,
  stagingJobSucceeded,
  treeArtifactName,
  validationInfrastructureChanged,
  writeOutputs,
  writeReport
};
