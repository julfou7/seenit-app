import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Retour terrain du 16/11 (« La Guerre des mondes » vu à 0 % puis directement à 31 %) : sans transfert actif, la relecture
// n'avait lieu que toutes les 30 s. Onglet Télécharger ouvert : toutes les 3 s, puis chaque seconde dès qu'un
// transfert est actif ; une seule boucle de relecture à la fois.
test('onglet Télécharger ouvert : un nouveau transfert apparaît en quelques secondes, une seule boucle', () => {
  const store = readFileSync('src/store/liveDownloadStoreCore.ts', 'utf8');
  assert.match(store, /export const DOWNLOADS_SCREEN_IDLE_MS = 3_000;/);
  assert.match(store, /: hasActive\n\s+\? pollingIntervalMs\n\s+: downloadsScreenOpen \? DOWNLOADS_SCREEN_IDLE_MS : 30_000;/, 'ailleurs : 30 s inchangées');
  assert.match(store, /if \(!get\(\)\.isPolling \|\| generation !== pollGeneration\) return;/, 'une boucle remplacée s’arrête d’elle-même');
  assert.match(store, /restartPollingLoop = \(\) => \{\n\s+clearPollingTimer\(\);\n\s+const generation = \+\+pollGeneration;/);
  assert.match(store, /if \(get\(\)\.isPolling && restartPollingLoop\) restartPollingLoop\(\);\n\s+else get\(\)\.startPolling\(1000\);/);
  const screen = readFileSync('src/screens/DownloadsScreenCore.tsx', 'utf8');
  assert.match(screen, /useLiveDownloadStore\.getState\(\)\.setDownloadsScreenOpen\(true\);\n\s+return \(\) => useLiveDownloadStore\.getState\(\)\.setDownloadsScreenOpen\(false\);/);
});
