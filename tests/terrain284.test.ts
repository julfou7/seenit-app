import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Retours terrain et décisions du 09/11 sur la v1.4.283.
const read = (path: string) => readFileSync(path, 'utf8');

test('SEENIT-DOWNLOAD-013 en-tête : le « g » de « Téléchargements » n’est plus coupé', () => {
  // `overflow:hidden` (points de suspension sur petit écran) coupait le jambage avec une interligne de 1.15.
  const rule = read('src/screens/downloads.css').split('\n').find(line => line.startsWith('.downloads-page h1 {')) || '';
  assert.match(rule, /overflow:hidden; text-overflow:ellipsis;/, 'les points de suspension restent');
  assert.match(rule, /padding-block:\.14em; margin-block:-\.14em;/, 'place verticale pour le tracé, mise en page inchangée');
});

test('SEENIT-DOWNLOAD-021 Téléchargés : la carte d’Explorer elle-même, avec « Retirer » à la place de « Ajouter »', () => {
  const card = read('src/components/GridMediaCard.tsx');
  assert.match(card, /\{action && \(\n\s+<button\n\s+type="button"\n\s+aria-label=\{action\.ariaLabel\}/, 'l’action remplace la barre sous l’affiche');
  assert.match(card, /\{!hideBadges && !action && \(/, 'jamais « Ajouter » en plus de l’action');
  assert.match(card, /const isAtCinema = !action && !isTv/, 'un titre déjà téléchargé n’est jamais « Au cinéma »');
  const rail = read('src/components/RecentImportsRail.tsx');
  assert.match(rail, /<ul className="grid grid-cols-3 sm:grid-cols-4 gap-x-1\.5 gap-y-4" aria-label="Téléchargés">/, 'même grille qu’Explorer');
  assert.match(rail, /<GridMediaCard media=\{importMedia\(item\)\} posterSrc=\{item\.posterUrl\}/);
  assert.match(rail, /action=\{\{ label: 'Retirer', ariaLabel: `Retirer \$\{item\.title\} de Téléchargés et de \$\{item\.kind === 'movie' \? 'Radarr' : 'Sonarr'\}`/);
  assert.match(rail, /if \(useArrSyncStore\.getState\(\)\.snapshot\?\.key !== arrSyncKey\(\)\) \{/, 'jamais un identifiant d’un autre compte ou serveur');
  assert.match(rail, /outcome === 'kept' \? 'Retiré de la liste · la suite reste programmée dans Sonarr' : `Retiré de \$\{item\.kind === 'movie' \? 'Radarr' : 'Sonarr'\} · fichiers gardés`/, 'un seul toast qui dit ce qui a été fait');
});
