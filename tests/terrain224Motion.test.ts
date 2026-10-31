import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { waitForWatchFeedback } from '../src/features/watchlist/watchFeedback.ts';

test('SEENIT-UX-009 terrain224 annule une transaction visuelle démontée sans bloquer son appelant', async () => {
  const controller = new AbortController();
  const pending = waitForWatchFeedback(10_000, controller.signal);
  controller.abort();
  assert.equal(await pending, false);
  assert.equal(await waitForWatchFeedback(0, controller.signal), false);
  assert.equal(await waitForWatchFeedback(0, new AbortController().signal), true);
});

test('SEENIT-UX-014 terrain224 exécute le vrai shell et les transitions dans le smoke navigateur', () => {
  const smoke = readFileSync('scripts/pwa-browser-smoke.cjs','utf8');
  assert.match(smoke,/\['homeTerrain224', client => testTerrain224Harness\(client, root\)\]/);
  const harness = readFileSync('scripts/home-terrain224-browser-checks.cjs','utf8');
  for (const requirement of ['slow-save','button-first','stamp-before-name','last-available','undo','refresh','bottom-band','ticket-action','splash-complete','reduced-motion']) assert.ok(harness.includes(requirement),requirement);
});
