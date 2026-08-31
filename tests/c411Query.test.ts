import assert from 'node:assert/strict';
import test from 'node:test';
import { buildC411SearchParams } from '../src/features/downloads/c411Query.ts';

test('le filtre C411 Tous ne devient jamais Film implicitement', () => {
  const params = buildC411SearchParams('Severance');
  assert.equal(params.get('subcategory'), null);
});

test('les filtres C411 Film et Série utilisent leurs sous-catégories exactes', () => {
  assert.equal(buildC411SearchParams('Dune', 'movie').get('subcategory'), '6');
  assert.equal(buildC411SearchParams('Severance', 'tv').get('subcategory'), '7');
});

test('l’année C411 est utilisée une seule fois dans la recherche', () => {
  assert.equal(buildC411SearchParams('Dune', 'movie', '2021').get('name'), 'Dune 2021');
  assert.equal(buildC411SearchParams('Dune 2021', 'movie', '2021').get('name'), 'Dune 2021');
});
