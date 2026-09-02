import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const toastSource = readFileSync(
  new URL('../src/components/ToastContainer.tsx', import.meta.url),
  'utf8'
);

test('SEENIT-UX-004 les toasts longs reviennent à la ligne sans troncature sur mobile', () => {
  assert.match(toastSource, /w-full sm:w-auto max-w-full/);
  assert.match(toastSource, /whitespace-normal break-words/);
  assert.doesNotMatch(
    toastSource,
    /text-zinc-100[^\n]*(whitespace-nowrap|line-clamp-\d)/
  );
});

test('SEENIT-UX-004 le toast reste au-dessus de la navigation et de la safe area', () => {
  assert.match(
    toastSource,
    /bottom-\[calc\(5rem\+env\(safe-area-inset-bottom,0px\)\)\]/
  );
});
