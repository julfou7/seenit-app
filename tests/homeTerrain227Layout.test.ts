import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/screens/watchListHome.css', import.meta.url), 'utf8');
const terrain227Harness = readFileSync(new URL('../scripts/home-terrain227-browser-checks.cjs', import.meta.url), 'utf8');

test('terrain227 conserve le haut des affiches inclinées sous les titres', () => {
  assert.match(css, /\.home-series-rail\s*\{[^}]*margin-top:2px;[^}]*padding-block:4px 0;/);
  assert.match(terrain227Harness, /posters\.some\(p=>p\.top<p\.clip-\.5\)/);
});

test('terrain227 garde Afficher plus proche des cartes et espace la section suivante', () => {
  assert.match(css, /\.home-load-more\s*\{[^}]*margin:12px 0 28px;/);
  assert.match(css, /\.home-movie-list:has\(\+ \.home-load-more\)\s*\{\s*margin-bottom:12px;\s*\}/);
  assert.match(terrain227Harness, /spacing\.above<8\|\|spacing\.above>16\|\|spacing\.below<24\|\|spacing\.below>32\|\|spacing\.below<=spacing\.above/);
});
