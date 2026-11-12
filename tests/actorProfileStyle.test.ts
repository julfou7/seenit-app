import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('SEENIT-UX-019 fiche acteur : barre de navigation visible, cartes et filtres habituels', () => {
  const profile = read('src/components/MovieActorProfile.tsx');
  const css = read('src/components/movieActorProfile.css');
  const nav = read('src/components/bottomNav.css');
  // Couche non bloquante sous la barre (z-index 160), au-dessus de la fiche média (150) ; un changement d'onglet la ferme.
  assert.match(profile, /blocking=\{false\} data-media-layer="" className="actor-profile-overlay"/);
  // Retour v1.4.297 : la barre n'est masquée que par une couche sans data-media-layer (bottomNav.css).
  assert.match(nav, /body:has\(\[data-dialog-layer\]:not\(\[data-settings-layer\]\):not\(\[data-media-layer\]\)\) \.bottom-nav-shell\{display:none\}/);
  // Les titres de section sont grands, le titre d'une carte (h3) garde la taille d'Explorer.
  assert.match(css, /\.actor-profile section > h3 \{ font-size:18px;/);
  assert.doesNotMatch(css, /\.actor-profile h3 \{/);
  assert.match(css, /\.actor-profile-overlay \{ z-index:155; \}/);
  assert.match(nav, /\.bottom-nav-shell\{[^}]*z-index:160/);
  assert.match(profile, /window\.addEventListener\('app-close-modals', close\)/);
  // Plus l'ancien glyphe Vu : la carte habituelle porte l'état Vu actuel.
  assert.doesNotMatch(profile, /SeenGlyph/);
  assert.equal((profile.match(/<GridMediaCard media=\{toMedia\(credit\)\}/g) || []).length, 2);
  // Filtres au style des pastilles de l'accueil, « Non vus » compris.
  assert.match(profile, /aria-pressed=\{onlyUnseen\}/);
  assert.doesNotMatch(profile, /type="checkbox"/);
  assert.match(css, /\.actor-profile__tabs button\[aria-pressed=true\] \{ background:#e5a93d; color:#000;/);
  assert.match(read('src/screens/watchListHome.css'), /\.home-movie-sort button\[aria-pressed="true"\] \{ background:#e5a93d; color:#000;/);
});
