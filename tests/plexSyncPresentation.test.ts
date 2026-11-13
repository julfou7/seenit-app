import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  canPausePlexSync,
  isPlexSyncTerminal,
  formatPlexCompletionSummary,
  formatPlexElapsed,
  formatPlexWaitingStatus
} from '../src/features/plex/plexSyncPresentation.ts';
import { formatPlexSyncResult } from '../src/features/plex/plexSyncProgressModel.ts';

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

test('SEENIT-UX-004 le panneau de synchro dit l’état de chaque source et un seul résultat pour SeenIt', () => {
  // 13/11 : « 33 vus · 15 en bibliothèque », « 83 vus · 7,7 k en bibliothèque », « 76 visionnages · 2 non vus » —
  // des lectures et des états de sources différentes, impossibles à comparer, et un « non vus » sans aucune action.
  const panel = readFileSync('src/components/HomeSyncIndicator.tsx', 'utf8');
  assert.match(panel, /<strong>Historique du compte<\/strong><span>\{progress\.account\.dated === false \? 'ok · sans heure' : 'ok'\}<\/span>/);
  assert.doesNotMatch(panel, /account\.unwatched|visionnages|en bibliothèque/);
  assert.match(panel, /data-tone=\{progress\.unresolved \? 'error' : 'ok'\}>\{formatPlexSyncResult\(progress\)\}/);
  assert.equal(formatPlexSyncResult({ changed: 0, dated: 0, unresolved: 0 }), '0 changement · 0 Vu daté · 0 erreur');
  assert.equal(formatPlexSyncResult({ changed: 3, dated: 264, unresolved: 2 }), '3 changements · 264 Vus datés · 2 erreurs');
  assert.equal(formatPlexSyncResult({}), '0 changement · 0 Vu daté · 0 erreur');
});
