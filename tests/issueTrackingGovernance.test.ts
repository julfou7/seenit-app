import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('SEENIT-QUALITY-004 maintient les issues et leurs checkboxes à jour pendant le travail', () => {
  const agents = fs.readFileSync('AGENTS.md', 'utf8');
  const spec = fs.readFileSync('docs/specifications/seenit.md', 'utf8');
  assert.match(agents, /issue active.*mise à jour.*jalons utiles/is);
  assert.match(agents, /Cochez un critère.*réellement prouvé/is);
  assert.match(spec, /SEENIT-QUALITY-004/);
  assert.match(spec, /après chaque jalon/);
});
