import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Show } from '../src/types.ts';
import type { ProfileViewing } from '../src/features/profile/profileYearStats.ts';
import { buildSeriesFate, countSeriesFatesInYear, summarizeSeriesFate } from '../src/features/profile/profileSeriesFate.ts';
import { buildGenreShares, buildLeadActors, buildProfileInsights, buildProfileReactions, buildProfileRhythm, buildProfileStreaks, buildTypicalDay, buildWeeklyTrend, countNightViewings, leadCastFromDetails } from '../src/features/profile/profileDashboard.ts';
import { buildMediaMonths, buildProfileCalendar, buildProfileYearRecords, buildTopSeries, buildYearInSeries } from '../src/features/profile/profileYearRecap.ts';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const DAY = 86_400_000;
const at = (year: number, month: number, day: number, hour = 21) => new Date(year, month, day, hour, 0).getTime();
const NOW = at(2026, 10, 11, 12);
const TODAY = '2026-11-11';
const series = (id: string, overrides: Partial<Show> = {}, watched: Array<[string, number]> = []): Show => ({
  id, userId: 'u', tmdbId: id.length * 97, title: id, mediaType: 'tv', posterPath: null, backdropPath: null, status: 'watching', isArchived: false,
  createdAt: at(2025, 0, 1), updatedAt: at(2025, 0, 1), seenEpisodes: watched.map(([key]) => key),
  episodeRecords: Object.fromEntries(watched.map(([key, time]) => [key, { watchedAt: time }])),
  totalAiredEpisodes: 20, ...overrides,
});
const next = (season: number, episode: number) => ({ nextEpisodeToWatch: { season_number: season, episode_number: episode, air_date: '2025-01-01', name: 'x' } });
const view = (showId: string, time: number, minutes = 45, mediaType: 'tv' | 'movie' = 'tv', title = showId, timeKnown = true): ProfileViewing =>
  ({ showId, title, posterPath: null, mediaType, season: 1, platform: 'Netflix', watchedAt: time, timeKnown, minutes });

test('SEENIT-PROFILE-002 en pause = 60 jours sans épisode vu, avec la même fonction que l’accueil', () => {
  const ago = (days: number) => NOW - days * DAY;
  const shows = [
    series('recent', next(1, 4), [['1x1', ago(70)], ['1x2', ago(65)], ['1x3', ago(59)]]),
    series('paused', next(1, 4), [['1x1', ago(90)], ['1x2', ago(80)], ['1x3', ago(60)]]),
    series('dropped', { status: 'dropped' }, [['1x1', ago(200)], ['1x2', ago(199)]]),
    series('done', { status: 'completed' }, [['1x1', ago(10)]]),
    series('never', next(1, 1)),
    series('archived', { isArchived: true }, [['1x1', ago(300)]]),
  ];
  const fate = buildSeriesFate(shows, NOW, TODAY);
  const byId = Object.fromEntries(fate.map(entry => [entry.show.id, entry.fate]));
  assert.deepEqual(byId, { recent: 'active', paused: 'paused', dropped: 'dropped', done: 'finished' }, 'jamais commencée et archivée hors liste');
  assert.match(read('src/features/profile/profileSeriesFate.ts'), /import \{ seriesPause \} from '\.\.\/watchlist\/seriesBadges\.ts'/);
  const paused = fate.find(entry => entry.show.id === 'paused')!;
  assert.equal(paused.nextCode, 'S01 | E04');
  assert.equal(paused.remainingEpisodes, 17);
  assert.equal(paused.dropBucket, 'S1');
  assert.equal(fate.find(entry => entry.show.id === 'dropped')!.dropBucket, 'beforeE3');
});

test('SEENIT-PROFILE-002 résumé : presque finies, où tu décroches, point de décrochage, survie au-delà de la saison 1', () => {
  const old = NOW - 100 * DAY;
  const watched = (count: number, season = 1): Array<[string, number]> => Array.from({ length: count }, (_, index) => [`${season}x${index + 1}`, old + index * 1000]);
  const shows = [
    series('almost', { ...next(1, 18), totalAiredEpisodes: 19 }, watched(17)),
    series('s2', { ...next(2, 3) }, [...watched(10), ['2x1', old], ['2x2', old]]),
    series('quit', { status: 'dropped' }, watched(2)),
  ];
  const summary = summarizeSeriesFate(buildSeriesFate(shows, NOW, TODAY));
  assert.deepEqual(summary.nearlyDone.map(entry => entry.show.id), ['almost']);
  assert.deepEqual(summary.buckets.map(bucket => [bucket.key, bucket.count]), [['beforeE3', 1], ['S1', 1], ['S2', 1], ['S3plus', 0]]);
  assert.equal(summary.dropPoint, 12, 'médiane des épisodes vus des séries laissées');
  assert.equal(summary.survival, null, 'la phrase de survie attend dix séries passées en saison 2');
  assert.equal(summary.left.length, 3);
  const counts = countSeriesFatesInYear(buildSeriesFate(shows, NOW, TODAY), [view('almost', at(2026, 7, 1)), view('quit', at(2025, 3, 1))], 2026);
  assert.deepEqual(counts, { finished: 0, active: 0, paused: 1, dropped: 0, total: 1 });
});

test('SEENIT-PROFILE-003 rythme, journée type, jours d’affilée et douze semaines', () => {
  const viewings: ProfileViewing[] = [];
  for (let day = 1; day <= 56; day++) viewings.push(view('a', NOW - day * DAY, day <= 28 ? 60 : 45));
  const rhythm = buildProfileRhythm(viewings, NOW);
  assert.equal(rhythm.recentMinutes, 27 * 60, 'la fenêtre se termine à la fin du jour courant');
  assert.equal(rhythm.change !== null && rhythm.change > 0, true);
  assert.equal(buildProfileRhythm(viewings.slice(0, 5), NOW).change, null, 'moins de dix visionnages : pas de variation');
  assert.deepEqual(buildTypicalDay([view('a', at(2026, 1, 1)), view('b', at(2026, 1, 1)), view('a', at(2026, 1, 2), 30)]), { minutes: 60, titles: 2, days: 2 });
  const streaks = buildProfileStreaks([view('a', NOW - DAY), view('a', NOW - 2 * DAY), view('a', NOW - 10 * DAY), view('a', NOW - 11 * DAY), view('a', NOW - 12 * DAY)], NOW);
  assert.equal(streaks.current, 2, 'la suite peut finir hier');
  assert.equal(streaks.record, 3);
  const weeks = buildWeeklyTrend(viewings, NOW);
  assert.equal(weeks.length, 12);
  assert.equal(weeks[11].minutes, 7 * 60 - 60, 'la dernière semaine compte aujourd’hui');
});

test('SEENIT-PROFILE-003 constats nets seulement, genres en part du temps et réactions', () => {
  const viewings: ProfileViewing[] = [];
  for (let day = 1; day <= 60; day++) viewings.push(view(`f${day}`, NOW - day * DAY, 110, 'movie'));
  for (let day = 61; day <= 180; day++) viewings.push(view('s', NOW - day * DAY, 110, 'tv'));
  const genreOf = (id: string) => id.startsWith('f') ? 'Thriller' : 'Drame';
  const insights = buildProfileInsights(viewings, NOW, genreOf);
  assert.deepEqual(insights.map(insight => insight.id), ['films', 'genre']);
  assert.equal(insights[0].value, '+99 pts', 'le soixantième jour passé tombe dans la fenêtre d’avant');
  assert.equal(insights[1].title, 'Thriller monte');
  const shares = buildGenreShares(viewings.filter(viewing => new Date(viewing.watchedAt).getFullYear() === 2026), NOW, genreOf);
  assert.deepEqual(shares.map(share => share.name), ['Drame', 'Thriller']);
  assert.equal(shares.find(share => share.name === 'Thriller')?.trend, 'up');
  const reacted = series('r', {}, Array.from({ length: 10 }, (_, index) => [`1x${index + 1}`, NOW]));
  for (const [index, key] of Object.keys(reacted.episodeRecords).entries()) reacted.episodeRecords[key].emotion = index < 6 ? 'adore' : index < 9 ? 'bien' : 'bof';
  assert.deepEqual(buildProfileReactions([reacted])?.counts, { adore: 6, bien: 3, bof: 1 });
  reacted.episodeRecords['1x10'].emotion = '';
  assert.equal(buildProfileReactions([reacted]), null, 'section absente sous dix épisodes notés');
});

test('SEENIT-PROFILE-003 têtes d’affiche : trois premiers rôles, classés au temps ; nuits pour Oiseau de nuit', () => {
  const lead = (id: number) => ({ id, name: `P${id}`, profile_path: null });
  const shows = [series('a', { isFavorite: true }), series('b'), series('c')];
  const leads = buildLeadActors([view('a', NOW, 300), view('b', NOW, 120), view('c', NOW, 60)], shows, show => show.id === 'a' ? [lead(1), lead(2), lead(3), lead(4)] : show.id === 'b' ? [lead(2), lead(5)] : [lead(6)]);
  assert.deepEqual(leads.map(person => [person.id, person.minutes, person.titles, person.favorites]), [[2, 420, 2, 1], [1, 300, 1, 1], [3, 300, 1, 1]]);
  assert.ok(!leads.some(person => person.id === 4), 'le quatrième rôle n’est pas une tête d’affiche');
  assert.deepEqual(leadCastFromDetails({ credits: { cast: [{ id: 9, name: 'B', order: 1 }, { id: 8, name: 'A', order: 0 }] } }, 'movie')?.map(person => person.id), [8, 9]);
  assert.equal(countNightViewings([view('a', at(2026, 1, 1, 23)), view('a', at(2026, 1, 2, 2)), view('a', at(2026, 1, 3, 21)), view('a', at(2026, 1, 4, 23), 45, 'tv', 'a', false)]), 1, 'une nuit s’étend sur minuit, heure inconnue ignorée');
});

test('SEENIT-PROFILE-004 calendrier, records, année en séries sans film, films ou séries et top', () => {
  const viewings = [
    ...Array.from({ length: 7 }, (_, index) => view('lioness', at(2026, 8, 6, 20 + (index % 3)), 45, 'tv', 'Lioness')),
    view('lioness', at(2026, 8, 7)), view('lioness', at(2026, 8, 8)),
    view('dune', at(2026, 8, 6), 166, 'movie', 'Dune'),
    view('micro', at(2026, 6, 1), 45, 'tv', 'Au micro !'),
    view('micro', at(2026, 8, 20), 45, 'tv', 'Au micro !'),
  ];
  const calendar = buildProfileCalendar(viewings, 2026, NOW);
  assert.equal(calendar.months.length, 12);
  assert.equal(calendar.months[8].days[5].level, 4, 'journée record');
  assert.equal(calendar.months[11].days[0].future, true);
  assert.equal(calendar.record?.films, 1);
  const records = buildProfileYearRecords(viewings, 2026);
  assert.equal(records.month?.month, 8);
  assert.equal(records.streak?.length, 3);
  assert.deepEqual([records.marathon?.title, records.marathon?.episodes], ['Lioness', 7]);
  assert.equal(records.pause?.days, 66);
  const months = buildYearInSeries(viewings, [series('lioness', { status: 'completed' })], 2026, NOW);
  assert.deepEqual(months.map(month => [month.month, month.title]), [[8, 'Lioness'], [6, 'Au micro !']]);
  assert.equal(months[0].tag?.label, 'Marathon · 7 épisodes en un jour');
  assert.ok(!months.some(month => month.title === 'Dune'));
  const media = buildMediaMonths(viewings, 2026, NOW);
  assert.equal(media.series.length, 11);
  assert.equal(media.films[8], 166);
  assert.deepEqual(buildTopSeries(viewings, 2026).map(entry => entry.title), ['Lioness', 'Au micro !']);
});

test('SEENIT-PROFILE-005 animations une fois à l’entrée, sur transform et opacity seulement, coupées en mouvement réduit', () => {
  const css = read('src/screens/moi.css');
  const keyframes = [...css.matchAll(/@keyframes moi\w+\{([^@]*?)\}\}/g)].map(match => match[1]);
  assert.ok(keyframes.length >= 8);
  for (const frames of keyframes) assert.doesNotMatch(frames, /width|height|top|left|margin|box-shadow|text-shadow|filter|stroke/, frames);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.moi-reveal,\.moi-reveal \*,\.moi-dial \*/);
  const reveal = read('src/components/profile/useReveal.ts');
  assert.match(reveal, /\{ threshold: 0\.12 \}/);
  assert.match(reveal, /observer\.disconnect\(\)/);
  assert.match(reveal, /cancelAnimationFrame\(frame\)/);
  const dial = read('src/components/profile/MonthDial.tsx');
  assert.match(dial, /aria-pressed=\{picked === month\}/);
  assert.match(dial, /setPicked\(current => current === month \? null : month\)/);
  assert.match(css, /\.moi-dial-month\[data-state=current\]\{color:#fff;background:rgba\(229,169,61,\.16\);box-shadow:inset 0 0 0 1\.5px #E5A93D\}/);
  assert.doesNotMatch(read('src/components/profile/SeriesFateScreen.tsx'), /moi-reveal|moi-pop|moi-grow|moi-glow/, 'aucune animation sur Séries laissées en route');
});
