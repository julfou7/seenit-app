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

test('SEENIT-UX-018 Continuer suit le dernier visionnage et un Vu annulé rend la série à Nouveautés', () => {
  const harness = readFileSync('scripts/home-terrain224-browser-checks.cjs','utf8');
  for (const requirement of ['undo-after-transfer','last-watched-first']) assert.ok(harness.includes(requirement),requirement);
  const section = readFileSync('src/screens/WatchNextSection.tsx','utf8');
  // Depuis le 08/11 (SEENIT-UX-021) : dernière activité en tête — visionnage, ou sortie d'un nouvel épisode depuis celui-ci.
  assert.match(section,/continueWatchingKey\(show, watchTime\(show\), today, now\)/,'Continuer est trié par dernière activité : visionnage, ou nouvel épisode sorti depuis');
  assert.match(section,/hasSeenEpisodeKey\(/,'une arrivée dont l’épisode n’est plus vu quitte Continuer');
});
