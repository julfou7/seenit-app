import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const specification = readFileSync(new URL('../docs/specifications/seenit.md', import.meta.url), 'utf8');
const functionalReference = readFileSync(new URL('../docs/specifications/functional-reference.md', import.meta.url), 'utf8');
const requirements = JSON.parse(readFileSync(new URL('../docs/specifications/requirements.json', import.meta.url), 'utf8'));
const registry = readFileSync(new URL('../docs/requests/registry.md', import.meta.url), 'utf8');
const decision = readFileSync(new URL('../docs/decisions/media-relations-2026-09-06.md', import.meta.url), 'utf8');
const agentInstructions = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');

test('SEENIT-RELATION-001 limite les fiches aux relations utiles', () => {
  assert.match(specification, /Film[^\n]*Ordre de visionnage[\s\S]*Franchise \/ univers/);
  assert.match(specification, /Série[^\n]*Franchise \/ univers/);
  assert.match(specification, /Films similaires[\s\S]*Séries similaires[\s\S]*supprim/);
  assert.match(functionalReference, /### 8\.4 Ordre de visionnage et franchise \/ univers/);
  assert.match(decision, /Une fiche média sert à répondre[\s\S]*réellement lié/);
});

test('SEENIT-RELATION-001 réserve l’ordre de visionnage aux collections TMDB', () => {
  assert.match(specification, /Ordre de visionnage[\s\S]*exclusivement[\s\S]*collection TMDB/);
  assert.match(specification, /Aucune série n'est ajoutée dans cette section/);
  assert.match(functionalReference, /Pour un film, « Ordre de visionnage » provient exclusivement de sa collection TMDB explicite/);
  assert.match(decision, /Aucun catalogue SeenIt, TVDB, Wikidata ou rapprochement par titre ne complète une collection TMDB manquante/);
});

test('SEENIT-RELATION-001 résout TVDB sans recherche par titre ni fusion de listes', () => {
  assert.match(specification, /TVDB devient la source normale[\s\S]*films comme[\s\S]*séries/);
  assert.match(specification, /aucune recherche du média par titre/);
  assert.match(specification, /aucune recherche globale de listes/);
  assert.match(specification, /au maximum une liste officielle/);
  assert.match(specification, /plus aucune fusion de plusieurs listes/);
  assert.match(specification, /libellé d'une liste[\s\S]*uniquement[\s\S]*qualifier sa nature/);
  assert.match(agentInstructions, /Le libellé d'une liste TVDB déjà atteinte depuis l'identité exacte/);
});

test('SEENIT-RELATION-001 déduplique la franchise après la saga', () => {
  assert.match(specification, /priorité[\s\S]*Ordre de visionnage[\s\S]*Franchise \/ univers/);
  assert.match(specification, /dédupliqu(?:é|ée)[\s\S]*mediaType \+ tmdbId/);
  assert.match(functionalReference, /Un média déjà présent dans l'Ordre de visionnage est retiré de la section TVDB/);
  assert.match(decision, /ne répète pas ces films/);
});

test('SEENIT-RELATION-001 retire les similaires des fiches et garde la découverte dans Explorer', () => {
  assert.match(specification, /Les sections « Films similaires » et « Séries similaires » sont supprimées des fiches/);
  assert.match(specification, /Explorer[\s\S]*découverte/);
  assert.match(functionalReference, /Les recommandations contextuelles restent dans Explorer/);
  assert.match(decision, /recommendations[\s\S]*similar[\s\S]*ne sont plus utilisés pour remplir le bas d'une fiche/);
});

test('SEENIT-RELATION-001 trace la décision durable et l’écart runtime', () => {
  assert.match(registry, /USR-2026-09-05-002[\s\S]*superseded/);
  assert.match(registry, /USR-2026-09-06-005[\s\S]*superseded/);
  assert.match(registry, /USR-2026-09-06-008[\s\S]*SEENIT-RELATION-001[\s\S]*active/);
  assert.match(functionalReference, /runtime actuel conserve encore le catalogue relationnel SeenIt/);
  assert.match(functionalReference, /issue #130/);
  assert.match(decision, /issue #130 reste donc \*\*ouverte\*\*/);

  const requirement = requirements.requirements.find((entry: { id: string }) => entry.id === 'SEENIT-RELATION-001');
  assert.ok(requirement, 'SEENIT-RELATION-001 doit rester déclarée dans requirements.json');
  assert.equal(requirement.tests.length, 6);
  assert.ok(requirement.tests.every((expected: { file: string }) => expected.file === 'tests/mediaRelationsSpecification.test.ts'));
});
