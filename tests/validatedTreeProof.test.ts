import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const proof = require('../scripts/validated-tree-proof.cjs');
const validateChange = require('../scripts/validate-change.cjs');

const REPO = 'julfou7/seenit-app';
const REPO_ID = 1338192018;
const TREE = '17b1daea548f094106be66087e3fec419d7af9dd';
const BASE = 'e1a90a807dbd583bbfbfe15623e738872e80ddbf';

type Route = (route: string) => unknown;

function api(overrides: { artifacts?: unknown[]; run?: Record<string, unknown>; jobs?: unknown[]; parentRuns?: unknown[]; fail?: boolean } = {}) {
  const calls: string[] = [];
  const handler: Route = route => {
    calls.push(route);
    if (overrides.fail) throw new Error('GitHub 502 sur /repos');
    if (route.includes('/actions/artifacts?name=')) {
      return { artifacts: overrides.artifacts ?? [{ name: `SeenIt-Validated-Tree-${TREE}`, expired: false, workflow_run: { id: 11, repository_id: REPO_ID, head_repository_id: REPO_ID } }] };
    }
    if (/\/actions\/runs\/\d+\/jobs/.test(route)) return { jobs: overrides.jobs ?? [{ name: 'Validate Change', status: 'completed', conclusion: 'success' }] };
    if (/\/actions\/runs\/\d+$/.test(route)) {
      return { id: 11, html_url: 'https://github.com/julfou7/seenit-app/actions/runs/11', head_sha: 'a'.repeat(40), event: 'pull_request', path: '.github/workflows/build-apk.yml', repository: { full_name: REPO }, head_repository: { full_name: REPO }, ...overrides.run };
    }
    if (route.includes('/workflows/build-apk.yml/runs?head_sha=')) {
      return { workflow_runs: overrides.parentRuns ?? [{ id: 22, html_url: 'https://github.com/julfou7/seenit-app/actions/runs/22', head_sha: BASE, status: 'completed', conclusion: 'success', path: '.github/workflows/build-apk.yml', repository: { full_name: REPO } }] };
    }
    throw new Error(`route inattendue ${route}`);
  };
  return { calls, request: async (route: string) => handler(route) };
}

const plan = (event: string, ref: string, fake: ReturnType<typeof api>, versionOnly = (_base: string) => false) =>
  proof.resolveValidationPlan({ event, ref, repository: REPO, baseSha: BASE, tree: TREE, request: fake.request, versionOnly, log: () => {} });

test('SEENIT-QUALITY-013 un push sur main réutilise la validation PR de confiance du même arbre exact', async () => {
  const result = await plan('push', 'refs/heads/main', api());
  assert.equal(result.mode, 'tree');
  assert.equal(result.proof.runId, 11);
  assert.match(result.reason, /arbre 17b1daea548f déjà validé avant fusion/);
  assert.equal(proof.proofArtifactName(TREE), `SeenIt-Validated-Tree-${TREE}`);
});

test('SEENIT-QUALITY-013 sans preuve exacte et de confiance, la validation complète est rejouée', async () => {
  const cases: Array<[string, ReturnType<typeof api>]> = [
    ['aucun artefact pour cet arbre', api({ artifacts: [] })],
    ['artefact expiré', api({ artifacts: [{ name: `SeenIt-Validated-Tree-${TREE}`, expired: true, workflow_run: { id: 11, repository_id: REPO_ID, head_repository_id: REPO_ID } }] })],
    ['PR depuis un fork', api({ artifacts: [{ name: `SeenIt-Validated-Tree-${TREE}`, expired: false, workflow_run: { id: 11, repository_id: REPO_ID, head_repository_id: 999 } }] })],
    ['dépôt de tête étranger', api({ run: { head_repository: { full_name: 'intrus/seenit-app' } } })],
    ['run planifié', api({ run: { event: 'schedule' } })],
    ['run de push', api({ run: { event: 'push' } })],
    ['autre workflow', api({ run: { path: '.github/workflows/agent-remote-validate.yml' } })],
    ['Validate Change rouge', api({ jobs: [{ name: 'Validate Change', status: 'completed', conclusion: 'failure' }] })],
    ['Validate Change absent', api({ jobs: [] })],
    ['API en panne', api({ fail: true })],
  ];
  for (const [label, fake] of cases) {
    const result = await plan('push', 'refs/heads/main', fake);
    assert.equal(result.mode, 'full', label);
    assert.equal(result.proof, null, label);
  }
});

test('#85 la preuve d’arbre ne sert qu’au push main : PR, autre branche et audit planifié restent complets', async () => {
  for (const [event, ref] of [['pull_request', 'refs/pull/807/merge'], ['push', 'refs/heads/feature'], ['schedule', 'refs/heads/main'], ['workflow_dispatch', 'refs/heads/main']]) {
    const fake = api();
    assert.equal((await plan(event, ref, fake)).mode, 'full', `${event} ${ref}`);
    assert.equal(fake.calls.some(call => call.includes('/actions/artifacts')), false, `${event} ne lit aucune preuve d’arbre`);
  }
  assert.equal((await proof.resolveValidationPlan({ event: 'push', ref: 'refs/heads/main', repository: REPO, baseSha: BASE, tree: TREE, request: null })).mode, 'full', 'sans jeton : complète');
});

test('version seule : smoke navigateur réutilisé uniquement si le parent a une validation verte', async () => {
  const versionOnly = (base: string) => base === BASE;
  const ok = await plan('pull_request', 'refs/pull/807/merge', api(), versionOnly);
  assert.equal(ok.mode, 'version');
  assert.equal(ok.proof.runId, 22);

  const redParent = await plan('pull_request', 'refs/pull/807/merge', api({ parentRuns: [{ id: 23, head_sha: BASE, status: 'completed', conclusion: 'failure', path: '.github/workflows/build-apk.yml', repository: { full_name: REPO } }] }), versionOnly);
  assert.equal(redParent.mode, 'full');
  const pendingParent = await plan('pull_request', 'refs/pull/807/merge', api({ parentRuns: [{ id: 24, head_sha: BASE, status: 'in_progress', conclusion: null, path: '.github/workflows/build-apk.yml', repository: { full_name: REPO } }] }), versionOnly);
  assert.equal(pendingParent.mode, 'full', 'un parent encore en cours ne prouve rien');
  const behavior = await plan('pull_request', 'refs/pull/805/merge', api(), () => false);
  assert.equal(behavior.mode, 'full', 'un changement de comportement rejoue tout');
  assert.equal((await plan('schedule', 'refs/heads/main', api(), versionOnly)).mode, 'full');
});

test('les sorties pilotent le job sans jamais réutiliser une preuve absente', () => {
  const lines = (value: Parameters<typeof proof.writeOutputs>[0]) => {
    let written = '';
    const file = `/tmp/seenit-proof-${process.pid}-${Math.random()}`;
    proof.writeOutputs(value, file);
    written = readFileSync(file, 'utf8');
    return written;
  };
  assert.match(lines({ mode: 'tree', tree: TREE, proof: { url: 'u' } }), /reused=true\nskip_browser=true\nproof_url=u/);
  assert.match(lines({ mode: 'version', tree: TREE, proof: { url: 'u' } }), /reused=false\nskip_browser=true/);
  assert.match(lines({ mode: 'full', tree: TREE, proof: null }), /reused=false\nskip_browser=false\nproof_url=\n/);
});

test('validate:change n’accepte une preuve que pour l’arbre courant exact', () => {
  assert.equal(validateChange.resolveProvenTree(''), null);
  assert.throws(() => validateChange.resolveProvenTree('0'.repeat(40)), /différente de l’arbre courant/);
  assert.throws(() => validateChange.resolveProvenTree('pas-un-arbre'), /différente de l’arbre courant/);
  assert.equal(validateChange.resolveProvenTree(proof.currentTree()), proof.currentTree());
  const script = readFileSync('scripts/validate-change.cjs', 'utf8');
  const proven = script.indexOf('const provenTree = resolveProvenTree();');
  assert.ok(proven > script.indexOf("label: 'Contrat de changement'"), 'classification et contrat restent rejoués');
  assert.ok(proven < script.indexOf("label: 'TypeScript + lint + format'"), 'seuls les contrôles d’arbre sont sautés');
});

test('SEENIT-QUALITY-013 la validation de candidate du contrôleur #102 sert de preuve et saute le smoke d’une version seule', async () => {
  // v1.4.240 : la PR ouverte par le bot n’exécute aucun job ; seule la validation dispatchée fait foi.
  const dispatchProof = await plan('push', 'refs/heads/main', api({ run: { event: 'workflow_dispatch' } }));
  assert.equal(dispatchProof.mode, 'tree', 'le push main réutilise la validation dispatchée de la candidate');
  const forkDispatch = await plan('push', 'refs/heads/main', api({ run: { event: 'workflow_dispatch', head_repository: { full_name: 'intrus/seenit-app' } } }));
  assert.equal(forkDispatch.mode, 'full');

  const versionOnly = (base: string) => base === BASE;
  const candidate = await plan('workflow_dispatch', 'refs/heads/release/v1.4.240', api(), versionOnly);
  assert.equal(candidate.mode, 'version', 'version seule sur un parent validé : smoke réutilisé');
  assert.equal((await plan('workflow_dispatch', 'refs/heads/release/v1.4.240', api(), () => false)).mode, 'full');
  const redParent = api({ parentRuns: [{ id: 25, head_sha: BASE, status: 'completed', conclusion: 'failure', path: '.github/workflows/build-apk.yml', repository: { full_name: REPO } }] });
  assert.equal((await plan('workflow_dispatch', 'refs/heads/release/v1.4.240', redParent, versionOnly)).mode, 'full');

  assert.match(proof.resolveDispatchBase(), /^[0-9a-f]{40}$/, 'la base du dispatch est le merge-base avec main');
});

test('SEENIT-QUALITY-008 la clé du cache node_modules ignore seulement la version de l’application', () => {
  const { dependencyCacheKey, withoutAppVersion, withoutLockAppVersion } = require('../scripts/dependency-cache-key.cjs');
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  assert.deepEqual(withoutAppVersion({ ...pkg, version: '9.9.9' }), withoutAppVersion(pkg));
  assert.deepEqual(withoutLockAppVersion({ ...lock, version: '9.9.9', packages: { ...lock.packages, '': { ...lock.packages[''], version: '9.9.9' } } }), withoutLockAppVersion(lock));
  assert.notDeepEqual(withoutAppVersion({ ...pkg, dependencies: { ...pkg.dependencies, 'left-pad': '1.3.0' } }), withoutAppVersion(pkg), 'une dépendance change la clé');
  const lockWithChangedDependency = { ...lock, packages: { ...lock.packages, 'node_modules/left-pad': { version: '1.3.0' } } };
  assert.notDeepEqual(withoutLockAppVersion(lockWithChangedDependency), withoutLockAppVersion(lock));
  assert.match(dependencyCacheKey(), /^[0-9a-f]{64}$/);
  const script = readFileSync('scripts/dependency-cache-key.cjs', 'utf8');
  assert.match(script, /scripts\/patch-local-notifications\.cjs/);
  assert.match(script, /scripts\/materialize-android-config\.cjs/);
});

test('#85 câblage du workflow : lecture seule, après installation, smoke conditionné, preuve publiée par la PR verte', () => {
  const workflow = readFileSync('.github/workflows/build-apk.yml', 'utf8');
  const job = workflow.slice(workflow.indexOf('  validate:'), workflow.indexOf('\n  build:'));
  assert.match(job, /permissions:\n {6}contents: read\n(?: {6}#.*\n)? {6}actions: read\n/);
  assert.doesNotMatch(job, /actions: write/);
  const at = (label: string) => { const index = job.indexOf(label); assert.ok(index >= 0, label); return index; };
  assert.ok(at('Install Dependencies on Cache Miss') < at('Resolve Validated Tree Proof'), 'le contrat de version a besoin des dépendances');
  assert.ok(at('Resolve Validated Tree Proof') < at('Validate Change Canonical'));
  assert.ok(at('Run PWA Browser Quality Gate') < at('Publish Validated Tree Proof'), 'la preuve n’est publiée qu’après le smoke');
  assert.match(job, /if: github\.event_name == 'push' \|\| github\.event_name == 'pull_request' \|\| github\.event_name == 'workflow_dispatch'\n {8}run: node scripts\/validated-tree-proof\.cjs/);
  assert.match(job, /SEENIT_VALIDATED_TREE_PROOF: \$\{\{ steps\.proof\.outputs\.reused == 'true' && steps\.proof\.outputs\.tree \|\| '' \}\}/);
  assert.match(job, /- name: Run PWA Browser Quality Gate\n {8}if: steps\.proof\.outputs\.skip_browser != 'true'/);
  assert.match(job, /- name: Publish Validated Tree Proof\n {8}if: success\(\) && \(github\.event_name == 'pull_request' \|\| github\.event_name == 'workflow_dispatch'\) && steps\.proof\.outputs\.tree != ''/);
  assert.match(job, /name: \$\{\{ steps\.proof\.outputs\.artifact_name \}\}/);
});

test('SEENIT-QUALITY-013 le smoke navigateur tourne en quatre couloirs isolés dans l’ordre historique', () => {
  const smoke = require('../scripts/pwa-browser-smoke.cjs');
  const config = JSON.parse(readFileSync('docs/specifications/quality-gates.json', 'utf8'));
  const groups = smoke.buildLaneGroups(config) as Array<Array<[string, unknown]>>;
  assert.equal(groups.length, 4);
  assert.deepEqual(groups.flat().map(([key]) => key), [
    'viewports', 'accessibility', 'componentActions', 'dialogs', 'providers', 'seriesCards', 'history', 'navbar',
    'tv', 'searchKeyboard', 'watchNext',
    'homeV4', 'homeTerrain221', 'homeTerrain222', 'homeTerrain223', 'homeTerrain224', 'homeTerrain226', 'homeTerrain227', 'home', 'homePerformance', 'homeUnseen',
  ], 'SEENIT_PWA_LANES=1 rejoue exactement la séquence historique');
  assert.equal(groups[1].at(-1)?.[0], 'watchNext', 'l’horloge virtuelle 18c reste la dernière de son client');
  assert.deepEqual(groups[0].slice(0, 3).map(([key]) => key), ['viewports', 'accessibility', 'componentActions']);
  assert.equal(smoke.resolveLaneCount(undefined, 4), 4);
  assert.equal(smoke.resolveLaneCount('1', 4), 1);
  assert.equal(smoke.resolveLaneCount('0', 4), 1);
  assert.equal(smoke.resolveLaneCount('9', 4), 4);

  const source = readFileSync('scripts/pwa-browser-smoke.cjs', 'utf8');
  assert.match(source, /--user-data-dir=\$\{userDataDir\}/, 'un profil, donc un stockage, par couloir');
  assert.match(source, /Emulation\.setFocusEmulationEnabled', \{ enabled: true \}/);
  assert.match(source, /timings\[key\] = /, 'chaque harnais publie sa durée');
  for (const file of ['history', 'home-a-voir', 'home-terrain220', 'home-terrain221', 'home-terrain222', 'home-terrain223', 'home-terrain224', 'home-terrain226', 'home-terrain227', 'navbar', 'provider', 'search-keyboard', 'series-card', 'tv', 'watch-next']) {
    const harness = readFileSync(`scripts/${file}-browser-checks.cjs`, 'utf8');
    assert.match(harness, /const poll = \(client, expression\) => evaluate\(client, expression\)\.catch\(\(\) => false\);/, file);
    assert.match(harness, /await poll\(/, `${file} attend sans échouer sur un élément pas encore rendu`);
  }
});
