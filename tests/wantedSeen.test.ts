import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hideSeenWanted, seenLongEnough, SEEN_GRACE_MS } from '../src/features/downloads/wantedSeen.ts';

// Retour terrain du 09/11 sur la v1.4.286 : « oui il faut le retirer mais ajoute un délai de 24 h car des fois je
// fais des tests vu non vu ou des fausses manip ».
const now = Date.parse('2026-11-09T16:00:00Z');
const hour = 3_600_000;
const mobland = { id: 'f1', tmdbId: 247718, mediaType: 'tv', seenEpisodes: ['2x1', '2x2', '2x3'], episodeRecords: { '2x1': { watchedAt: now - 30 * hour }, '2x2': { watchedAt: now - 2 * hour } } };
const film = { id: 'f2', tmdbId: 335984, mediaType: 'movie', seenEpisodes: ['movie'], episodeRecords: { movie: { watchedAt: now - 48 * hour } } };
const episode = (id: number, season: number, number: number, extra: Record<string, unknown> = {}) => ({ kind: 'episode', id, seriesId: 5, tmdbId: 247718, seriesTitle: 'MobLand', season, episode: number, title: 'x', wanted: true, ...extra });

test('SEENIT-DOWNLOAD-020 un recherché déjà vu dans SeenIt depuis 24 h quitte Programmés ; avant 24 h il reste', () => {
  assert.equal(SEEN_GRACE_MS, 24 * hour);
  assert.equal(seenLongEnough(mobland as never, '2x1', now), true, 'vu il y a 30 h');
  assert.equal(seenLongEnough(mobland as never, '2x2', now), false, 'vu il y a 2 h : peut-être une fausse manipulation');
  assert.equal(seenLongEnough(mobland as never, '2x3', now), true, 'vu sans date connue (import ancien) : ancien');
  assert.equal(seenLongEnough(mobland as never, '2x4', now), false, 'pas vu');
  assert.equal(seenLongEnough(undefined, '2x1', now), false, 'série non suivie');
  const items = [
    episode(1, 2, 1), episode(2, 2, 2), episode(3, 2, 3), episode(4, 2, 4),
    episode(9, 2, 9, { wanted: undefined, date: '2026-11-13T20:00:00Z' }),
    { kind: 'movie', id: 40, tmdbId: 335984, title: 'Blade Runner 2049', wanted: true },
    { kind: 'movie', id: 41, tmdbId: 999, title: 'Pas suivi', wanted: true },
    // Même numéro TMDB, autre type : jamais confondu.
    { kind: 'movie', id: 42, tmdbId: 247718, title: 'Homonyme', wanted: true },
  ];
  const kept = hideSeenWanted(items as never, [mobland, film] as never, now).map(item => `${item.kind}:${item.id}`);
  assert.deepEqual(kept, ['episode:2', 'episode:4', 'episode:9', 'movie:41', 'movie:42']);
  // Un épisode à venir n'est jamais masqué, même marqué vu par erreur.
  const upcoming = [episode(9, 2, 9, { wanted: undefined })];
  assert.equal(hideSeenWanted(upcoming as never, [{ ...mobland, seenEpisodes: ['2x9'] }] as never, now).length, 1);
  const section = readFileSync('src/components/ProgrammedSection.tsx', 'utf8');
  assert.match(section, /const items = hideSeenWanted\(\(snapshot\?\.programmed\?\.items \|\| \[\]\)\.filter\(item => !hidden\.has\(`\$\{item\.kind\}:\$\{item\.id\}`\)\), shows\);/, 'appliqué à la liste affichée, sans écriture Sonarr/Radarr');
  assert.doesNotMatch(readFileSync('src/features/downloads/wantedSeen.ts', 'utf8'), /executePut|executeDelete|unprogram/, 'affichage seul');
});
