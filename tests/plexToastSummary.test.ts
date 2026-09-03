import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('SEENIT-UX-004 le bilan final Plex utilise un bloc multi-lignes avec identité Plex', () => {
  const toastStoreSource = fs.readFileSync(new URL('../src/store/toastStore.ts', import.meta.url), 'utf8');
  const toastSource = fs.readFileSync(new URL('../src/components/ToastContainer.tsx', import.meta.url), 'utf8');

  assert.match(toastStoreSource, /title:\s*'PLEX • Synchronisation terminée'/);
  assert.match(toastStoreSource, /action:\s*details/);
  assert.match(toastStoreSource, /scope:\s*isCompletion \? undefined : inferredScope/);
  assert.match(toastSource, /flex flex-col justify-center min-w-0/);
  assert.match(toastSource, /parsed\.title/);
  assert.match(toastSource, /parsed\.action/);
});
