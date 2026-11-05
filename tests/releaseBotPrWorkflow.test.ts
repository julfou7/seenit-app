import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createCandidatePrWithPolicyHandoff } from '../scripts/prepare-release-control.cjs';

const workflow = readFileSync('.github/workflows/build-apk.yml', 'utf8');
test('SEENIT-RELEASE-005 conserve le check PR même pour les huit surfaces de version', () => {
  const pr = workflow.match(/  pull_request:\n([\s\S]*?)  schedule:/)?.[1];
  assert.ok(pr);
  assert.match(pr, /branches: \[ main, master \]/);
  assert.doesNotMatch(pr, /paths(?:-ignore)?:/);
  assert.doesNotMatch(workflow, /pull_request_target:/);
  assert.match(workflow, /name: Validate Change/);
});

test('SEENIT-RELEASE-005 délègue la création de PR au connecteur sans écriture bot', async () => {
  const result = await createCandidatePrWithPolicyHandoff();
  assert.deepEqual(result, { pr: null, prHandoff: true });
  assert.doesNotMatch(createCandidatePrWithPolicyHandoff.toString(), /request\(|dispatchCandidateValidation\(/);
});
