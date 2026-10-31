// #85 — une validation complète par arbre Git livré.
// Une PR verte, ou la validation explicite d'une candidate lancée par le contrôleur #102 (workflow_dispatch,
// dont la PR ouverte par le bot n'exécute aucun job), publie la preuve de l'arbre réellement validé. Le push sur main ne
// rejoue la validation complète que s'il ne retrouve pas une preuve de confiance pour exactement le même
// arbre. Une version seule (8 surfaces) dont le parent est validé ne rejoue pas le smoke navigateur.
// Toute erreur, ambiguïté ou absence de preuve retombe sur la validation complète.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const WORKFLOW_PATH = '.github/workflows/build-apk.yml';
const VALIDATE_JOB = 'Validate Change';
const ARTIFACT_PREFIX = 'SeenIt-Validated-Tree-';
const PROOF_FILE = path.join('quality-reports', 'validated-tree.json');
const MAIN_REFS = new Set(['refs/heads/main', 'refs/heads/master']);
const SHA = /^[0-9a-f]{40}$/;

function git(args, cwd = root) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function currentTree(cwd = root) {
  const tree = git(['rev-parse', 'HEAD^{tree}'], cwd);
  if (!SHA.test(tree)) throw new Error(`Arbre Git invalide : ${tree}`);
  return tree;
}

function proofArtifactName(tree) {
  if (!SHA.test(String(tree || ''))) throw new Error(`Arbre Git invalide : ${tree}`);
  return `${ARTIFACT_PREFIX}${tree}`;
}

const PROOF_EVENTS = new Set(['pull_request', 'workflow_dispatch']);

/**
 * Seul un run de validation de ce dépôt (jamais un fork), sur le workflow canonique, fait foi : une PR, ou
 * un dispatch de validation (le job Validate Change ne tourne en dispatch que sans release_apk).
 */
function isTrustedValidationRun(run, repository) {
  return PROOF_EVENTS.has(run?.event)
    && run.path === WORKFLOW_PATH
    && run.repository?.full_name === repository
    && run.head_repository?.full_name === repository;
}

function validateJobSucceeded(jobs) {
  const job = (jobs || []).find(item => item?.name === VALIDATE_JOB);
  return job?.status === 'completed' && job.conclusion === 'success';
}

async function findTreeProof({ tree, repository, request }) {
  const name = proofArtifactName(tree);
  const listing = await request(`/repos/${repository}/actions/artifacts?name=${encodeURIComponent(name)}&per_page=20`);
  for (const artifact of listing?.artifacts || []) {
    const ref = artifact?.workflow_run;
    if (artifact?.name !== name || artifact.expired || !ref?.id) continue;
    if (!ref.repository_id || ref.repository_id !== ref.head_repository_id) continue;
    const run = await request(`/repos/${repository}/actions/runs/${ref.id}`);
    if (!isTrustedValidationRun(run, repository)) continue;
    const { jobs } = await request(`/repos/${repository}/actions/runs/${run.id}/jobs?per_page=50`);
    if (!validateJobSucceeded(jobs)) continue;
    return { runId: run.id, url: run.html_url, headSha: run.head_sha };
  }
  return null;
}

/** Le parent a-t-il une validation verte sur main (complète ou elle-même réutilisée) ? */
async function findValidatedParent({ baseSha, repository, request }) {
  if (!SHA.test(String(baseSha || ''))) return null;
  const listing = await request(`/repos/${repository}/actions/workflows/build-apk.yml/runs?head_sha=${baseSha}&event=push&per_page=10`);
  for (const run of listing?.workflow_runs || []) {
    if (run?.head_sha !== baseSha || run.status !== 'completed' || run.conclusion !== 'success') continue;
    if (run.path !== WORKFLOW_PATH || run.repository?.full_name !== repository) continue;
    const { jobs } = await request(`/repos/${repository}/actions/runs/${run.id}/jobs?per_page=50`);
    if (validateJobSucceeded(jobs)) return { runId: run.id, url: run.html_url };
  }
  return null;
}

function isVersionOnlyRange(baseSha, cwd = root) {
  if (!SHA.test(String(baseSha || ''))) return false;
  // Chargé tard : le contrat dépend de typescript, installé après le préflight.
  const { isPureVersionAlignment } = require('./validate-change-contract.cjs');
  const changed = git(['diff', '--name-only', `${baseSha}..HEAD`], cwd).split('\n').filter(Boolean);
  const readAt = (sha, file) => { try { return git(['show', `${sha}:${file}`], cwd); } catch { return ''; } };
  return isPureVersionAlignment(
    changed,
    file => execFileSync('git', ['diff', '--unified=0', `${baseSha}..HEAD`, '--', file], { cwd, encoding: 'utf8' }),
    file => readAt(baseSha, file),
    file => readAt('HEAD', file),
  );
}

function githubRequest({ token, apiUrl = 'https://api.github.com', fetchImpl = fetch }) {
  return async route => {
    const response = await fetchImpl(`${apiUrl}${route}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (!response.ok) throw new Error(`GitHub ${response.status} sur ${route.split('?')[0]}`);
    return response.json();
  };
}

/**
 * Décide ce que le job doit rejouer. `full` = validation complète ; `tree` = preuve exacte réutilisée ;
 * `version` = version seule, parent validé : validation canonique sans smoke navigateur.
 */
async function resolveValidationPlan({ event, ref, repository, baseSha, tree, request, versionOnly = isVersionOnlyRange, log = console.log }) {
  const plan = { mode: 'full', tree, proof: null, reason: 'aucune preuve exacte' };
  if (!request || !repository) return { ...plan, reason: 'API GitHub indisponible' };
  try {
    if (event === 'push' && MAIN_REFS.has(ref)) {
      const proof = await findTreeProof({ tree, repository, request });
      if (proof) return { mode: 'tree', tree, proof, reason: `arbre ${tree.slice(0, 12)} déjà validé avant fusion (run ${proof.runId})` };
    }
    if ((event === 'push' && MAIN_REFS.has(ref)) || PROOF_EVENTS.has(event)) {
      if (versionOnly(baseSha)) {
        const parent = await findValidatedParent({ baseSha, repository, request });
        if (parent) return { mode: 'version', tree, proof: parent, reason: `version seule sur un parent validé (run ${parent.runId})` };
        return { ...plan, reason: 'version seule mais parent sans validation verte' };
      }
    }
  } catch (error) {
    log(`[Preuve] ⚠️ ${error.message} : validation complète.`);
    return { ...plan, reason: `erreur de lecture de preuve (${error.message})` };
  }
  return plan;
}

function writeOutputs(plan, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) return;
  const lines = [
    `tree=${plan.tree}`,
    `artifact_name=${proofArtifactName(plan.tree)}`,
    `mode=${plan.mode}`,
    `reused=${plan.mode === 'tree'}`,
    `skip_browser=${plan.mode !== 'full'}`,
    `proof_url=${plan.proof?.url || ''}`,
  ];
  fs.appendFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
}

/** Base d'un dispatch de candidate : le main dont la branche est partie, comme resolveBaseSha de validate:change. */
function resolveDispatchBase(cwd = root) {
  for (const ref of ['refs/remotes/origin/main', 'refs/remotes/origin/master']) {
    try {
      const sha = git(['merge-base', 'HEAD', ref], cwd);
      if (SHA.test(sha)) return sha;
    } catch {}
  }
  return '';
}

async function main() {
  const tree = currentTree();
  const token = process.env.GITHUB_TOKEN;
  const event = process.env.GITHUB_EVENT_NAME;
  const declaredBase = String(process.env.SEENIT_VALIDATE_BASE_SHA || '').trim();
  const plan = await resolveValidationPlan({
    event,
    ref: process.env.GITHUB_REF,
    repository: process.env.GITHUB_REPOSITORY,
    baseSha: declaredBase || (event === 'workflow_dispatch' ? resolveDispatchBase() : ''),
    tree,
    request: token ? githubRequest({ token, apiUrl: process.env.GITHUB_API_URL }) : null,
  });
  fs.mkdirSync(path.join(root, 'quality-reports'), { recursive: true });
  fs.writeFileSync(path.join(root, PROOF_FILE), `${JSON.stringify({ tree, sha: git(['rev-parse', 'HEAD']), runId: process.env.GITHUB_RUN_ID || null, mode: plan.mode, reason: plan.reason, proof: plan.proof }, null, 2)}\n`, 'utf8');
  writeOutputs(plan);
  console.log(`[Preuve] ${plan.mode === 'full' ? 'Validation complète' : plan.mode === 'tree' ? 'Preuve réutilisée' : 'Smoke navigateur réutilisé'} : ${plan.reason}.`);
}

if (require.main === module) {
  main().catch(error => {
    // Une décision impossible ne bloque pas : le job garde la validation complète (sorties absentes).
    console.error(`[Preuve] ⚠️ ${error.message} : validation complète.`);
  });
}

module.exports = {
  ARTIFACT_PREFIX,
  PROOF_FILE,
  VALIDATE_JOB,
  WORKFLOW_PATH,
  currentTree,
  findTreeProof,
  findValidatedParent,
  githubRequest,
  isTrustedValidationRun,
  resolveDispatchBase,
  isVersionOnlyRange,
  proofArtifactName,
  resolveValidationPlan,
  validateJobSucceeded,
  writeOutputs,
};
