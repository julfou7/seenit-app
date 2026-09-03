import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatPlexCompletionSummary,
  formatPlexElapsed,
  formatPlexWaitingStatus
} from '../src/features/plex/plexSyncPresentation.ts';

test('SEENIT-UX-004 la synchronisation Plex affiche une phase réelle et la durée écoulée sans faux pourcentage', () => {
  assert.equal(formatPlexElapsed(12_400), '12 s');
  assert.equal(formatPlexElapsed(135_000), '2 min 15 s');
  assert.equal(formatPlexWaitingStatus(true, 12_400), 'Sync rapide Plex • état vu courant • 12 s');
  assert.equal(formatPlexWaitingStatus(false, 135_000), 'Scan complet Plex • inventaire des bibliothèques • 2 min 15 s');
});

test('SEENIT-UX-004 le bilan Plex affiche serveurs scannés, vus et non vus sans serveur ignoré', () => {
  const summary = formatPlexCompletionSummary(1, 10, 2);

  assert.equal(summary, 'Synchronisation Plex terminée • 1 serveur scanné • 10 vus • 2 non vus');
  assert.doesNotMatch(summary, /ignor/i);
  assert.doesNotMatch(summary, /dé-vu|non-vu/i);
});
