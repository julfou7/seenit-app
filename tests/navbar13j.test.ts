import test from 'node:test';
import assert from 'node:assert/strict';
import { acknowledgeCompletedDownloads, completionKey, resolveDownloadNavState } from '../src/features/navigation/downloadNavState.ts';
import { activateNavigationShortcut } from '../src/features/navigation/navigationShortcuts.ts';
import type { RootNavigationTab } from '../src/features/navigation/tabPresentation.ts';
const active = { id: 'hash-a', status: 'downloading', progress: 30 };
const ready = { id: 'hash-b', status: 'completed', progress: 100, addedAt: 123 };
test('SEENIT-UX-017 les raccourcis actifs et les réglages évitent les entrées historiques identiques', () => {
  const changes: RootNavigationTab[] = [], requests: RootNavigationTab[] = [];
  let quick = 0;
  const actions = { changeTab: (tab: RootNavigationTab) => changes.push(tab), request: (tab: RootNavigationTab) => requests.push(tab), quickAccount: () => { quick++; } };
  activateNavigationShortcut('discover', 'discover', actions);
  // La loupe peut rouvrir plusieurs fois la recherche, sans navigation ni reset.
  activateNavigationShortcut('discover', 'discover', actions);
  activateNavigationShortcut('downloads', 'downloads', actions);
  assert.deepEqual(changes, []);
  assert.deepEqual(requests, ['discover', 'discover', 'downloads']);
  activateNavigationShortcut('discover', 'profile', actions);
  assert.equal(quick, 1);
  assert.deepEqual(changes, []);
  activateNavigationShortcut('watchlist', 'downloads', actions);
  assert.deepEqual(changes, ['downloads']);
});
test('SEENIT-UX-017 privilégie les transferts actifs puis les actions requises et les terminés non consultés', () => {
  assert.equal(resolveDownloadNavState([active, ready, { id: 'error', status: 'error' }], []).kind, 'active');
  assert.deepEqual(resolveDownloadNavState([active], []), { kind: 'active', count: 1, label: 'Télécharger · en cours' });
  assert.equal(resolveDownloadNavState([active, { ...active, id: 'other' }], []).label, 'Télécharger · 2 en cours');
  assert.equal(resolveDownloadNavState([ready, { id: 'manual', status: 'warning', progress: 100 }], []).kind, 'attention');
  assert.equal(resolveDownloadNavState([ready], [], true).kind, 'attention');
  assert.equal(resolveDownloadNavState([ready], []).kind, 'ready');
  assert.equal(resolveDownloadNavState([{ id: 'standby', status: 'waiting' }], []).kind, 'none');
});
test('SEENIT-UX-017 acquitte uniquement les transferts terminés consultés sans toucher aux données', () => {
  const items = [active, ready];
  const before = structuredClone(items);
  const acknowledged = acknowledgeCompletedDownloads(items);
  assert.deepEqual(acknowledged, [completionKey(ready)]);
  assert.deepEqual(items, before);
  assert.equal(resolveDownloadNavState([ready], acknowledged).kind, 'none');
  assert.equal(resolveDownloadNavState([ready, { ...ready, id: 'new' }], acknowledged).kind, 'ready');
  const history = Array.from({ length: 400 }, (_, i) => ({ ...ready, id: String(i) }));
  assert.equal(resolveDownloadNavState(history, acknowledgeCompletedDownloads(history)).kind, 'none');
});
