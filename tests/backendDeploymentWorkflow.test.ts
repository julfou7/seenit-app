import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(rootDir, '.github', 'workflows', 'deploy-backend.yml');
const bootstrapPath = path.join(rootDir, 'scripts', 'bootstrap-gcp-backend-deploy.sh');
const projectTomlPath = path.join(rootDir, 'project.toml');
const sanitizerPath = path.join(rootDir, 'scripts', 'prepare-cloud-run-candidate.cjs');
const runbookPath = path.join(rootDir, 'docs', 'runtime-cutover.md');
const workflow = fs.readFileSync(workflowPath, 'utf8');
const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');
const projectToml = fs.readFileSync(projectTomlPath, 'utf8');
const sanitizer = fs.readFileSync(sanitizerPath, 'utf8');
const runbook = fs.readFileSync(runbookPath, 'utf8');

test('SEENIT-RUNTIME-001 déploie le backend canonique uniquement après validation de main', () => {
  assert.match(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /server\.ts/);
  assert.match(workflow, /src\/\*\*/);
  assert.match(workflow, /project\.toml/);
  assert.match(workflow, /backend-runtime-impact\.cjs/);
  assert.match(workflow, /prepare-cloud-run-candidate\.cjs/);
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
  assert.doesNotMatch(bootstrap, /roles\/(viewer|logging\.viewer)/);
});

test('SEENIT-RUNTIME-001 initialise le dépôt Docker Artifact Registry de façon idempotente', () => {
  const describeRepository = workflow.indexOf('gcloud artifacts repositories describe "$GCP_ARTIFACT_REPOSITORY"');
  const createRepository = workflow.indexOf('gcloud artifacts repositories create "$GCP_ARTIFACT_REPOSITORY"');
  const buildImage = workflow.indexOf('gcloud builds submit .');

  assert.ok(describeRepository >= 0);
  assert.ok(createRepository > describeRepository);
  assert.ok(buildImage > createRepository);
  assert.match(workflow, /--repository-format=docker/);
  assert.match(workflow, /--location "\$GCP_REGION"/);
});

test('SEENIT-RUNTIME-001 suit Cloud Build sans exiger la lecture du bucket de logs', () => {
  const buildImage = workflow.indexOf('gcloud builds submit .');
  const asyncSubmit = workflow.indexOf('--async', buildImage);
  const describeBuild = workflow.indexOf('gcloud builds describe "$build_id"');
  const successGate = workflow.indexOf('SUCCESS)', describeBuild);
  const resolveDigest = workflow.indexOf('image_summary.digest');

  assert.ok(buildImage >= 0);
  assert.ok(asyncSubmit > buildImage);
  assert.ok(describeBuild > asyncSubmit);
  assert.ok(successGate > describeBuild);
  assert.ok(resolveDigest > successGate);
  assert.match(workflow, /PENDING\|QUEUED\|WORKING/);
  assert.match(workflow, /FAILURE\|INTERNAL_ERROR\|TIMEOUT\|CANCELLED\|EXPIRED\|STATUS_UNKNOWN/);
  assert.match(workflow, /Cloud Build lancé sans streaming de logs/);
  assert.doesNotMatch(workflow, /gcloud builds log/);
});

test('SEENIT-RUNTIME-001 remplace le service exporté sans réutiliser le déploiement source hérité', () => {
  const resolveDigest = workflow.indexOf('image_summary.digest');
  const exportService = workflow.indexOf('--format=export', resolveDigest);
  const prepareCandidate = workflow.indexOf('node scripts/prepare-cloud-run-candidate.cjs', exportService);
  const firstReplace = workflow.indexOf('gcloud run services replace "$candidate_service"', prepareCandidate);
  const dryRun = workflow.indexOf('--dry-run', firstReplace);
  const appliedReplace = workflow.indexOf('gcloud run services replace "$candidate_service"', firstReplace + 1);

  assert.ok(resolveDigest >= 0);
  assert.ok(exportService > resolveDigest);
  assert.ok(prepareCandidate > exportService);
  assert.ok(firstReplace > prepareCandidate);
  assert.ok(dryRun > firstReplace);
  assert.ok(appliedReplace > dryRun);
  assert.doesNotMatch(workflow.slice(resolveDigest, appliedReplace), /gcloud run services update-traffic/);
  assert.doesNotMatch(workflow, /google-github-actions\/deploy-cloudrun@v3/);
  assert.doesNotMatch(workflow, /gcloud run deploy/);
  assert.doesNotMatch(workflow, /^\s*source:\s*\.\s*$/m);

  assert.ok(sanitizer.includes('(?:sources|base-images)'));
  assert.ok(sanitizer.includes('runtimeClassName: run.googleapis.com/linux-base-image-update'));
  assert.ok(sanitizer.includes('ligne(s) image détectée(s), 1 attendue'));
  assert.ok(sanitizer.includes('normalizeTraffic'));
});

test('SEENIT-RUNTIME-001 attend la readiness candidate sans exposer la production', () => {
  const replace = workflow.lastIndexOf('gcloud run services replace "$candidate_service"');
  const deadline = workflow.indexOf('candidate_deadline=$((SECONDS + 120))', replace);
  const readyFlag = workflow.indexOf('candidate_ready=false', deadline);
  const trafficGuard = workflow.indexOf('La création de la candidate a modifié le trafic avant smoke.', readyFlag);
  const readyGate = workflow.indexOf('"$latest_ready" == "$candidate_revision"', trafficGuard);
  const timeoutDiagnostic = workflow.indexOf('gcloud run revisions describe "$candidate_revision"', readyGate);
  const candidateStateGuard = workflow.indexOf('La cible candidate à 0 % avec son tag', timeoutDiagnostic);

  assert.ok(replace >= 0);
  assert.ok(deadline > replace);
  assert.ok(readyFlag > deadline);
  assert.ok(trafficGuard > readyFlag);
  assert.ok(readyGate > trafficGuard);
  assert.ok(timeoutDiagnostic > readyGate);
  assert.ok(candidateStateGuard > timeoutDiagnostic);
  assert.doesNotMatch(workflow, /--update-tags "\$CANDIDATE_TAG=\$candidate_revision"/);
  assert.match(workflow, /Candidate en attente de readiness/);
  assert.match(workflow, /sleep 5/);
});

test('SEENIT-RUNTIME-001 garde la production sur l’ancienne révision jusqu’au smoke candidat', () => {
  const appliedReplace = workflow.lastIndexOf('gcloud run services replace "$candidate_service"');
  const candidateCheck = workflow.indexOf("verify_endpoint \"$candidate_url\" 'Révision candidate'");
  const firstTrafficMutationAfterReplace = workflow.indexOf('gcloud run services update-traffic', appliedReplace);
  const trafficSwitch = workflow.indexOf('--to-revisions "$candidate_revision=100"');
  const productionCheck = workflow.indexOf("verify_endpoint \"$CANONICAL_ORIGIN\" 'Backend canonique'");

  assert.ok(appliedReplace >= 0);
  assert.ok(candidateCheck > appliedReplace);
  assert.ok(firstTrafficMutationAfterReplace > candidateCheck);
  assert.ok(trafficSwitch > candidateCheck);
  assert.ok(productionCheck > trafficSwitch);
  assert.match(workflow, /La création de la candidate a modifié le trafic avant smoke/);
  assert.match(workflow, /La cible candidate à 0 % avec son tag/);
  assert.match(workflow, /\.status == "ok" and \.service == "seenit-backend" and \.identity == "canonical"/);
  assert.match(workflow, /x-seenit-backend/);
  assert.match(workflow, /api\/releases\/notify/);
});

test('SEENIT-RUNTIME-001 conserve un rollback vers la révision précédemment servie', () => {
  assert.match(workflow, /PREVIOUS_REVISION/);
  assert.match(workflow, /Rollback vers \$PREVIOUS_REVISION/);
  assert.match(workflow, /--to-revisions "\$PREVIOUS_REVISION=100"/);
});

test('SEENIT-COST-001 purge les artefacts de build régénérables seulement après validation production', () => {
  const productionCheck = workflow.indexOf("verify_endpoint \"$CANONICAL_ORIGIN\" 'Backend canonique'");
  const cleanupStep = workflow.indexOf('Purge regenerable Cloud Build artifacts');
  const noSourceBuild = workflow.indexOf('--no-source', cleanupStep);
  const cleanupConfig = workflow.indexOf('cloudbuild/cleanup-seenit-artifacts.yaml', cleanupStep);

  assert.ok(productionCheck >= 0);
  assert.ok(cleanupStep > productionCheck);
  assert.ok(noSourceBuild > cleanupStep);
  assert.ok(cleanupConfig > cleanupStep);
  assert.match(workflow, /Artefacts régénérables purgés/);
  assert.match(workflow, /cleanup_deadline=\$\(\(SECONDS \+ 900\)\)/);

  const cleanup = fs.readFileSync(path.join(rootDir, 'cloudbuild', 'cleanup-seenit-artifacts.yaml'), 'utf8');
  assert.match(cleanup, /gcloud artifacts packages delete/);
  assert.match(cleanup, /--repository=/);
  assert.match(cleanup, /--location=/);
  assert.match(cleanup, /\$\{PROJECT_ID\}_cloudbuild\/source/);
  assert.match(cleanup, /gcloud storage rm/);
  assert.match(cleanup, /logging:\s*CLOUD_LOGGING_ONLY/);
});

test('SEENIT-COST-001 capture un inventaire GCP en lecture seule après la purge', () => {
  const cleanupStep = workflow.indexOf('Purge regenerable Cloud Build artifacts');
  const inventoryStep = workflow.indexOf('Snapshot FinOps GCP inventory');
  assert.ok(cleanupStep >= 0);
  assert.ok(inventoryStep > cleanupStep);
  assert.match(workflow.slice(inventoryStep), /bash scripts\/gcp-finops-inventory\.sh/);

  const inventory = fs.readFileSync(path.join(rootDir, 'scripts', 'gcp-finops-inventory.sh'), 'utf8');
  assert.match(inventory, /gcloud firestore databases list/);
  assert.match(inventory, /databaseEdition, freeTier, createTime, updateTime/);
  assert.match(inventory, /firestoreDataAccessMode, mongodbCompatibleDataAccessMode/);
  assert.match(inventory, /gcloud storage buckets list/);
  assert.match(inventory, /FINOPS_DEEP_STORAGE_SCAN/);
  assert.match(inventory, /REPORT_PATH="\${FINOPS_REPORT_PATH:-}"/);
  assert.match(inventory, /default_count=.*== \\"default\\"/);
  assert.doesNotMatch(inventory, /== \\"\(default\)\\"/);
  assert.match(inventory, /gcloud sql instances list/);
  assert.match(inventory, /gcloud artifacts repositories list[\s\S]*--location=all/);
  assert.match(inventory, /gcloud artifacts packages list/);
  assert.match(inventory, /gcloud run services list/);
  assert.match(inventory, /--format=json 2>\/dev\/null/);
  assert.doesNotMatch(inventory, /--format=json 2>&1/);
  assert.doesNotMatch(inventory, /gcloud (?:firestore|storage|sql|artifacts|run).*(?: delete | rm | update | create )/);

  const auditWorkflow = fs.readFileSync(
    path.join(rootDir, '.github', 'workflows', 'audit-gcp-finops.yml'),
    'utf8'
  );
  assert.match(auditWorkflow, /FINOPS_REPORT_PATH/);
  assert.match(auditWorkflow, /cat "\\$FINOPS_REPORT_PATH"/);
  assert.doesNotMatch(auditWorkflow, /cat "\\$GITHUB_STEP_SUMMARY"/);
});

test('SEENIT-RUNTIME-001 documente que la sync AI Studio ne vaut jamais preuve de déploiement', () => {
  assert.match(runbook, /sync Git AI Studio/i);
  assert.match(runbook, /ne constitu(?:e|ent) pas un déploiement/i);
  assert.match(runbook, /Cloud Build/i);
  assert.match(runbook, /digest/i);
  assert.match(runbook, /(?:service exporté|exporter le service)/i);
  assert.match(runbook, /métadonnées source/i);
  assert.match(runbook, /readiness/i);
  assert.match(runbook, /0 %/i);
  assert.match(runbook, /bootstrap-gcp-backend-deploy\.sh/);
});
