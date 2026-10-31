import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readFeatureSource } from './featureSource.ts';

const filterSource = readFileSync(new URL('../src/components/FilterModal.tsx', import.meta.url), 'utf8');
const discoverSource = readFeatureSource('discover');
const bottomNavSource = readFileSync(new URL('../src/components/BottomNav.tsx', import.meta.url), 'utf8');

test('SEENIT-DISCOVER-003 E-28 Top100 reste dans les catégories et quitte le panneau', () => {
 assert.doesNotMatch(filterSource, /handleCategoryChange|Type de contenu|Top 100/);
 assert.match(discoverSource, /id: "Top 100"/);
 assert.match(filterSource, /label: 'A → Z'/);
});

test('le panneau de filtres reste au-dessus de la navigation basse', () => {
  const filterZ = Number(readFileSync('src/screens/explorer.css', 'utf8').match(/explorer-filter-overlay\{[^}]*z-index:(\d+)/)?.[1]);
  const navZ = Number(readFileSync('src/components/bottomNav.css', 'utf8').match(/z-index:(\d+)/)?.[1]);
  assert.ok(Number.isFinite(filterZ) && Number.isFinite(navZ), 'les deux couches doivent avoir un z-index explicite');
  assert.ok(filterZ > navZ, `FilterModal (z=${filterZ}) doit passer au-dessus de BottomNav (z=${navZ})`);
  assert.match(filterSource, /Afficher les résultats/);
  assert.match(readFileSync('src/screens/explorer.css', 'utf8'), /safe-area-inset-bottom/);
});
