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
