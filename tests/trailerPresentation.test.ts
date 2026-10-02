import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrailerPresentationQueue, startTrailerPresentation } from '../src/features/trailers/trailerPresentation.ts';

test('SEENIT-UX-013 restaure la présentation même si le lecteur ferme pendant son ouverture', async () => {
  const calls: string[] = [];
  let release!: () => void;
  const opening = new Promise<void>(resolve => { release = resolve; });
  const session = startTrailerPresentation({
    enter: async () => { calls.push('enter'); await opening; },
    leave: async () => { calls.push('portrait'); },
  });
  const closing = session.close();
  release();
  await closing;
  await session.close();
  assert.deepEqual(calls, ['enter', 'portrait']);
});

test('un refus plein écran/orientation reste non bloquant et nettoie la session', async () => {
  let left = 0;
  const session = startTrailerPresentation({
    enter: async () => { throw new Error('unsupported'); },
    leave: async () => { left++; },
  });
  await session.ready;
  await session.close();
  assert.equal(left, 1);
});

test('le remontage StrictMode sérialise le bridge Android sans restaurer le nouveau lecteur', async () => {
  const calls: string[] = [];
  const queue = createTrailerPresentationQueue({
    enter: async () => { calls.push('landscape'); },
    leave: async () => { calls.push('portrait'); },
  });
  const first = startTrailerPresentation(queue);
  const closed = first.close();
  const second = startTrailerPresentation(queue);
  await Promise.all([closed, second.ready]);
  await second.close();
  assert.deepEqual(calls, ['landscape', 'portrait', 'landscape', 'portrait']);
});
