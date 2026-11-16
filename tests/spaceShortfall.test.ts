import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { destinationDisk, IMPORT_MARGIN_BYTES, spaceShortfall } from '../src/features/downloads/arrDiskSpace.ts';

type DiskStatus = { label: string; freeSpace: number; services?: string[] };
import { describeReleases } from '../src/features/downloads/releaseVersions.ts';

const GB = 1024 ** 3;

// #1076 (audit du 16/11) : Dexter S02E02 téléchargé puis bloqué à l'import faute de place sur D:.
test('une version plus grosse que l’espace libre du disque de destination est signalée', () => {
  const d: DiskStatus = { label: 'D:', freeSpace: 5 * GB, services: ['Sonarr', 'Radarr'] };
  assert.equal(spaceShortfall(d, 16 * GB), 'Pas assez de place : 16 Go pour 5 Go libres sur D:');
  assert.equal(spaceShortfall(d, 2 * GB), undefined);
  assert.ok(spaceShortfall(d, 5 * GB - IMPORT_MARGIN_BYTES / 2), 'la marge d’import compte');
  assert.equal(spaceShortfall(d, 0), undefined, 'taille inconnue : rien n’est affirmé');
  assert.equal(spaceShortfall(undefined, 16 * GB), undefined, 'disque inconnu : rien n’est affirmé');

  assert.equal(destinationDisk([d], 'tv'), d);
  const e: DiskStatus = { label: 'E:', freeSpace: 900 * GB, services: ['Sonarr'] };
  assert.equal(destinationDisk([d, e], 'tv'), undefined, 'deux disques Sonarr : destination incertaine');
  assert.equal(destinationDisk([d, e], 'movie'), d);
});

test('la conseillée tient sur le disque quand une telle version existe', () => {
  const releases = [
    { id: 1, name: 'Film.2026.MULTI.1080p.WEB', size: 16 * GB, seeders: 900 },
    { id: 2, name: 'Film.2026.MULTI.1080p.WEB.Light', size: 2 * GB, seeders: 50 },
    { id: 3, name: 'Film.2026.MULTI.1080p.WEB', size: 3 * GB, seeders: 40 },
  ];
  const fits = (release: { size: number }) => release.size <= 5 * GB;
  assert.equal(describeReleases(releases, '1080p').find(entry => entry.recommended)?.release.id, 1, 'sans contrainte : la mieux partagée');
  assert.equal(describeReleases(releases, '1080p', undefined, fits).find(entry => entry.recommended)?.release.id, 3, 'tient sur le disque, hors Light');
  assert.equal(describeReleases(releases, '1080p', undefined, () => false).find(entry => entry.recommended)?.release.id, 1, 'rien ne tient : la règle habituelle');
});

test('« Version précise » et « Autre version » signalent la place sans bloquer le choix', () => {
  for (const file of ['src/screens/mediaDetail/PreciseVersionPage.tsx', 'src/components/AlternativeReleaseModal.tsx']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /const disk = destinationDisk\(useDiskStatus\(/, file);
    assert.match(source, /describeReleases\([^)]*, undefined, release => !spaceShortfall\(disk, release\.size\)\)/, file);
    assert.match(source, /spaceWarning=\{tooBig\}/, file);
    assert.match(source, /'Télécharger quand même'/, `${file} : le choix reste possible`);
  }
  const card = readFileSync('src/components/ReleaseVersionCard.tsx', 'utf8');
  assert.match(card, /\{spaceWarning && <span data-space-warning/);
});
