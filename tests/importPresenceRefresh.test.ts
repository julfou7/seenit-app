import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importsNeedingPresence } from '../src/features/downloads/importPresenceRefresh.ts';
import { importedEpisodesLabel } from '../src/features/downloads/importedEpisodes.ts';

const series = (episodes: Array<[number, number]>) => ({ kind: 'series' as const, key: 's7', arrId: 7, tmdbId: 259909, title: 'Dexter : Résurrection', date: 1, episodes: episodes.map(([season, episode]) => ({ season, episode })) });

// Retour terrain du 15/11 (v1.4.320, Dexter S02) : E01 et E03 présents dans Sonarr, mais la fiche les montrait à
// télécharger et la carte de saison proposait « Ajouter E1 » — présence restée en cache après l'import.
test('un import nouveau rafraîchit la présence du titre, jamais en masse au premier lancement', () => {
  const copy = (items: unknown[], failures: string[] = []) => ({ items: items as Parameters<typeof importsNeedingPresence>[1]['items'], failures });
  assert.deepEqual(importsNeedingPresence(undefined, copy([series([[2, 1]])])), [], 'sans copie précédente : rien');
  assert.deepEqual(importsNeedingPresence(copy([series([[2, 1]])]), copy([series([[2, 1]])])), [], 'rien de nouveau');
  assert.deepEqual(importsNeedingPresence(copy([series([[2, 1]])]), copy([series([[2, 1], [2, 3]])])), [{ tmdbId: 259909, mediaType: 'tv' }], 'E03 importé : présence relue');
  assert.deepEqual(importsNeedingPresence(copy([]), copy([{ kind: 'movie', key: 'm3', arrId: 3, tmdbId: 755898, title: 'Film', date: 5 }])), [{ tmdbId: 755898, mediaType: 'movie' }]);
  // Revue Codex #1063 : une copie en panne n'est jamais comparée ; au plus 5 titres relus par synchronisation.
  assert.deepEqual(importsNeedingPresence(copy([], ['Sonarr']), copy([series([[2, 1]])])), []);
  assert.deepEqual(importsNeedingPresence(copy([]), copy([series([[2, 1]])], ['Radarr'])), []);
  const many = Array.from({ length: 12 }, (_, index) => ({ kind: 'movie', key: `m${index}`, arrId: index, tmdbId: 1000 + index, title: 'Film', date: 1 }));
  assert.equal(importsNeedingPresence(copy([]), copy(many)).length, 5);
  const store = readFileSync('src/store/arrSyncStore.ts', 'utf8');
  assert.match(store, /const refreshes = labelled\.imports \? importsNeedingPresence\(previousImports, labelled\.imports\) : \[\];/);
  assert.match(store, /refreshes\.reduce\(\(chain, target\) => chain\.then\(\(\) => useMediaPresenceStore\.getState\(\)\.checkPresence\(\{ \.\.\.target, forceRefresh: true \}\)\)/, 'une par une');
});

// Retour terrain du 15/11 : « l'historique, pour les séries on ne sait pas ce qui a été téléchargé ».
test('Téléchargés : épisodes exacts d’une série, sans trou masqué', () => {
  assert.equal(importedEpisodesLabel(series([[2, 3], [2, 1]])), 'S02 · E01, E03');
  assert.equal(importedEpisodesLabel(series([[1, 9], [1, 10], [2, 1]])), 'S01 · E09–E10 · S02 · E01');
  assert.equal(importedEpisodesLabel(series([])), null);
  assert.match(readFileSync('src/components/RecentImportsRail.tsx', 'utf8'), /\{!undecided && importedEpisodesLabel\(item\) && <p className="downloads-recent__episodes">\{importedEpisodesLabel\(item\)\}<\/p>\}/);
});

// Retour terrain du 15/11 (E02 téléchargé, import bloqué faute de place sur D:) : l'attente d'import dit pourquoi.
test('import en attente avec un disque presque plein : chiffre réel sur la carte', () => {
  const card = readFileSync('src/components/DownloadItemCard.tsx', 'utf8');
  assert.match(card, /importDiskNote \? `Téléchargé · import en attente : \$\{importDiskNote\}` : 'Téléchargé · import Plex en cours'/);
  const screen = readFileSync('src/screens/DownloadsScreenCore.tsx', 'utf8');
  assert.match(screen, /const disk = lowImportDisk\(disks, mediaType\); return disk \? `disque \$\{disk\.label\} presque plein \(\$\{formatFreeSpace\(disk\.freeSpace\)\} libres\)` : undefined;/);
  assert.match(screen, /importDiskNote=\{importDiskNote\(item\.mediaType\)\}/);
});
