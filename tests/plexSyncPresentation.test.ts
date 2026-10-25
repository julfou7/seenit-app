import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canPausePlexSync,
  isPlexSyncTerminal,
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


test('SEENIT-UX-018 aucun bouton pause sur un bilan Plex incomplet ou une synchronisation terminée', () => {
 assert.equal(isPlexSyncTerminal('error','Synchronisation Plex incomplète — nouvel essai requis'),true);
 assert.equal(canPausePlexSync({progress:{uid:'a',phase:'error'}},'a'),false);
 assert.equal(canPausePlexSync(null,'a'),false,'un bilan conservé sans tâche active ne peut pas bloquer la prochaine synchronisation');
 assert.equal(canPausePlexSync({progress:{uid:'a',phase:'watched'}},'a'),true);
 assert.equal(canPausePlexSync({progress:{uid:'b',phase:'watched'}},'a'),false);
});
