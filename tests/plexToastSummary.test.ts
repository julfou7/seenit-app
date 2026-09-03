import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('SEENIT-UX-004 le bilan final Plex utilise un bloc multi-lignes avec identité Plex', () => {
  const source = fs.readFileSync(new URL('../src/components/ToastContainer.tsx', import.meta.url), 'utf8');

  assert.match(source, /isPlexCompletionToast/);
  assert.match(source, /Synchronisation Plex terminée/);
  assert.match(source, />PLEX</);
  assert.match(source, /plexCompletionSummary\.servers/);
  assert.match(source, /plexCompletionSummary\.watched/);
  assert.match(source, /plexCompletionSummary\.unwatched/);
  assert.match(source, /flex-col/);
});
