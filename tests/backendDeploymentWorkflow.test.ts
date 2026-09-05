import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(rootDir, '.github', 'workflows', 'deploy-backend.yml');
const bootstrapPath = path.join(rootDir, 'scripts', 'bootstrap-gcp-backend-deploy.sh');
const projectTomlPath = path.join(rootDir, 'project.toml');
const runbookPath = path.join(rootDir, 'docs', 'runtime-cutover.md');
const workflow = fs.readFileSync(workflowPath, 'utf8');
const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');
const projectToml = fs.readFileSync(projectTomlPath, 'utf8');
const runbook = fs.readFileSync(runbookPath, 'utf8');

test('SEENIT-RUNTIME-001 déploie le backend canonique uniquement après validation de main', () => {
  assert.match(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /server\.ts/);
  assert.match(workflow, /src\/\*\*/);
  assert.match(workflow, /project\.toml/);
  assert.match(workflow, /backend-runtime-impact\.cjs/);
  assert.match(workflow, /actions\/workflows\/build-apk\.yml\/runs\?head_sha=\$\{GITHUB_SHA\}&event=push/);
  assert.match(workflow, /conclusion[^\n]*success/);
  assert.match(workflow, /SHOULD_DEPLOY/);
});

test('SEENIT-RUNTIME-001 aligne les installations npm CI et Buildpacks', () => {
  assert.match(workflow, /npm ci --legacy-peer-deps --ignore-scripts --prefer-offline --no-audit --no-fund/);
  assert.match(projectToml, /name = "NODE_ENV"\s+value = "development"/);
  assert.match(projectToml, /name = "NPM_CONFIG_LEGACY_PEER_DEPS"\s+value = "true"/);
});

test('SEENIT-RUNTIME-001 utilise une WIF bornée au dépôt sans clé JSON durable', () => {
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /google-github-actions\/auth@v3/);
  assert.match(workflow, /projects\/799043440232\/locations\/global\/workloadIdentityPools\/seenit-github\/providers\/seenit-main/);
  assert.match(workflow, /seenit-github-deployer@gen-lang-client-0201895414\.iam\.gserviceaccount\.com/);
  assert.match(bootstrap, /iam\.googleapis\.com/);
  assert.match(bootstrap, /iamcredentials\.googleapis\.com/);
  assert.match(bootstrap, /sts\.googleapis\.com/);
  assert.match(bootstrap, /cloudresourcemanager\.googleapis\.com/);
  assert.match(bootstrap, /REPOSITORY_ID="1338192018"/);
  assert.match(bootstrap, /assertion\.repository_id=='\$\{REPOSITORY_ID\}'/);
  assert.match(bootstrap, /assertion\.ref=='refs\/heads\/main'/);
  assert.match(bootstrap, /roles\/iam\.workloadIdentityUser/);
  assert.doesNotMatch(`${workflow}\n${bootstrap}`, /credentials_json|GCP_CREDENTIALS|SERVICE_ACCOUNT_KEY/);
});

test('SEENIT-RUNTIME-001 sépare le build de l’image du déploiement Cloud Run hérité', () => {
  const buildImage = workflow.indexOf('gcloud builds submit .');
  const resolveDigest = workflow.indexOf('image_summary.digest');
  const deployImage = workflow.indexOf('image: ${{ steps.image.outputs.uri }}');

  assert.ok(buildImage >= 0);
  assert.ok(resolveDigest > buildImage);
  assert.ok(deployImage > resolveDigest);
  assert.match(workflow, /cloud-run-source-deploy/);
  assert.match(workflow, /image_uri="\$\{image_tag%:\*\}@\$\{digest\}"/);
  assert.doesNotMatch(workflow, /^\s*source:\s*\.\s*$/m);
});

test('SEENIT-RUNTIME-001 valide la nouvelle révision avant de basculer le trafic', () => {
  const deployWithoutTraffic = workflow.indexOf('no_traffic: true');
  const candidateCheck = workflow.indexOf("verify_endpoint \"$candidate_url\" 'Révision candidate'");
  const trafficSwitch = workflow.indexOf('--to-revisions "$candidate_revision=100"');
  const productionCheck = workflow.indexOf("verify_endpoint \"$CANONICAL_ORIGIN\" 'Backend canonique'");

  assert.ok(deployWithoutTraffic >= 0);
  assert.ok(candidateCheck > deployWithoutTraffic);
  assert.ok(trafficSwitch > candidateCheck);
  assert.ok(productionCheck > trafficSwitch);
  assert.match(workflow, /\.status == "ok" and \.service == "seenit-backend" and \.identity == "canonical"/);
  assert.match(workflow, /x-seenit-backend/);
  assert.match(workflow, /api\/releases\/notify/);
});

test('SEENIT-RUNTIME-001 conserve un rollback vers la révision précédemment servie', () => {
  assert.match(workflow, /PREVIOUS_REVISION/);
  assert.match(workflow, /Rollback vers \$PREVIOUS_REVISION/);
  assert.match(workflow, /--to-revisions "\$PREVIOUS_REVISION=100"/);
});

test('SEENIT-RUNTIME-001 documente que la sync AI Studio ne vaut jamais preuve de déploiement', () => {
  assert.match(runbook, /sync Git AI Studio/i);
  assert.match(runbook, /ne constitu(?:e|ent) pas un déploiement/i);
  assert.match(runbook, /Cloud Build/i);
  assert.match(runbook, /digest/i);
  assert.match(runbook, /bootstrap-gcp-backend-deploy\.sh/);
});
