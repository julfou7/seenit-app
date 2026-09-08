import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const agentRules = readFileSync('AGENTS.md', 'utf8');
const bootstrapRules = readFileSync('.agents/AGENTS.md', 'utf8');

test('le rapport final SeenIt trace les difficultés réelles pour l’amélioration continue', () => {
  assert.match(agentRules, /Difficultés rencontrées \/ amélioration continue/);
  assert.match(agentRules, /Ne jamais inventer de difficulté/);
  assert.match(agentRules, /Aucune difficulté notable/);
  assert.match(bootstrapRules, /Difficultés rencontrées \/ amélioration continue/);
  assert.match(bootstrapRules, /Ne jamais inventer une difficulté/);
  assert.match(bootstrapRules, /Aucune difficulté notable/);
});
