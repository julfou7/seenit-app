import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(rootDir, '.github', 'workflows', 'deploy-backend.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');

test('SEENIT-RUNTIME-001 déploie le backend canonique uniquement après validation de main', () => {
  assert.match(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /server\.ts/);
  assert.match(workflow, /src\/features\/runtime\/\*\*/);
  assert.match(workflow, /actions\/workflows\/build-apk\.yml\/runs\?head_sha=\$\{GITHUB_SHA\}&event=push/);
  assert.match(workflow, /conclusion[^\n]*success/);
});

test('SEENIT-RUNTIME-001 utilise WIF sans clé JSON durable', () => {
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /google-github-actions\/auth@v3/);
  assert.match(workflow, /SEENIT_GCP_WORKLOAD_IDENTITY_PROVIDER/);
  assert.match(workflow, /SEENIT_GCP_DEPLOY_SERVICE_ACCOUNT/);
  assert.doesNotMatch(workflow, /credentials_json|GCP_CREDENTIALS|SERVICE_ACCOUNT_KEY/);
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
