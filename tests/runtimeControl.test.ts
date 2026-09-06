import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/runtime-control.yml', 'utf8');
const deployWorkflow = fs.readFileSync('.github/workflows/deploy-backend.yml', 'utf8');
const documentation = fs.readFileSync('docs/process/runtime-control.md', 'utf8');

test('le contrôle PWA connector-only est borné au propriétaire et à l issue runtime', () => {
  assert.match(workflow, /github\.event\.issue\.number == 57/);
  assert.match(workflow, /github\.event\.comment\.user\.login == github\.event\.repository\.owner\.login/);
  assert.match(workflow, /github\.event\.comment\.author_association == 'OWNER'/);
  assert.match(workflow, /github\.event\.comment\.body == '\/deploy-pwa'/);
  assert.match(workflow, /group: seenit-runtime-control/);
  assert.match(workflow, /cancel-in-progress: false/);
});

test('le contrôle force uniquement Deploy Canonical Backend sur main', () => {
  assert.match(workflow, /actions: write/);
  assert.match(workflow, /actions\/workflows\/deploy-backend\.yml\/dispatches/);
  assert.match(workflow, /-f ref=main/);
  assert.match(workflow, /\.event == "workflow_dispatch" and \.head_sha == \$sha/);
  assert.match(workflow, /runtime-control-before-runs\.txt/);
  assert.doesNotMatch(workflow, /build-apk\.yml\/dispatches/);
  assert.doesNotMatch(workflow, /release_apk=true/);
});

test('le workflow canonique traite workflow_dispatch comme une reconstruction forcée', () => {
  assert.match(deployWorkflow, /workflow_dispatch:/);
  assert.match(deployWorkflow, /FORCE_BACKEND_DEPLOY: \$\{\{ github\.event_name == 'workflow_dispatch' \}\}/);
  assert.match(deployWorkflow, /Health-check candidate, promote, and verify production/);
});

test('la procédure documente la séparation PWA et APK', () => {
  assert.match(documentation, /\/deploy-pwa/);
  assert.match(documentation, /issue de contrôle runtime est \*\*#57\*\*/);
  assert.match(documentation, /ne publie aucune APK/);
  assert.match(documentation, /#102 avec `\/release-apk`/);
});
