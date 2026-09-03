import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {
  buildPlexCompletionMessage,
  filterQueuedToastsByScope,
  normalizePlexItemAction,
  normalizePlexNonVuWording
} from '../src/store/toastQueuePolicy.ts';

test('SEENIT-UX-004 ignorer les suivants purge uniquement les futurs toasts Plex', () => {
  const queue = [
    { id: 'other', scope: undefined, retainOnScopeClear: false },
    { id: 'plex-1', scope: 'plex' as const, retainOnScopeClear: false },
    { id: 'plex-final', scope: 'plex' as const, retainOnScopeClear: true },
    { id: 'plex-2', scope: 'plex' as const, retainOnScopeClear: false }
  ];

  const filtered = filterQueuedToastsByScope(queue, 'plex');
  assert.deepEqual(filtered.map((item) => item.id), ['other', 'plex-final']);
});

test('SEENIT-UX-004 le bilan Plex conserve uniquement les serveurs scannés et compte les vus et non vus', () => {
  const message = buildPlexCompletionMessage(
    'Synchronisation Plex terminée • Synchronisés : Serveur A • Ignorés : Serveur B (timeout)',
    1,
    1
  );

  assert.equal(
    message,
    'Synchronisation Plex terminée • 1 serveur scanné • 1 vu • 1 non vu'
  );
  assert.doesNotMatch(message, /ignor/i);
  assert.doesNotMatch(message, /Serveur A|Serveur B/);
});

test('SEENIT-UX-004 les anciens libellés Plex sont affichés uniquement comme non vu', () => {
  assert.equal(normalizePlexNonVuWording('Dé-vu sur Plex'), 'non vu sur Plex');
  assert.equal(normalizePlexNonVuWording('2 dé-vus'), '2 non vus');
  assert.equal(normalizePlexNonVuWording('non-vu sur Plex'), 'non vu sur Plex');
});

test('SEENIT-UX-004 le toast non vu ne répète pas Plex et ne dit jamais Vu sur Plex', () => {
  assert.equal(normalizePlexItemAction('Vu sur Plex • Synchronisé', 'Dé-vu sur Plex'), 'Synchronisé');
  assert.equal(normalizePlexItemAction('Vu sur Plex • Synchronisé', 'S01 | E02 • non-vu sur Plex'), 'Synchronisé');
  assert.equal(normalizePlexItemAction('Vu sur Plex • Synchronisé', 'Film'), 'Vu sur Plex • Synchronisé');
});

test('SEENIT-UX-004 le toast Plex expose le bouton Ignorer les suivants', () => {
  const source = fs.readFileSync(new URL('../src/components/ToastContainer.tsx', import.meta.url), 'utf8');
  assert.match(source, /Ignorer les suivants/);
  assert.match(source, /clearQueuedScope\('plex'\)/);
});
