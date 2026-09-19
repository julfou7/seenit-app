import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync('src/index.css', 'utf8');
const toast = readFileSync('src/components/ToastContainer.tsx', 'utf8');

test('le conteneur toast conserve une respiration globale compatible safe area', () => {
  assert.ok(toast.includes('id="toast-notification-wrapper"'));
  assert.ok(css.includes('#toast-notification-wrapper'));
  assert.ok(css.includes('bottom: calc(6.25rem + env(safe-area-inset-bottom, 0px)) !important;'));
  assert.ok(css.includes('bottom: calc(6.25rem + var(--seenit-safe-area-bottom, env(safe-area-inset-bottom, 0px))) !important;'));
});

test('le correctif ne réduit pas le contenu tactile des toasts compacts ou média', () => {
  assert.ok(toast.includes('min-h-[64px]'));
  assert.ok(toast.includes('py-2.5'));
  assert.ok(toast.includes('Ignorer les suivants'));
  assert.ok(toast.includes('Annuler'));
});
