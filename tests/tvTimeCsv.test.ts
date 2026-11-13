import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildTvTimeEpisodeRecord, buildTvTimeMovieProgress, keepLatestTvTimeDate, readTvTimeRowDate } from '../src/features/import/tvTimeCsv.ts';

const NOW = Date.parse('2026-11-13T12:00:00.000Z');

test('SEENIT-PROFILE-007 retour v1.4.306 : l’import TV Time date chaque Vu et fait d’un film un Vu complet', () => {
  // Export TV Time réel (tracking-prod-records.csv) : created_at « 2021-03-29 08:33:29 », watch_date vide.
  assert.equal(readTvTimeRowDate({ movie_name: '1917', created_at: '2021-03-29 08:33:29', watch_date: '' }), Date.parse('2021-03-29 08:33:29'));
  assert.equal(readTvTimeRowDate({ watched_at: '2020-01-01T10:00:00Z', created_at: '2021-01-01 10:00:00' }), Date.parse('2020-01-01T10:00:00Z'), 'la date de visionnage prime sur le marquage');
  assert.equal(readTvTimeRowDate({ date: '1700000000' }), 1_700_000_000_000);
  // Revue Codex #978 : watch_date (export réel, secondes) prime sur created_at (marquage).
  assert.equal(readTvTimeRowDate({ series_name: 'Bodyguard (2018)', created_at: '2018-12-02 19:14:39', watch_date: '1543778079' }), 1_543_778_079_000);
  assert.equal(readTvTimeRowDate({ watch_date: '1.689410863725422e+15' }), 1_689_410_863_725, 'microsecondes de l’export v2');
  assert.equal(readTvTimeRowDate({ watch_date: '1543778079000' }), 1_543_778_079_000, 'millisecondes');
  assert.equal(readTvTimeRowDate({ created_at: 'pas une date' }), null);
  assert.equal(readTvTimeRowDate({ movie_name: 'Sans date' }), null);

  const dates: Record<string, number> = {};
  keepLatestTvTimeDate(dates, '1x1', 10);
  keepLatestTvTimeDate(dates, '1x1', 30);
  keepLatestTvTimeDate(dates, '1x1', 20);
  keepLatestTvTimeDate(dates, '1x2', null);
  assert.deepEqual(dates, { '1x1': 30 });
  assert.deepEqual(buildTvTimeEpisodeRecord(dates, '1x1', NOW), { watchedAt: 30, source: 'tvtime' });
  assert.deepEqual(buildTvTimeEpisodeRecord(dates, '1x2', NOW), { watchedAt: NOW, source: 'tvtime' });

  // Film nouveau : clé movie (plus jamais 1x1) et enregistrement daté.
  assert.deepEqual(buildTvTimeMovieProgress(null, 42, NOW), { status: 'completed', seenEpisodes: ['movie'], episodeRecords: { movie: { watchedAt: 42, source: 'tvtime' } } });
  // Film déjà présent (à voir) : Vu complet, plus jamais un simple statut terminé.
  assert.deepEqual(buildTvTimeMovieProgress({ seenEpisodes: [], episodeRecords: {} }, null, NOW).episodeRecords, { movie: { watchedAt: NOW, source: 'tvtime' } });
  // Un enregistrement existant (Plex daté) n'est jamais écrasé.
  const plexRecord = { watchedAt: 7, watchedTimeKnown: true, source: 'plex' };
  const kept = buildTvTimeMovieProgress({ seenEpisodes: ['movie'], episodeRecords: { movie: plexRecord } }, 42, NOW);
  assert.equal(kept.episodeRecords.movie, plexRecord);
  assert.deepEqual(kept.seenEpisodes, ['movie']);

  const importer = readFileSync('src/components/CsvImporter.tsx', 'utf8');
  assert.doesNotMatch(importer, /seenEpisodes: \['1x1'\]/);
  assert.doesNotMatch(importer, /updateDoc\(existingDoc\.ref, \{\n\s+status: 'completed',/, 'plus de statut terminé sans Vu');
  assert.match(importer, /\.\.\.buildTvTimeMovieProgress\(showData, task\.dates\?\.movie \?\? null\)/);
  assert.match(importer, /keepLatestTvTimeDate\(movieMap\.get\(mapKey\)!\.dates, 'movie', readTvTimeRowDate\(row\)\)/);
  assert.doesNotMatch(importer, /watchedAt: Date\.now\(\), source: VIEWING_SOURCE_TVTIME/, 'plus de date d’import à la place de la date de l’export');
});
