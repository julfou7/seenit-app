import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { forgetDialogEntry, markDialogEntryOrphaned, skipOrphanedDialogEntry } from '../src/features/navigation/dialogHistoryOrphans.ts';

/** Historique minimal : une pile d'états et un index, comme window.history. */
function fakeHistory(states: Array<Record<string, unknown>>) {
  let index = states.length - 1;
  return { get state() { return states[index]; }, get index() { return index; }, back() { index -= 1; } };
}

test('#640 l’entrée d’un aperçu fermé après navigation est sautée au Retour', () => {
  // Pile réelle : onglet, entrée de l'aperçu (flags du parent conservés), fiche poussée par onShowClick.
  const history = fakeHistory([{ tab: 'watchlist' }, { tab: 'watchlist', seenitDialog: ':preview:' }, { selectedShow: { id: 7 } }]);
  markDialogEntryOrphaned(':preview:'); // onClose : l'entrée n'est plus au sommet, elle ne peut pas être dépilée.
  history.back(); // Retour depuis la fiche.
  assert.equal(skipOrphanedDialogEntry(history.state, () => false, () => history.back()), true);
  assert.equal(history.index, 0, 'un seul Retour ramène à l’onglet');
  assert.equal(skipOrphanedDialogEntry(history.state, () => false, () => history.back()), false, 'l’onglet n’est jamais sauté');
});

test('#640 un dialogue encore monté, une entrée remplacée ou inconnue ne sont jamais sautés', () => {
  let backs = 0;
  const back = () => { backs += 1; };
  markDialogEntryOrphaned(':mounted:');
  assert.equal(skipOrphanedDialogEntry({ seenitDialog: ':mounted:' }, id => id === ':mounted:', back), false);
  markDialogEntryOrphaned(':replaced:');
  forgetDialogEntry(':replaced:');
  assert.equal(skipOrphanedDialogEntry({ seenitDialog: ':replaced:' }, () => false, back), false);
  assert.equal(skipOrphanedDialogEntry({ seenitDialog: ':inconnu:' }, () => false, back), false);
  assert.equal(skipOrphanedDialogEntry(null, () => false, back), false);
  // Depuis une personne : l'entrée orpheline porte les flags de la personne, le saut revient à la personne.
  const person = fakeHistory([{ isPersonDetailModal: true }, { isPersonDetailModal: true, seenitDialog: ':p:' }, { selectedShow: { id: 1 } }]);
  markDialogEntryOrphaned(':p:');
  person.back();
  skipOrphanedDialogEntry(person.state, () => false, () => person.back());
  assert.deepEqual(person.state, { isPersonDetailModal: true });
  assert.equal(skipOrphanedDialogEntry(person.state, () => false, () => person.back()), false, 'une entrée sautée est oubliée');
  assert.equal(backs, 0);
});

test('#640 DialogLayer marque l’entrée orpheline seulement si elle n’a pas quitté le sommet par un Retour', () => {
  const layer = readFileSync('src/components/ui/DialogLayer.tsx', 'utf8');
  assert.match(layer, /window\.addEventListener\('popstate', \(\) => \{\s*skipOrphanedDialogEntry\(window\.history\.state, id => surfaces\.has\(id\), \(\) => window\.history\.back\(\)\);/);
  assert.match(layer, /if \(window\.history\.state\?\.seenitDialog !== id\) leftByHistory = true;/);
  assert.match(layer, /else if \(historyMode === 'local' && !leftByHistory\) markDialogEntryOrphaned\(id\);/);
  assert.match(layer, /forgetDialogEntry\(previousState\.seenitDialog\);\s*window\.history\.replaceState\(state, ''\);/);
  const browser = readFileSync('scripts/dialog-browser-checks.cjs', 'utf8');
  assert.match(browser, /#640 un seul Retour depuis la fiche ouverte par l’aperçu/);
});
