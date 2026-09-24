import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extractCommitNotes } = require('../scripts/generate-release-notes.cjs') as {
  extractCommitNotes: (message: string) => string[];
};

test('SEENIT-RELEASE-003 conserve un bloc public après un premier Changelog vide dans un squash', () => {
  const notes = extractCommitNotes(`feat: corriger les téléchargements hors-ligne (#401)

Changelog: aucun

Détails techniques:
- prépare le commit squash

Changelog:
- Les téléchargements de films et séries fonctionnent à nouveau correctement pour la lecture hors-ligne.

Détails techniques:
- conserve les détails internes hors des notes publiques`);

  assert.deepEqual(notes, [
    '- Les téléchargements de films et séries fonctionnent à nouveau correctement pour la lecture hors-ligne.'
  ]);
});
