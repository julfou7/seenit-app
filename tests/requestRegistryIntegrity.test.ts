import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('issue #619 garantit des identifiants de demandes durables uniques', () => {
  const registry = readFileSync('docs/requests/registry.md', 'utf8');
  const ids = Array.from(
    registry.matchAll(/^\|\s*(USR-\d{4}-\d{2}-\d{2}-\d{3})\s*\|/gm),
    match => match[1],
  );
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);

  assert.ok(ids.length > 0, 'le registre doit contenir des identifiants USR structurés');
  assert.deepEqual(
    Array.from(new Set(duplicates)),
    [],
    'chaque identifiant USR du registre doit être unique',
  );
});
