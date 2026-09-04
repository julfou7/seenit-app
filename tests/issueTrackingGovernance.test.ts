import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('SEENIT-QUALITY-004 maintient les issues et leurs checkboxes à jour pendant le travail', () => {
  const agents = fs.readFileSync('AGENTS.md', 'utf8');
  const spec = fs.readFileSync('docs/specifications/seenit.md', 'utf8');
  assert.match(agents, /issue active.*mise à jour.*jalons utiles/is);
  assert.match(agents, /Cochez un critère.*réellement prouvé/is);
  assert.match(spec, /SEENIT-QUALITY-004/);
  assert.match(spec, /jalons significatifs[\s\S]*critère.*réellement satisfait/i);
});

test('SEENIT-QUALITY-004 impose le contexte GitHub complet avant toute intervention', () => {
  const agents = fs.readFileSync('AGENTS.md', 'utf8');
  const bootstrap = fs.readFileSync('.agents/AGENTS.md', 'utf8');
  const spec = fs.readFileSync('docs/specifications/seenit.md', 'utf8');

  assert.match(agents, /Avant toute analyse, proposition ou modification/i);
  assert.match(agents, /branche GitHub `main`[\s\S]*source de vérité/i);
  assert.match(agents, /issues GitHub \*\*ouvertes et fermées liées au sujet\*\*/i);
  assert.match(agents, /Réutiliser ou rouvrir l'issue pertinente[\s\S]*éviter les doublons/i);

  assert.match(bootstrap, /branche GitHub `main`[\s\S]*canonique/i);
  assert.match(bootstrap, /issues GitHub \*\*ouvertes et fermées liées au sujet\*\*/i);
  assert.match(bootstrap, /réutiliser ou rouvrir l'issue adéquate[\s\S]*éviter les doublons/i);

  assert.match(spec, /SEENIT-QUALITY-004[\s\S]*issues GitHub ouvertes et fermées liées au sujet/i);
});
