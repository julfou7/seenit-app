import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const view = readFileSync('src/screens/ShowDetailView.tsx', 'utf8');

test('SEENIT-UX-019 #879 le menu ⋮ des fiches est ancré sous son bouton, sans feuille du bas', () => {
  const menu = view.slice(view.indexOf('{showMenu && <DialogLayer'), view.indexOf('</DialogLayer>}', view.indexOf('{showMenu && <DialogLayer')));
  assert.match(menu, /className="fixed inset-0 z-50 bg-black\/40" onClick=\{e => \{ if \(e\.target === e\.currentTarget\) setShowMenu\(false\); \}\}/, 'toucher à côté ferme le menu');
  assert.match(menu, /<div role="menu" aria-label=\{`Actions pour \$\{title\}`\} data-anchored-menu style=\{\{ right: 'max\(12px, calc\(\(100vw - 28rem\) \/ 2 \+ 12px\)\)' \}\} className="absolute top-\[calc\(var\(--seenit-safe-area-top,env\(safe-area-inset-top,0px\)\)\+58px\)\] w-\[290px\]/, 'aligné sur le bord de la fiche, sous le bouton');
  assert.doesNotMatch(menu, /rounded-t-\[24px\]|slide-in-from-bottom|items-end/, 'plus de feuille qui monte du bas');
  // Toutes les actions existantes restent, annoncées comme éléments de menu ; Téléchargement indique le mode et l'activité.
  assert.equal((menu.match(/role="menuitem"/g) || []).length, 8);
  for (const label of ['Partager la fiche', 'Synchroniser', 'Téléchargement', 'Abandonner la série', 'Supprimer la série']) assert.ok(menu.includes(label), label);
  assert.match(menu, /menuSub\(canUseFilmMode \? 'Mode téléchargement du film' : `Mode téléchargement\$\{activeDownloads \? ` · \$\{activeDownloads\} en cours` : ''\}`\)/);
  // Maquette DlFilm : sur un film, l'entrée du menu ouvre le mode téléchargement du film.
  assert.match(menu, /if \(canUseFilmMode\) \{ setFilmMode\(true\); return; \}/);
  assert.match(menu, /<span aria-hidden="true" className="mx-3\.5 my-1 h-px bg-white\/\[0\.07\]" \/>/, 'actions de cycle de vie séparées');
});
