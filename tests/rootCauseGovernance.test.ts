import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const agents = read('../AGENTS.md');
const specification = read('../docs/specifications/seenit.md');
const delivery = read('../docs/process/delivery.md');
const issueTemplate = read('../.github/ISSUE_TEMPLATE/engineering.yml');
const pullRequestTemplate = read('../.github/pull_request_template.md');
const registry = read('../docs/requests/registry.md');

test('SEENIT-QUALITY-010 impose la cause racine et la classe affectée avant le correctif', () => {
  assert.match(agents, /cause racine avant correctif/);
  assert.match(agents, /classe complète affectée/);
  assert.match(specification, /un exemple reproductible reste un symptôme/);
  assert.match(delivery, /Un exemple reproductible prouve un symptôme, pas la portée du correctif/);
  assert.match(issueTemplate, /Symptôme, cause racine et classe affectée/);
  assert.match(pullRequestTemplate, /## Cause racine et portée/);
});

test('SEENIT-QUALITY-010 ne laisse pas une correction locale clore une cause systémique', () => {
  assert.match(agents, /correction locale[\s\S]*ne ferme pas l'issue[\s\n]+systémique/);
  assert.match(specification, /correction locale[^:]*:[\s\S]*ne ferme pas l'issue systémique/);
  assert.match(delivery, /correction de donnée[\s\S]*locale[\s\S]*ne ferme jamais à elle seule une[\s\n]+issue systémique/);
  assert.match(pullRequestTemplate, /correction locale de donnée ou de manifeste/);
  assert.match(registry, /USR-2026-09-06-004[\s\S]*SEENIT-QUALITY-010/);
});

test('SEENIT-QUALITY-010 exige une preuve générique sans alourdir les tâches sans anomalie', () => {
  assert.match(agents, /cas signalé devient un TNR[\s\S]*invariant générique/);
  assert.match(specification, /invariant générique[\s\S]*voisin ou contre-exemple/);
  assert.match(delivery, /Documentation,[\s\n]+copie d'interface et maintenance sans anomalie peuvent répondre « sans objet »/);
  assert.match(pullRequestTemplate, /TNR du cas signalé, l'invariant générique et le cas voisin\/négatif/);
});
