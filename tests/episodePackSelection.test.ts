import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chooseExactCleanupTorrentId,
  extractEpisodeRefsFromFileName,
  extractReleaseTorrentHash,
  findExactNewTorrentIds,
  hasCompatibleIndividualEpisodeRelease,
  rankSeasonPackReleases,
  selectEpisodeFiles
} from '../src/features/downloads/episodePackSelection.ts';

test('détecte les notations S01E01 et 1x01 sans confondre les codecs', () => {
  assert.deepEqual(extractEpisodeRefsFromFileName('Ted.Lasso.S01E01.1080p.WEBRip.EAC3.5.1.x265.mkv'), [
    { season: 1, episode: 1 }
  ]);
  assert.deepEqual(extractEpisodeRefsFromFileName('Ted Lasso - 1x01 - Pilot.mkv'), [
    { season: 1, episode: 1 }
  ]);
});

test('sélectionne uniquement le fichier S01E01 dans un pack Ted Lasso', () => {
  const selection = selectEpisodeFiles([
    { index: 0, name: 'Ted.Lasso.S01E01.Pilot.1080p.WEBRip.mkv', size: 1_000_000_000 },
    { index: 1, name: 'Ted.Lasso.S01E02.Biscuits.1080p.WEBRip.mkv', size: 1_000_000_000 },
    { index: 2, name: 'Ted.Lasso.S01E03.Trent.Crimm.1080p.WEBRip.mkv', size: 1_000_000_000 }
  ], 1, 1);

  assert.deepEqual(selection.targetIndexes, [0]);
  assert.equal(selection.ambiguous, false);
  assert.match(selection.targetNames[0], /S01E01/i);
});

test('ignore un sample et refuse deux vraies correspondances ambiguës', () => {
  const selection = selectEpisodeFiles([
    { index: 0, name: 'Sample/Ted.Lasso.S01E01.sample.mkv', size: 20_000_000 },
    { index: 1, name: 'VF/Ted.Lasso.S01E01.mkv', size: 900_000_000 },
    { index: 2, name: 'VO/Ted.Lasso.S01E01.mkv', size: 900_000_000 }
  ], 1, 1);

  assert.deepEqual(selection.targetIndexes, []);
  assert.equal(selection.ambiguous, true);
});

test('accepte un fichier multi-épisodes uniquement s’il est l’unique correspondance', () => {
  const selection = selectEpisodeFiles([
    { index: 0, name: 'Ted.Lasso.S01E01E02.1080p.mkv' },
    { index: 1, name: 'Ted.Lasso.S01E03.1080p.mkv' }
  ], 1, 1);

  assert.deepEqual(selection.targetIndexes, [0]);
  assert.deepEqual(selection.extraEpisodeNumbers, [2]);
});

test('classe uniquement les packs compatibles avec la qualité demandée', () => {
  const releases = [
    { title: 'Ted.Lasso.S01.2160p', fullSeason: true, approved: true, seeders: 500 },
    { title: 'Ted.Lasso.S01.1080p', fullSeason: true, approved: true, releaseWeight: 2, seeders: 200 },
    { title: 'Ted.Lasso.S01.1080p.B', fullSeason: true, approved: true, releaseWeight: 1, seeders: 100 },
    { title: 'Ted.Lasso.S01E01.1080p', fullSeason: false, approved: true, seeders: 1000 }
  ];

  const ranked = rankSeasonPackReleases(releases, '1080p');
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].title, 'Ted.Lasso.S01.1080p.B');
  assert.equal(hasCompatibleIndividualEpisodeRelease(releases, '1080p'), true);
});

test('extrait un infohash exact depuis un champ dédié ou un magnet', () => {
  const hash = 'a'.repeat(40);
  assert.equal(extractReleaseTorrentHash({ infoHash: hash.toUpperCase() }), hash);
  assert.equal(extractReleaseTorrentHash({ magnetUrl: `magnet:?xt=urn:btih:${hash}&dn=ted` }), hash);
  assert.equal(extractReleaseTorrentHash({ downloadUrl: 'https://prowlarr/release/123' }), null);
});


test('ne manipule jamais un hash qBittorrent déjà présent avant la demande', () => {
  const oldHash = 'a'.repeat(40);
  assert.deepEqual(findExactNewTorrentIds(
    [oldHash],
    [oldHash],
    [oldHash],
    oldHash
  ), []);
});

test('accepte l’infohash exact de la release uniquement lorsqu’il vient d’apparaître', () => {
  const newHash = 'b'.repeat(40);
  assert.deepEqual(findExactNewTorrentIds(
    [],
    [newHash],
    [],
    newHash
  ), [newHash]);
});

test('ignore un torrent concurrent sans identifiant Sonarr exact', () => {
  const wanted = 'c'.repeat(40);
  const unrelated = 'd'.repeat(40);
  assert.deepEqual(findExactNewTorrentIds(
    [wanted],
    [wanted, unrelated],
    [],
    null
  ), [wanted]);
});

test('laisse l’ambiguïté visible si plusieurs nouveaux IDs exacts existent', () => {
  const first = 'e'.repeat(40);
  const second = 'f'.repeat(40);
  assert.deepEqual(new Set(findExactNewTorrentIds(
    [first, second],
    [first, second],
    [],
    null
  )), new Set([first, second]));
});


test('le nettoyage refuse aussi un hash ancien corroboré après coup par Sonarr', () => {
  const oldHash = '1'.repeat(40);
  assert.equal(chooseExactCleanupTorrentId(
    [],
    [oldHash],
    [oldHash],
    oldHash
  ), null);
});

test('le nettoyage peut cibler un infohash exact qui n’existait pas avant la demande', () => {
  const newHash = '2'.repeat(40);
  assert.equal(chooseExactCleanupTorrentId(
    [],
    [],
    [],
    newHash
  ), newHash);
});
