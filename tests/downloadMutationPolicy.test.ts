import assert from 'node:assert/strict';
import test from 'node:test';
import { executeDownloadMutationOnce } from '../src/features/downloads/downloadMutationPolicy.ts';

test('un timeout de mutation Android ne déclenche jamais un second POST', async () => {
  let attempts = 0;
  await assert.rejects(() => executeDownloadMutationOnce(async () => {
    attempts += 1;
    throw new Error('timeout après traitement distant');
  }), /timeout/);
  assert.equal(attempts, 1);
});
