import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const toastSource = readFileSync(
  new URL('../src/components/ToastContainer.tsx', import.meta.url),
  'utf8'
);

test('SEENIT-UX-004 #878 tous les toasts ont la même taille et coupent le texte au lieu de grandir', () => {
  // Une seule carte, hauteur fixe, quel que soit le message (plus de pilule ni de carte qui grandit).
  assert.match(toastSource, /data-toast-card className="seenit-toast w-full relative overflow-hidden h-\[76px\]/);
  assert.doesNotMatch(toastSource, /sm:w-auto/);
  assert.doesNotMatch(toastSource, /sm:rounded-full/);
  // Titre sur deux lignes au plus, détail sur une ligne.
  assert.match(toastSource, /text-\[15px\] leading-tight font-extrabold line-clamp-2 break-words/);
  assert.match(toastSource, /<span className="truncate">\{detail\}<\/span>/);
  // Bande gauche de 56 px : affiche du média, sinon bande teintée de l'action.
  assert.match(toastSource, /w-14 shrink-0 relative bg-zinc-800 self-stretch/);
  assert.match(toastSource, /w-14 shrink-0 grid place-items-center self-stretch', getBandClass\(\)/);
  // Titre média en or, couleur d'action jamais sur le titre ; un seul bouton de 104 px.
  assert.match(toastSource, /isMediaTitle \? 'text-\[#F2C36B\]' : 'text-zinc-100'/);
  assert.equal((toastSource.match(/w-\[104px\] h-11/g) || []).length, 2);
  assert.match(toastSource, /\{hasUndoAction \? \(/, 'Annuler prime sur Ignorer les suivants');
});

test('SEENIT-UX-004 le toast reste au-dessus de la navigation et de la safe area', () => {
  assert.match(
    toastSource,
    /bottom-\[calc\(5\.5rem\+env\(safe-area-inset-bottom,0px\)\)\]/
  );
});

test('SEENIT-UX-004 #878 la notification retirée transmet son média au toast, sans le rendre navigable', () => {
  const notifications = readFileSync(new URL('../src/components/HomeNotifications.tsx', import.meta.url), 'utf8');
  assert.match(notifications, /showToast\('Notification retirée', 'info', notice\.show, \(\) => \{/);
  const navigation = readFileSync(new URL('../src/features/toasts/toastNavigation.ts', import.meta.url), 'utf8');
  assert.match(navigation, /new Set<ToastItem\['type'\]>\(\['follow', 'success'\]\)/, 'un toast info reste non navigable');
});
