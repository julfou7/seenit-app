import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const toastSource = readFileSync(
  new URL('../src/components/ToastContainer.tsx', import.meta.url),
  'utf8'
);

test('SEENIT-UX-004 #878 tous les toasts ont la même taille et coupent le texte au lieu de grandir', () => {
  // Une seule carte et deux gabarits : 76 px, ou 104 px pour un toast d'épisode (retour terrain du 07/11).
  // Hauteur minimale, jamais fixe (terrain 1.4.259) : une police agrandie fait grandir la carte, sans rogner.
  assert.match(toastSource, /const isEpisodeToast = Boolean\(episodeLabel\);/);
  assert.match(toastSource, /data-toast-card data-toast-size=\{isEpisodeToast \? 'episode' : 'standard'\} className=\{cn\('seenit-toast w-full relative overflow-hidden [^']*', isEpisodeToast \? 'min-h-\[104px\]' : 'min-h-\[76px\]'\)\}/);
  assert.doesNotMatch(toastSource, /'h-\[(76|104)px\]'|leading-\[18px\]|leading-\[20px\]/, 'ni hauteur de carte ni hauteur de ligne en pixels fixes');
  assert.doesNotMatch(toastSource, /sm:w-auto/);
  assert.doesNotMatch(toastSource, /sm:rounded-full/);
  // Titre sur deux lignes au plus, hauteurs de ligne relatives et blocs jamais écrasés ; détail sur une ligne.
  assert.match(toastSource, /shrink-0 text-\[15px\] leading-\[1\.2\] font-extrabold line-clamp-2 break-words/);
  assert.match(toastSource, /shrink-0 flex items-center gap-1\.5 min-w-0 text-\[13\.5px\] leading-\[1\.33\] font-semibold text-zinc-200/);
  assert.match(toastSource, /<span className="truncate">\{detail\}<\/span>/);
  // Épisode en pastille or « S01 | E03 », comme avant #878, plus de bandeau sur l'affiche.
  assert.match(toastSource, /\{episodeLabel && \(\s*<span data-toast-episode className="shrink-0 self-start my-0\.5 rounded-md bg-amber-500\/15/);
  assert.doesNotMatch(toastSource, /episodeBand/);
  // Bande gauche : affiche du média (68 px pour un épisode), sinon bande teintée de l'action.
  assert.match(toastSource, /cn\('shrink-0 relative bg-zinc-800 self-stretch', isEpisodeToast \? 'w-\[68px\]' : 'w-14'\)/);
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
