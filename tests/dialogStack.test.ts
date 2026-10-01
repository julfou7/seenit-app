import assert from 'node:assert/strict';
import test from 'node:test';
import { createDialogStack } from '../src/features/navigation/dialogStack.ts';

test('SEENIT-UX-012 ferme uniquement le dialogue supérieur', () => {
  const stack = createDialogStack();
  const closed: string[] = [];
  stack.add({ id: 'parent', depth: 1, close: () => closed.push('parent') });
  stack.add({ id: 'child', depth: 2, close: () => closed.push('child') });
  assert.equal(stack.closeTop(), true);
  assert.equal(stack.closeTop(), true); // retour répété avant que React ait démonté l'enfant
  assert.deepEqual(closed, ['child']);
});

test('SEENIT-UX-012 préserve le parent lors de la fermeture imbriquée', () => {
  const stack = createDialogStack();
  const closed: string[] = [];
  const removeChild = stack.add({ id: 'child', depth: 2, close: () => closed.push('child') });
  const removeParent = stack.add({ id: 'parent', depth: 1, close: () => closed.push('parent') });
  stack.closeTop(); // ordre d'effets React enfant avant parent
  removeChild();
  assert.equal(stack.top()?.id, 'parent');
  stack.closeTop();
  assert.deepEqual(closed, ['child', 'parent']);
  removeParent();
  assert.equal(stack.closeTop(), false);
});

test('SEENIT-UX-012 isole les dialogues frères et les démontages hors ordre', () => {
  const stack = createDialogStack();
  const calls: string[] = [];
  const remove = stack.add({ id: 'background', depth: 1, close: () => calls.push('background') });
  stack.add({ id: 'latest', depth: 1, close: () => calls.push('latest') });
  remove();
  remove();
  stack.closeTop();
  assert.deepEqual(calls, ['latest']);
  stack.acknowledge('latest');
  stack.closeTop();
  assert.deepEqual(calls, ['latest', 'latest']);
});
