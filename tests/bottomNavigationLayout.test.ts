import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { NAVIGATION_TABS } from '../src/features/navigation/tabPresentation.ts';
const nav = readFileSync('src/components/BottomNav.tsx', 'utf8');
const button = readFileSync('src/components/NavigationTabButton.tsx', 'utf8');
const css = readFileSync('src/components/bottomNav.css', 'utf8');
test('SEENIT-UX-017 conserve l’ordre À Voir Explorer Moi puis Télécharger optionnel', () => {
  assert.deepEqual(NAVIGATION_TABS.map(tab => tab.id), ['watchlist', 'discover', 'profile', 'downloads']);
  assert.equal(NAVIGATION_TABS[2].label, 'Moi');
  assert.match(nav, /NAVIGATION_TABS.filter\(tab => tab.id !== 'downloads'\)/);
  assert.match(nav, /aria-label="Navigation principale"/);
});
test('SEENIT-UX-017 réserve des cibles 52 par 68 dans un îlot de verre sans repli au scroll', () => {
  assert.match(button, /size=\{24\}/);
  assert.match(button, /aria-current=\{active \? 'page' : undefined\}/);
  assert.match(css, /min-height:52px;min-width:68px/);
  assert.match(css, /min-height:64px/);
  assert.match(css, /blur\(22px\) saturate\(170%\)/);
  assert.match(css, /96px/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(nav, /scrollY|addEventListener\('scroll'/);
});
