import test from 'node:test';
import assert from 'node:assert/strict';
import { getUpdateProgressPresentation } from '../src/features/release/updateProgress.ts';

test('SEENIT-UPDATE-004 conserve le succès après ouverture de l’installeur Android', () => {
  assert.deepEqual(getUpdateProgressPresentation({ status: 'done' }), {
    label: 'Installeur lancé',
    tone: 'success'
  });
  assert.deepEqual(getUpdateProgressPresentation({ status: 'error' }), {
    label: 'Erreur',
    tone: 'error'
  });
});
