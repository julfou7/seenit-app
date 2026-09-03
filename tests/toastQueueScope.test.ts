import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { useToastStore } from '../src/store/toastStore.ts';

function resetToastStore() {
  useToastStore.setState({
    currentToast: null,
    queue: [],
    message: '',
    type: 'info',
    show: undefined,
    onUndo: null,
    visible: false
  });
}

test('SEENIT-UX-004 ignorer les suivants purge uniquement les futurs toasts Plex', () => {
  resetToastStore();
  const store = useToastStore.getState();

  store.showToast('Plex courant', 'success', undefined, undefined, 5000, 'plex');
  store.showToast('Notification hors Plex', 'info');
  store.showToast('Plex suivant 1', 'success', undefined, undefined, 5000, 'plex');
  store.showToast('Plex suivant 2', 'success', undefined, undefined, 5000, 'plex');

  useToastStore.getState().clearQueuedScope('plex');
  const after = useToastStore.getState();

  assert.equal(after.currentToast?.message, 'Plex courant');
  assert.equal(after.currentToast?.scope, 'plex');
  assert.deepEqual(after.queue.map((item) => item.message), ['Notification hors Plex']);
});

test('SEENIT-UX-004 le toast Plex expose le bouton Ignorer les suivants', () => {
  const source = fs.readFileSync(new URL('../src/components/ToastContainer.tsx', import.meta.url), 'utf8');
  assert.match(source, /Ignorer les suivants/);
  assert.match(source, /clearQueuedScope\('plex'\)/);
});
