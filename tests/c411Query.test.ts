import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildC411SearchParams } from '../src/features/downloads/c411Query.ts';

test('le filtre C411 Tous ne devient jamais Film implicitement', () => {
  const params = buildC411SearchParams('Severance');
  assert.equal(params.get('subcat'), null);
  assert.equal(params.get('viewMode'), 'flat');
  assert.equal(params.get('page'), '1');
  assert.equal(params.get('perPage'), '100');
});

test('les filtres C411 Film et Série utilisent leurs sous-catégories exactes', () => {
  assert.equal(buildC411SearchParams('Dune', 'movie').get('subcat'), '6');
  assert.equal(buildC411SearchParams('Severance', 'tv').get('subcat'), '7');
});

test('l’année C411 est utilisée une seule fois dans la recherche', () => {
  assert.equal(buildC411SearchParams('Dune', 'movie', '2021').get('name'), 'Dune 2021');
  assert.equal(buildC411SearchParams('Dune 2021', 'movie', '2021').get('name'), 'Dune 2021');
});


test('la route serveur C411 envoie le contexte attendu au tracker', () => {
  const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  assert.match(server, /'Referer':\s*'https:\/\/c411\.org\/torrents'/);
  assert.match(server, /page=1&perPage=100&viewMode=flat/);
});
