import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const staging = require('../scripts/staging-validation-proof.cjs');
const scope = require('../scripts/validation-scope.cjs');
const treeProof = require('../scripts/validated-tree-proof.cjs');

const REPO = 'julfou7/seenit-app';
const REPO_ID = 1338192018;
const HEAD = '1'.repeat(40);
const BASE = '2'.repeat(40);
const TREE = '3'.repeat(40);

function api(overrides: {
  artifacts?: unknown[];
  run?: Record<string, unknown>;
  jobs?: unknown[];
  fail?: boolean;
} = {}) {
  const calls: string[] = [];
  const name = staging.stagingArtifactName(HEAD, BASE, TREE);
  const request = async (route: string) => {
    calls.push(route);
    if (overrides.fail) throw new Error('GitHub 502 sur /repos');
    if (route.includes('/actions/artifacts?name=')) {
      return {
        artifacts: overrides.artifacts ?? [{
          name,
          expired: false,
          workflow_run: { id: 41, repository_id: REPO_ID, head_repository_id: REPO_ID }
        }]
      };
    }
    if (/\/actions\/runs\/\d+\/jobs/.test(route)) {
      return {
        jobs: overrides.jobs ?? [{
          name: 'Validate exact staging SHA',
          status: 'completed',
          conclusion: 'success'
        }]
      };
    }
    if (/\/actions\/runs\/\d+$/.test(route)) {
      return {
        id: 41,
        html_url: 'https://github.com/julfou7/seenit-app/actions/runs/41',
        head_sha: HEAD,
        head_branch: 'agent-staging/85-proof',
        event: 'push',
        status: 'completed',
        conclusion: 'success',
        path: '.github/workflows/agent-remote-validate.yml',
        repository: { full_name: REPO },
        head_repository: { full_name: REPO },
        ...overrides.run
      };
    }
    throw new Error(`route inattendue ${route}`);
  };
  return { calls, request };
}

const resolve = (fake: ReturnType<typeof api>, infrastructureChanged = () => false) => staging.resolveStagingProof({
  event: 'pull_request',
  repository: REPO,
  headSha: HEAD,
  baseSha: BASE,
  tree: TREE,
  request: fake.request,
  infrastructureChanged,
  log: () => {}
});

test('#85 le fast path documentaire est borné aux runbooks et au registre Markdown', () => {
  const allowed = [
    'docs/process/delivery.md',
    'docs/process/agent-remote-workspace.md',
    'docs/requests/registry.md'
  ];
  for (const file of allowed) assert.equal(scope.isStrictProcessDocumentation(file), true, file);

  const refused = [
    'AGENTS.md',
    '.agents/AGENTS.md',
    'docs/specifications/seenit.md',
    'docs/specifications/requirements.json',
    '.github/workflows/build-apk.yml',
    'scripts/validate-change.cjs',
    'tests/validatedTreeProof.test.ts',
    'src/App.tsx',
    'package.json'
  ];
  for (const file of refused) assert.equal(scope.isStrictProcessDocumentation(file), false, file);

  assert.equal(scope.resolveValidationScope({ event: 'pull_request', changes: allowed.map(path => ({ status: 'M', path })) }).docsOnly, true);
  assert.equal(scope.resolveValidationScope({ event: 'push', changes: [{ status: 'R', previousPath: 'docs/process/a.md', path: 'docs/process/b.md' }] }).docsOnly, true);
  assert.equal(scope.resolveValidationScope({ event: 'push', changes: [{ status: 'R', previousPath: 'src/App.tsx', path: 'docs/process/app.md' }] }).docsOnly, false);
  assert.equal(scope.resolveValidationScope({ event: 'schedule', changes: [{ status: 'M', path: 'docs/process/delivery.md' }] }).docsOnly, false, 'un audit planifié reste complet');
  assert.equal(scope.resolveValidationScope({ event: 'pull_request', changes: [] }).docsOnly, false, 'une plage vide ne crée pas de raccourci');
});

test('#85 une PR réutilise uniquement la preuve staging exacte head + base + arbre', async () => {
  const fake = api();
  const result = await resolve(fake);
  assert.equal(result.reused, true);
  assert.equal(result.proof.runId, 41);
  assert.match(result.reason, /staging 111111111111/);
  assert.equal(staging.stagingArtifactName(HEAD, BASE, TREE), `SeenIt-Agent-Validated-${HEAD}-${BASE}-${TREE}`);
  assert.equal(staging.treeArtifactName(TREE), `SeenIt-Validated-Tree-${TREE}`);
  assert.ok(fake.calls.some(call => call.includes(encodeURIComponent(staging.stagingArtifactName(HEAD, BASE, TREE)))));
});

test('#85 toute ambiguïté de preuve staging retombe sur une validation PR complète', async () => {
  const cases: Array<[string, ReturnType<typeof api>, () => boolean]> = [
    ['aucun artefact exact', api({ artifacts: [] }), () => false],
    ['artefact expiré', api({ artifacts: [{ name: staging.stagingArtifactName(HEAD, BASE, TREE), expired: true, workflow_run: { id: 41, repository_id: REPO_ID, head_repository_id: REPO_ID } }] }), () => false],
    ['fork', api({ artifacts: [{ name: staging.stagingArtifactName(HEAD, BASE, TREE), expired: false, workflow_run: { id: 41, repository_id: REPO_ID, head_repository_id: 99 } }] }), () => false],
    ['mauvais workflow', api({ run: { path: '.github/workflows/build-apk.yml' } }), () => false],
    ['mauvaise branche', api({ run: { head_branch: 'perf/85-proof' } }), () => false],
    ['mauvais head', api({ run: { head_sha: '4'.repeat(40) } }), () => false],
    ['run rouge', api({ run: { conclusion: 'failure' } }), () => false],
    ['job rouge', api({ jobs: [{ name: 'Validate exact staging SHA', status: 'completed', conclusion: 'failure' }] }), () => false],
    ['API en panne', api({ fail: true }), () => false],
    ['infrastructure de validation modifiée', api(), () => true]
  ];
  for (const [label, fake, changed] of cases) {
    const result = await resolve(fake, changed);
    assert.equal(result.reused, false, label);
  }

  assert.equal((await staging.resolveStagingProof({ event: 'push', repository: REPO, headSha: HEAD, baseSha: BASE, tree: TREE, request: api().request })).reused, false);
});

test('#85 les surfaces capables d’affaiblir la validation interdisent la réutilisation staging', () => {
  for (const file of [
    '.github/workflows/build-apk.yml',
    '.github/actions/example/action.yml',
    '.devcontainer/Dockerfile',
    'scripts/validate-change.cjs',
    'scripts/staging-validation-proof.cjs',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'vite.config.ts',
    'docs/specifications/quality-gates.json'
  ]) assert.equal(staging.isValidationInfrastructureFile(file), true, file);

  for (const file of ['src/App.tsx', 'android/app/src/main/AndroidManifest.xml', 'tests/example.test.ts', 'docs/process/delivery.md']) {
    assert.equal(staging.isValidationInfrastructureFile(file), false, file);
  }
});

test('#85 les modes prévalidés staging et docs publient la preuve normale sans smoke', () => {
  const staged = treeProof.resolvePrevalidatedPlan({ tree: TREE, stagingReused: 'true', stagingProofUrl: 'https://example/proof', docsOnly: 'false' });
  assert.equal(staged.mode, 'staging');
  assert.equal(staged.tree, TREE);
  assert.equal(staged.proof.url, 'https://example/proof');

  const docs = treeProof.resolvePrevalidatedPlan({ tree: TREE, stagingReused: 'false', stagingProofUrl: '', docsOnly: 'true' });
  assert.equal(docs.mode, 'docs');
  assert.equal(docs.tree, TREE);

  assert.equal(treeProof.resolvePrevalidatedPlan({ tree: TREE, stagingReused: 'false', stagingProofUrl: '', docsOnly: 'false' }), null);
});

test('#85 Agent Remote Validate publie une preuve exacte et lit le cache node_modules canonique', () => {
  const workflow = readFileSync('.github/workflows/agent-remote-validate.yml', 'utf8');
  const at = (label: string) => {
    const index = workflow.indexOf(label);
    assert.ok(index >= 0, label);
    return index;
  };

  assert.ok(at('Resolve exact main merge-base and proof identity') < at('Resolve strict documentation scope'));
  assert.ok(at('Resolve strict documentation scope') < at('Build canonical devcontainer'));
  assert.match(workflow, /Build canonical devcontainer\n {8}if: steps\.scope\.outputs\.docs_only != 'true'/);
  assert.match(workflow, /Run PWA Browser Quality Gate\n {8}if: steps\.scope\.outputs\.docs_only != 'true'/);
  assert.match(workflow, /key: seenit-node-modules-\$\{\{ runner\.os \}\}-\$\{\{ runner\.arch \}\}-node-\$\{\{ steps\.runtime\.outputs\.node_version \}\}-\$\{\{ steps\.runtime\.outputs\.deps_hash \}\}/);
  assert.doesNotMatch(workflow, /seenit-agent-node-modules-/);
  assert.doesNotMatch(workflow, /Save trusted staging node_modules cache/);
  assert.ok(at('Run PWA Browser Quality Gate') < at('Publish exact staging validation proof'));
  assert.match(workflow, /SeenIt-Agent-Validated-\$\{GITHUB_SHA\}-\$\{base_sha\}-\$\{tree_sha\}/);
});

test('#85 la PR vérifie la preuve staging avant toute validation coûteuse et garde le fallback complet', () => {
  const workflow = readFileSync('.github/workflows/build-apk.yml', 'utf8');
  const job = workflow.slice(workflow.indexOf('  validate:'), workflow.indexOf('\n  build:'));
  const at = (label: string) => {
    const index = job.indexOf(label);
    assert.ok(index >= 0, label);
    return index;
  };

  assert.ok(at('Resolve Trusted Staging Proof') < at('Install pinned actionlint'));
  assert.ok(at('Resolve Trusted Staging Proof') < at('Restore Exact node_modules Cache'));
  assert.ok(at('Resolve strict documentation scope') < at('Restore Exact node_modules Cache'));
  assert.match(job, /Install pinned actionlint\n {8}if: steps\.staging_proof\.outputs\.reused != 'true'/);
  assert.match(job, /Restore Exact node_modules Cache\n {8}if: steps\.staging_proof\.outputs\.reused != 'true' && steps\.scope\.outputs\.docs_only != 'true'/);
  assert.match(job, /Validate Change Canonical\n {8}if: steps\.staging_proof\.outputs\.reused != 'true' && steps\.scope\.outputs\.docs_only != 'true'/);
  assert.match(job, /SEENIT_STAGING_PROOF_REUSED: \$\{\{ steps\.staging_proof\.outputs\.reused \}\}/);
  assert.match(job, /SEENIT_DOCS_ONLY: \$\{\{ steps\.scope\.outputs\.docs_only \}\}/);
  assert.match(job, /Run PWA Browser Quality Gate\n {8}if: steps\.proof\.outputs\.skip_browser != 'true'/);
  assert.match(job, /Publish Validated Tree Proof\n {8}if: success\(\) && \(github\.event_name == 'pull_request' \|\| github\.event_name == 'workflow_dispatch'\) && steps\.proof\.outputs\.tree != ''/);
});
