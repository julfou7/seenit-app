import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { RELEASE_VERSION_FILES } from '../scripts/prepare-release.cjs';

const workflow = readFileSync('.github/workflows/build-apk.yml', 'utf8');
const controller = readFileSync('scripts/prepare-release-control.cjs', 'utf8');
const runbook = readFileSync('docs/process/ci-validation-fast-paths.md', 'utf8');

function releasePathsIgnoredByPullRequest() {
  const match = workflow.match(/  pull_request:\n([\s\S]*?)  schedule:/);
  assert.ok(match, 'bloc pull_request introuvable dans build-apk.yml');
  return [...match[1].matchAll(/^      - '([^']+)'$/gm)].map(entry => entry[1]);
}

test('#102 la CI pull_request ignore exactement les huit surfaces release-only', () => {
  const ignored = releasePathsIgnoredByPullRequest();
  assert.deepEqual([...ignored].sort(), [...RELEASE_VERSION_FILES].sort());
  assert.equal(new Set(ignored).size, RELEASE_VERSION_FILES.length);
});

test('#102 le garde release-only conserve la validation explicite du SHA candidat', () => {
  assert.match(controller, /VALIDATION_WORKFLOW\s*=\s*'build-apk\.yml'/);
  assert.match(controller, /release_apk:\s*false/);
  assert.match(controller, /android12_smoke:\s*false/);
  assert.match(controller, /head_sha/);
  assert.match(controller, /workflow_dispatch/);
});

test('#102 aucune alternative pull_request_target ni affaiblissement du check requis', () => {
  assert.doesNotMatch(workflow, /pull_request_target:/);
  assert.match(workflow, /name: Validate Change/);
  assert.match(runbook, /PR bot #833/);
  assert.match(runbook, /41224969341/);
  assert.match(runbook, /41224967652/);
  assert.match(runbook, /aucune validation n'est supprimée/);
});
