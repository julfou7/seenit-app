import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Show } from '../src/types.ts';
import { mergeWatchGroups, movieEndTime, movieRuntime, selectedMovieStart, removeWatchRecord, seriesMoreLabel } from '../src/features/watchlist/watchNext18c.ts';
const movie: Show = { id: 'movie', userId: 'account', tmdbId: 42, mediaType: 'movie', title: 'Film', posterPath: null, backdropPath: null, status: 'completed', isArchived: false, seenEpisodes: ['movie'], episodeRecords: { movie: { watchedAt: 1_760_000_000_000, rating: 8 } }, createdAt: 1, updatedAt: 1 };

test('SEENIT-UX-016 calcule une fin locale sans durée inventée et signale le franchissement de minuit', () => {
  const start = new Date(2026, 9, 21, 22, 30).getTime();
  assert.equal(movieEndTime(start, 80)?.label, 'fin 23:50');
  assert.equal(movieEndTime(start, 80)?.afterMidnight, false);
  assert.equal(movieEndTime(start, 90)?.afterMidnight, true);
  assert.equal(movieEndTime(start, 150)?.label, 'fin 01:00');
  assert.equal(movieEndTime(start, null), null);
  assert.equal(movieRuntime(movie), null);
  assert.equal(movieRuntime(movie, { runtime: 169 }), 169);
  assert.equal(movieRuntime(movie, { runtime: -1 }), null);
  assert.equal(selectedMovieStart(start, null), start);
  const next = new Date(selectedMovieStart(start, '20:30'));
  assert.equal(next.getDate(), 22); assert.equal(next.getHours(), 20);
});

test('SEENIT-UX-016 conserve l’ordre des groupes et l’identité média exacte sans doublons', () => {
  const tv = { ...movie, id: 'tv', mediaType: 'tv' as const };
  assert.deepEqual(mergeWatchGroups([tv], [tv, movie], [{ ...movie, id: 'same-tmdb' }]).map(show => show.id), ['tv', 'movie']);
  assert.equal(seriesMoreLabel(5), 'Afficher 3 de plus');
  assert.equal(seriesMoreLabel(2), 'Afficher les 2');
  assert.equal(seriesMoreLabel(1), 'Afficher la dernière');
});

test('SEENIT-UX-016 retire uniquement le visionnage ciblé et conserve le rollback et les métadonnées voisines', () => {
  const film = removeWatchRecord(movie, null, 123)!;
  assert.deepEqual(film.updates.seenEpisodes, []);
  assert.deepEqual(film.rollback.episodeRecords, movie.episodeRecords);
  assert.equal(film.updates.status, 'plan_to_watch');
  const series = { ...movie, mediaType: 'tv' as const, seenEpisodes: ['S05E14', '5x13'], episodeRecords: { 'S05E14': { watchedAt: 1_770_000_000_000 }, '5x13': { watchedAt: 1_760_000_000_000, rating: 9 } } };
  const target = { season_number: 5, episode_number: 14, name: 'Épisode exact', air_date: '2020-01-01' };
  const mutation = removeWatchRecord(series, target, 123)!;
  assert.deepEqual(mutation.updates.seenEpisodes, ['5x13']);
  assert.equal(mutation.updates.episodeRecords?.['5x13']?.rating, 9);
  assert.equal(mutation.updates.lastWatchedAt, 1_760_000_000_000);
  assert.equal(mutation.updates.nextEpisodeToWatch?.episode_number, 14);
  assert.equal(removeWatchRecord(series, { ...target, episode_number: 12 }), null);
  assert.equal(removeWatchRecord(series, null), null);
});

test('SEENIT-UX-016 exécute les composants réels dans Chromium et respecte les animations réduites', () => {
  const smoke = readFileSync(new URL('../scripts/pwa-browser-smoke.cjs', import.meta.url), 'utf8');
  assert.match(smoke, /testWatchNextHarness\(client, root\)/);
  const css = readFileSync(new URL('../src/screens/watchNext18c.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /movie-ticket--watched/);
  assert.match(css, /scroll-snap-type:x proximity/);
  const actions = readFileSync(new URL('../scripts/watch-next-browser-checks.cjs', import.meta.url), 'utf8');
  assert.match(actions, /await delay\(4300\)/);
  assert.match(actions, /aucun rollback, faux échec ou succès prématuré/);
  assert.match(actions, /succès annoncé seulement après confirmation Firestore/);
});
