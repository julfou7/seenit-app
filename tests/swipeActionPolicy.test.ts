import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeSwipeKeyboardActions,
  resolveSwipeKeyboardAction
} from '../src/features/ui/swipeActionPolicy.ts';

test('SEENIT-UX-001 expose chaque direction de swipe au clavier', () => {
  assert.equal(resolveSwipeKeyboardAction('ArrowLeft', true, true), 'left');
  assert.equal(resolveSwipeKeyboardAction('ArrowRight', true, true), 'right');
  assert.equal(resolveSwipeKeyboardAction('ArrowLeft', false, true), null);
  assert.equal(resolveSwipeKeyboardAction('Enter', true, true), null);
});

test('SEENIT-UX-001 associe Suppr à l’action destructive disponible', () => {
  assert.equal(resolveSwipeKeyboardAction('Delete', true, true), 'left');
  assert.equal(resolveSwipeKeyboardAction('Backspace', false, true), 'right');
  assert.equal(resolveSwipeKeyboardAction('Delete', false, false), null);
});

test('SEENIT-UX-001 décrit les raccourcis sans masquer le contenu de la carte', () => {
  assert.equal(
    describeSwipeKeyboardActions('Supprimer', 'Abandonner'),
    'Actions de la carte — flèche gauche : Supprimer ; flèche droite : Abandonner ; touche Suppr : Supprimer.'
  );
  assert.equal(describeSwipeKeyboardActions(undefined, undefined), '');
});
