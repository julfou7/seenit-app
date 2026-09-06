import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const specification = readFileSync(new URL('../docs/specifications/seenit.md', import.meta.url), 'utf8');
const functionalReference = readFileSync(new URL('../docs/specifications/functional-reference.md', import.meta.url), 'utf8');
const requirements = JSON.parse(readFileSync(new URL('../docs/specifications/requirements.json', import.meta.url), 'utf8'));
const audit = readFileSync(new URL('../docs/audits/audit-media-relations-2026-09-05.md', import.meta.url), 'utf8');
const registry = readFileSync(new URL('../docs/requests/registry.md', import.meta.url), 'utf8');
const agentInstructions = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');

test('SEENIT-RELATION-001 sépare saga univers et médias similaires', () => {
  assert.match(specification, /Ordre de visionnage \/ saga/);
  assert.match(specification, /Même univers narratif/);
  assert.match(specification, /Similaires[^\n]*recommandations contextuelles TMDB/);
  assert.match(specification, /saga\/ordre de visionnage, puis même univers, puis similaires/);
  assert.match(functionalReference, /### 8\.4 Sagas, univers cross-media et médias similaires/);
});

test('SEENIT-RELATION-001 interdit tout univers déduit du titre ou de la popularité', () => {
  assert.match(specification, /Le titre, l'année, la popularité[\s\S]*ne prouvent \*\*jamais\*\* une relation/);
  assert.match(specification, /aucun fallback par titre/);
  assert.match(specification, /Une liste dite officielle, son nom ou son score ne suffisent jamais/);
  assert.match(specification, /cas nommé[\s\S]*scénario[\s\S]*TNR et jamais une condition de production/);
  assert.match(functionalReference, /titre cité dans un bug sert uniquement d'exemple de test/);
  assert.match(agentInstructions, /Relations médias : aucune rustine nominative/);
  assert.match(agentInstructions, /aucun code spécial ne porte le nom du cas corrigé/);
});

test('SEENIT-RELATION-001 impose une identité mediaType plus TMDB et des groupes bidirectionnels', () => {
  assert.match(specification, /couple mediaType \+ tmdbId/);
  assert.match(specification, /movie:42 et[\s\S]*tv:42 ne sont jamais fusionnés/);
  assert.match(specification, /chaque point d'entrée retourne le même ensemble et le même ordre/);
  assert.match(functionalReference, /Les sagas[\s\S]*univers sont bidirectionnels/);
});

test('SEENIT-RELATION-001 fixe les TNR Yellowstone Breaking Bad Harry Potter Marvel DC et House of Guinness', () => {
  for (const fixture of ['Yellowstone', 'Breaking Bad', 'Harry Potter', 'Marvel', 'DC', 'House of Guinness']) {
    assert.match(audit, new RegExp(fixture));
    assert.match(specification, new RegExp(fixture));
  }
  assert.match(audit, /Better Call Saul \| \*\*42 membres\*\*/);
  assert.match(audit, /aucune section si elle ne contiendrait que soi/);
});

test('SEENIT-RELATION-001 borne les sources distantes et les performances', () => {
  assert.match(specification, /Cache normalisé par mediaKey et groupId/);
  assert.match(specification, /cache chaud inférieur ou égal à 150 ms/);
  assert.match(specification, /résolution[\s\n]+froide ciblée à 2,5 s/);
  assert.match(specification, /timeout dur à 4 s/);
  assert.match(audit, /Wikidata[\s\S]*hors ligne/);
  assert.match(audit, /#12/);
});

test('SEENIT-RELATION-001 impose un catalogue généré et une revue des candidats hors ligne', () => {
  assert.match(specification, /catalogue éditorial séparé du code/);
  assert.match(specification, /générateur déterministe/);
  assert.match(specification, /pending-review/);
  assert.match(specification, /ne publie[\s\n]+rien directement/);
  assert.match(functionalReference, /génère un snapshot identique dans la[\s\S]*PWA et l'APK/);
  assert.match(registry, /USR-2026-09-06-005/);
});

test('SEENIT-RELATION-001 reste reliée au registre et au manifeste de tests', () => {
  assert.match(registry, /USR-2026-09-05-002/);
  assert.match(registry, /SEENIT-RELATION-001/);
  assert.match(registry, /issue #130/);
  const requirement = requirements.requirements.find((entry: { id: string }) => entry.id === 'SEENIT-RELATION-001');
  assert.ok(requirement, 'SEENIT-RELATION-001 doit rester déclarée dans requirements.json');
  assert.equal(requirement.tests.length, 9);
  assert.ok(requirement.tests.some((expected: { file: string }) => expected.file === 'tests/mediaRelationsSpecification.test.ts'));
  assert.ok(requirement.tests.some((expected: { file: string }) => expected.file === 'tests/mediaRelationsCatalog.test.ts'));
});
