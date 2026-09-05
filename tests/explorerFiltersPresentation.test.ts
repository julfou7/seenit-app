import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const filterSource = readFileSync(new URL('../src/components/FilterModal.tsx', import.meta.url), 'utf8');
const discoverSource = readFileSync(new URL('../src/screens/DiscoverScreen.tsx', import.meta.url), 'utf8');
const bottomNavSource = readFileSync(new URL('../src/components/BottomNav.tsx', import.meta.url), 'utf8');

test('Explorer place Top 100 dans le type de contenu et plus dans les tris', () => {
  assert.match(filterSource, /setActiveCategory\('Top 100'\)/);
  assert.match(filterSource, /<Trophy size=\{14\}\/> Top 100/);
  assert.match(discoverSource, /activeCategory === 'Top 100'/);
  const sortOptions = discoverSource.match(/const SORT_OPTIONS = \[([\s\S]*?)\n\];/);
  assert.ok(sortOptions, 'SORT_OPTIONS doit rester déclarée');
  assert.doesNotMatch(sortOptions[1], /top100|Top 100/i);
});

test('le panneau de filtres reste au-dessus de la navigation basse', () => {
  const filterZ = Number(filterSource.match(/z-\[(\d+)\]/)?.[1]);
  const navZ = Number(bottomNavSource.match(/z-\[(\d+)\]/)?.[1]);
  assert.ok(Number.isFinite(filterZ) && Number.isFinite(navZ), 'les deux couches doivent avoir un z-index explicite');
  assert.ok(filterZ > navZ, `FilterModal (z=${filterZ}) doit passer au-dessus de BottomNav (z=${navZ})`);
  assert.match(filterSource, /Afficher les résultats/);
  assert.match(filterSource, /safe-area-inset-bottom/);
});
