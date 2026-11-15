import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importsNeedingPresence, importsReferenceFrom } from '../src/features/downloads/importPresenceRefresh.ts';
import { importedEpisodesLabel } from '../src/features/downloads/importedEpisodes.ts';

const series = (episodes: Array<[number, number]>) => ({ kind: 'series' as const, key: 's7', arrId: 7, tmdbId: 259909, title: 'Dexter : Résurrection', date: 1, episodes: episodes.map(([season, episode]) => ({ season, episode })) });

// Retour terrain du 15/11 (v1.4.320, Dexter S02) : E01 et E03 présents dans Sonarr, mais la fiche les montrait à
// télécharger et la carte de saison proposait « Ajouter E1 » — présence restée en cache après l'import.
test('un import nouveau rafraîchit la présence du titre, jamais en masse au premier lancement', () => {
  type Copy = { items: Parameters<typeof importsNeedingPresence>[1]['items']; failures: string[] };
  const copy = (items: unknown[], failures: string[] = []): Copy => ({ items: items as Copy['items'], failures });
  const movie = (key: string, tmdbId: number, date = 1) => ({ kind: 'movie', key, arrId: tmdbId, tmdbId, title: 'Film', date });
  const run = (previous: Copy | undefined, next: Copy) => importsNeedingPresence(importsReferenceFrom(previous), next).targets;
  assert.deepEqual(run(undefined, copy([series([[2, 1]])])), [], 'sans référence : rien en masse');
  assert.deepEqual(run(copy([series([[2, 1]])]), copy([series([[2, 1]])])), [], 'rien de nouveau');
  assert.deepEqual(run(copy([series([[2, 1]])]), copy([series([[2, 1], [2, 3]])])), [{ tmdbId: 259909, mediaType: 'tv' }], 'E03 importé : présence relue');
  assert.deepEqual(run(copy([]), copy([movie('m3', 755898, 5)])), [{ tmdbId: 755898, mediaType: 'movie' }]);
  // Revues Codex #1063 : référence par source. Sonarr en panne : ses séries ne sont pas comparées, Radarr l'est.
  const during = importsNeedingPresence(importsReferenceFrom(copy([series([[2, 1]]), movie('m3', 1)])), copy([movie('m3', 1), movie('m4', 2)], ['Sonarr']));
  assert.deepEqual(during.targets, [{ tmdbId: 2, mediaType: 'movie' }], 'import Radarr pendant la panne Sonarr : jamais perdu');
  // Retour de Sonarr : seule la vraie nouveauté (E03), pas toute la bibliothèque.
  const after = importsNeedingPresence(during.reference, copy([series([[2, 1], [2, 3]]), movie('m3', 1), movie('m4', 2)]));
  assert.deepEqual(after.targets, [{ tmdbId: 259909, mediaType: 'tv' }]);
  // Au plus 5 relus ; les suivants le seront à la synchronisation d'après.
  const many = Array.from({ length: 12 }, (_, index) => movie(`m${index}`, 1000 + index));
  const first = importsNeedingPresence(importsReferenceFrom(copy([])), copy(many));
  const second = importsNeedingPresence(first.reference, copy(many));
  const third = importsNeedingPresence(second.reference, copy(many));
  assert.deepEqual([first.targets.length, second.targets.length, third.targets.length], [5, 5, 2]);
  const store = readFileSync('src/store/arrSyncStore.ts', 'utf8');
  assert.match(store, /const presence = labelled\.imports \? importsNeedingPresence\(importsReference\.value, labelled\.imports\) : null;/);
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
