import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
test('SEENIT-DISCOVER-003 E-03 recherche collante à toute profondeur, sans geste invisible', () => {
  const view = read('src/screens/DiscoverViewCore.tsx'), css = read('src/screens/explorer.css');
  assert.match(view, /aria-label="Rechercher" onClick=\{enterSearch\}/);
  assert.match(css, /\.explorer-controls\{position:sticky;top:0/);
  assert.doesNotMatch(view, /onTouchMove|Remonter tout en haut|data-navigation-search-shortcut/);
});
test('SEENIT-DISCOVER-003 E-07 navigation commune et mode recherche explicite', () => {
  assert.doesNotMatch(read('src/components/BottomNav.tsx'), /bottom-nav-search|shell--search/);
  assert.match(read('src/components/bottomNav.css'), /data-app-tab=discover.*data-discover-search-mode=true/);
  assert.match(read('src/screens/DiscoverScreen.tsx'), /explorerScroll\.current = containerRef\.current\?\.scrollTop/);
});
test('SEENIT-UX-019 #870 une fiche média ouverte depuis la recherche d’Explorer garde la barre de navigation', () => {
  const css = read('src/components/bottomNav.css');
  // Le dock de recherche ne masque la barre que tant qu'aucune fiche média n'est ouverte par-dessus.
  assert.match(css, /body:has\(\[data-app-tab=discover\]:not\(\[aria-hidden=true\]\) \[data-discover-search-mode=true\]\):not\(:has\(\[data-media-layer\]\)\) \.bottom-nav-shell\{display:none\}/);
  assert.match(read('src/App.tsx'), /data-app-tab="discover"[\s\S]{0,160}aria-hidden=\{currentTab !== 'discover'\}/, 'l’onglet Explorer reste actif sous la fiche : la règle doit exclure la fiche');
  // Vérification réelle du rendu : scripts/navbar-browser-checks.cjs (recherche → fiche → retour).
  assert.match(read('scripts/navbar-browser-checks.cjs'), /#870 fiche ouverte depuis la recherche avec la barre/);
});
test('SEENIT-DISCOVER-008 recherche posée sur l’image à la une, une seule loupe visible à la fois', () => {
  const view = read('src/screens/DiscoverViewCore.tsx'), hero = read('src/screens/DiscoverHero.tsx'), css = read('src/screens/explorer.css');
  assert.match(view, /className="explorer-hero-search" aria-label="Rechercher" onClick=\{enterSearch\}><Search size=\{20\} aria-hidden="true" \/><span>Rechercher un film, une série…<\/span>/);
  assert.match(view, /\{!heroSearchVisible && <button type="button" className="explorer-control-search" aria-label="Rechercher" onClick=\{enterSearch\}>/);
  assert.match(view, /new IntersectionObserver\(\(\[entry\]\) => setHeroSearchVisible\(entry\.isIntersecting\), \{ root: containerRef\.current, threshold: 0 \}\)/);
  assert.match(css, /\.explorer-hero-search\{position:absolute;z-index:30;left:16px;right:16px;top:14px;height:48px/);
  assert.doesNotMatch(hero, /rounded-bl-\[24px\]/, 'le rang ne masque plus le coin du champ');
  assert.match(hero, /className="explorer-hero-rank ml-auto" aria-label=\{`Rang \$\{rank\}`\}>#\{rank\}/);
});
