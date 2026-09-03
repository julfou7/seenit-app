import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { useToastStore } from '../src/store/toastStore.ts';

function resetToastStore() {
  useToastStore.getState().clearQueue();
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

test('SEENIT-UX-004 le bilan Plex conserve uniquement les serveurs scannés et compte les vus et dé-vus', () => {
  resetToastStore();
  const store = useToastStore.getState();

  store.showToast({ title: 'Film vu', action: 'Vu sur Plex • Synchronisé' }, 'success', undefined, undefined, 5000, 'plex');
  store.showToast({ title: 'Film dé-vu', subtitle: 'Dé-vu sur Plex', action: 'Vu sur Plex • Synchronisé' }, 'success', undefined, undefined, 5000, 'plex');
  store.showToast(
    'Synchronisation Plex terminée • Synchronisés : Serveur A • Ignorés : Serveur B (timeout)',
    'success',
    undefined,
    undefined,
    7000,
    'plex'
  );

  const completion = useToastStore.getState().queue.find(item => item.retainOnScopeClear === true);
  assert.equal(
    completion?.message,
    'Synchronisation Plex terminée • 1 serveur scanné • 1 vu • 1 dé-vu'
  );
  assert.doesNotMatch(String(completion?.message), /ignor/i);
  assert.doesNotMatch(String(completion?.message), /Serveur A|Serveur B/);

  useToastStore.getState().clearQueuedScope('plex');
  assert.equal(useToastStore.getState().queue.length, 1);
  assert.equal(useToastStore.getState().queue[0].retainOnScopeClear, true);
});

test('SEENIT-UX-004 le toast Plex expose le bouton Ignorer les suivants', () => {
  const source = fs.readFileSync(new URL('../src/components/ToastContainer.tsx', import.meta.url), 'utf8');
  assert.match(source, /Ignorer les suivants/);
  assert.match(source, /clearQueuedScope\('plex'\)/);
});
