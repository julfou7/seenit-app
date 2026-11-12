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
  const shows = [series('a', { isFavorite: true }), series('b'), series('c'), series('d')];
  const leads = buildLeadActors([view('a', NOW, 300), view('b', NOW, 120), view('c', NOW, 60), view('d', NOW, 30)], shows, show => show.id === 'a' ? [lead(1), lead(2), lead(3), lead(4)] : show.id === 'b' ? [lead(2), lead(5)] : show.id === 'c' ? [lead(6)] : [lead(7)]);
  assert.deepEqual(leads.map(person => [person.id, person.minutes, person.titles, person.favorites]), [[2, 420, 2, 1], [6, 60, 1, 0], [7, 30, 1, 0]], 'nombre de titres d’abord, puis une personne par série nouvelle');
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
  const dashboard = read('src/components/ProAnalyticsDashboard.tsx');
  assert.match(dashboard, /const \{ data, loading, contributions \} = useProAnalytics\(shows, libraryReady\)/);
  assert.match(dashboard, /contributions\?\.\[getProfileAnalyticsMediaKey\(show\)\]\?\.value/, 'genres et têtes d’affiche sur tous les titres vus (revue Codex #944)');
  assert.match(read('src/hooks/useProAnalytics.ts'), /return \{ data, loading, contributions \};/);
  assert.match(dial, /left: `\$\{\(x \/ 322 \* 100\)\.toFixed\(2\)\}%`/, 'les mois suivent un cadran rétréci (revue Codex #944)');
  assert.match(css, /\.moi-dial\{position:relative;width:min\(322px,100%\);aspect-ratio:1\}/);
  assert.match(read('src/screens/ProfileScreen.tsx'), /next\.kind !== 'home' && pageRef\.current\.kind === 'home'\) homeScroll\.current/, 'la position de Moi survit à un passage entre deux sous-pages');
  assert.match(css, /\.moi-dial-month\[data-state=current\]\{color:#fff;background:rgba\(229,169,61,\.16\);box-shadow:inset 0 0 0 1\.5px #E5A93D\}/);
  assert.doesNotMatch(read('src/components/profile/SeriesFateScreen.tsx'), /moi-reveal|moi-pop|moi-grow|moi-glow/, 'aucune animation sur Séries laissées en route');
});

test('SEENIT-PROFILE-003 retour terrain v1.4.291 : grille sur les heures Plex, têtes d’affiche variées, badges statiques', async () => {
  const { buildProfileYearStats, PROFILE_PUNCH_PLEX_MIN } = await import('../src/features/profile/profileYearStats.ts');
  const morningMarks = Array.from({ length: 30 }, (_, index) => ({ ...view('a', at(2026, 1, 1 + index, 8)) }));
  const plexEvenings = Array.from({ length: PROFILE_PUNCH_PLEX_MIN }, (_, index) => ({ ...view('b', at(2026, 2, 1 + index, 22)), plexTime: true }));
  const withPlex = buildProfileYearStats([...morningMarks, ...plexEvenings], 2026, NOW).punch;
  assert.equal(withPlex.source, 'plex');
  assert.equal(withPlex.slot?.fromHour, 21, 'les Vu marqués le matin ne déplacent plus le créneau');
  const marksOnly = buildProfileYearStats([...morningMarks, ...plexEvenings.slice(1)], 2026, NOW).punch;
  assert.equal(marksOnly.source, 'mark', 'sous vingt lectures Plex, la grille dit qu’elle montre l’heure des Vu');
  const lead = (id: number) => ({ id, name: `P${id}`, profile_path: null });
  const shows = [series('lioness'), series('avatar'), series('lupin'), series('saul')];
  const leads = buildLeadActors([view('lioness', NOW, 900), view('avatar', NOW, 160), view('lupin', NOW, 120), view('saul', NOW, 60)], shows,
    show => show.id === 'lioness' ? [lead(1), lead(2), lead(3)] : show.id === 'avatar' ? [lead(1), lead(4)] : show.id === 'lupin' ? [lead(5)] : [lead(6)]);
  assert.deepEqual(leads.map(person => person.id), [1, 5, 6], 'une seule personne par série déjà représentée');
  assert.deepEqual(buildLeadActors([view('lioness', NOW, 900)], [series('lioness')], () => [lead(1), lead(2), lead(3)]).map(person => person.id), [1], 'une seule série vue : une tête d’affiche, jamais le repli global (revue Codex #948)');
  assert.deepEqual(buildLeadActors([], [], () => null), []);
  const dashboard = read('src/components/ProAnalyticsDashboard.tsx');
  assert.match(dashboard, /<div key=\{badge\.id\} className="moi-badge">/);
  assert.doesNotMatch(dashboard, /closestBadge/);
  assert.match(dashboard, /stats\.punch\.source === 'plex' \? 'heures de lecture Plex' : 'heure des Vu'/);
  assert.match(read('src/screens/moi.css'), /\.moi-root \.home-load-more:last-child\{margin-bottom:8px\}/);
});

test('SEENIT-PROFILE-004 retour terrain v1.4.291 : top de l’année avec affiche, part du temps séries et écart au premier', () => {
  const top = buildTopSeries([view('a', at(2026, 1, 1), 300, 'tv', 'A'), view('a', at(2026, 1, 2), 300, 'tv', 'A'), view('b', at(2026, 1, 3), 400, 'tv', 'B'), view('f', at(2026, 1, 4), 500, 'movie', 'F')], 2026);
  assert.deepEqual(top.map(entry => [entry.title, entry.share, Math.round(entry.relative * 100)]), [['A', 60, 100], ['B', 40, 67]]);
  assert.match(read('src/components/ProfileYearStory.tsx'), /% de ton temps séries/);
});

test('SEENIT-PROFILE-002 retour terrain v1.4.292 : une série finie archivée compte comme terminée', () => {
  const shows = [
    series('archived-done', { isArchived: true, status: 'completed' }, [['1x1', NOW - 20 * DAY]]),
    series('archived-ended', { isArchived: true, tmdbStatus: 'Ended', totalAiredEpisodes: 2, nextEpisodeToWatch: null }, [['1x1', NOW - 20 * DAY], ['1x2', NOW - 19 * DAY]]),
    series('archived-left', { isArchived: true, ...next(1, 2) }, [['1x1', NOW - 20 * DAY]]),
  ];
  const byId = Object.fromEntries(buildSeriesFate(shows, NOW, TODAY).map(entry => [entry.show.id, entry.fate]));
  assert.equal(byId['archived-done'], 'finished');
  assert.equal(byId['archived-left'], undefined, 'une série archivée non finie reste hors du devenir');
  // Revue Codex #949 : archivée et terminée chez TMDB, mais un épisode sur vingt seulement : pas terminée.
  const partial = buildSeriesFate([series('archived-partial', { isArchived: true, tmdbStatus: 'Ended', nextEpisodeToWatch: null }, [['1x1', NOW - 20 * DAY]])], NOW, TODAY);
  assert.equal(partial.length, 0);
  assert.equal(byId['archived-ended'], 'finished');
});

test('SEENIT-PROFILE-006 chiffres depuis l’inscription, sans rattrapage marqué d’un coup ni faux marathon', async () => {
  const { scopeProfileViewings, formatProfileScopeNote, findProfileCatchUps } = await import('../src/features/profile/profileYearStats.ts');
  const since = at(2026, 6, 3, 15);
  const bulkAt = at(2026, 6, 4, 10);
  // Série vue par le passé, marquée en entier le lendemain de l'inscription : seize épisodes à quelques secondes d'écart.
  const bulk = series('passe', {}, Array.from({ length: 16 }, (_, index) => [`1x${index + 1}`, bulkAt + index * 2_000] as [string, number]));
  // Vraie soirée : trois épisodes à 45 minutes d'écart.
  const binge = series('soiree', {}, [['1x1', at(2026, 8, 5, 21)], ['1x2', at(2026, 8, 5, 21) + 45 * 60_000], ['1x3', at(2026, 8, 5, 21) + 90 * 60_000]]);
  // Lecture Plex datée avant l'inscription.
  const before = series('avant', {}, [['1x1', at(2025, 2, 1)]]);
  const scope = scopeProfileViewings([bulk, binge, before], since);
  assert.equal(scope.catchUp.count, 16);
  assert.equal(scope.beforeSince, 1);
  assert.deepEqual([...new Set(scope.viewings.map(viewing => viewing.showId))], ['soiree']);
  assert.equal(scope.since, new Date(since).setHours(0, 0, 0, 0), 'le jour de l’inscription compte en entier');
  const records = buildProfileYearRecords(scope.viewings, 2026);
  assert.equal(records.marathon?.title, 'soiree', 'le rattrapage n’est jamais un marathon');
  assert.equal(records.marathon?.episodes, 3);
  assert.equal(formatProfileScopeNote(scope, 2026), 'Depuis ton inscription le 3 juillet 2026 · sans 16 épisodes marqués d’un coup');
  assert.equal(formatProfileScopeNote({ ...scope, catchUp: { count: 0, minutes: 0 } }, 2025), null);
  // Deux épisodes rapprochés ne suffisent pas, les films ne sont jamais groupés.
  const pair = [view('a', bulkAt), view('a', bulkAt + 1_000), view('m1', bulkAt, 110, 'movie'), view('m2', bulkAt, 110, 'movie'), view('m3', bulkAt, 110, 'movie')];
  assert.equal(findProfileCatchUps(pair).size, 0);
  // Revue Codex #949 : sans heure connue, pas de rafale ; une journée d'import se lit avant les rafales.
  const noon = [1, 2, 3].map(index => ({ ...view('jour', at(2026, 8, 1, 12)), season: index, timeKnown: false }));
  assert.equal(findProfileCatchUps(noon).size, 0);
  const importAt = at(2026, 8, 10, 9);
  const imported = series('import', {}, Array.from({ length: 30 }, (_, index) => [`1x${index + 1}`, importAt + index * 1_000] as [string, number]));
  const film = (id: string): Show => ({ ...series(id, { mediaType: 'movie', status: 'completed' }), seenEpisodes: ['movie'], episodeRecords: { movie: { watchedAt: importAt + 60_000 } } });
  const mixed = scopeProfileViewings([imported, film('f1'), film('f2')], since);
  assert.equal(mixed.imports.length, 1);
  assert.equal(mixed.viewings.length, 0, 'les films de la journée d’import sortent avec elle');
  // Sans date d'inscription connue, rien n'est coupé avant.
  assert.equal(scopeProfileViewings([before], null).viewings.length, 1);
  // Les écrans de chiffres passent tous par la même portée, bornée par la date de création du compte.
  for (const path of ['src/components/ProAnalyticsDashboard.tsx', 'src/components/ProfileYearStory.tsx', 'src/screens/ProfileScreen.tsx']) assert.match(read(path), /scopeProfileViewings\(shows, since\)/);
  assert.match(read('src/screens/ProfileScreen.tsx'), /metadata\?\.creationTime/);
});

test('SEENIT-PROFILE-003 retour terrain v1.4.293 : cadran sans chevauchement, secteurs touchables', async () => {
  const { MONTH_DIAL, monthDialLabelClearance, monthDialSectorReach } = await import('../src/components/profile/monthDialGeometry.ts');
  // Le secteur le plus grand, détaché et en plein rebond, reste sous le coin intérieur d'une étiquette en diagonale.
  assert.ok(monthDialSectorReach() + 2 <= monthDialLabelClearance(), `${monthDialSectorReach()} contre ${monthDialLabelClearance()}`);
  assert.ok(MONTH_DIAL.hitRadius < monthDialLabelClearance(), 'la zone de toucher d’un secteur ne passe pas sous les étiquettes');
  assert.ok(Math.max(...MONTH_DIAL.guides) <= MONTH_DIAL.inner + MONTH_DIAL.maxGrowth);
  const dial = read('src/components/profile/MonthDial.tsx');
  assert.match(dial, /className="moi-dial-hit"[^>]*onClick=\{\(\) => setPicked\(current => current === month \? null : month\)\}/);
  const css = read('src/screens/moi.css');
  assert.match(css, /\.moi-dial-month\[aria-pressed=true\]\{background:#E5A93D;color:#000;box-shadow:none\}/, 'l’étiquette choisie ne grossit plus');
  assert.match(css, /\.moi-dial-hit\{fill:transparent;pointer-events:all;cursor:pointer/);
});

test('SEENIT-PROFILE-006 retour terrain v1.4.293 : les chiffres partent du premier import quand il suit la création du compte', async () => {
  const { scopeProfileViewings, formatProfileScopeNote } = await import('../src/features/profile/profileYearStats.ts');
  const signup = at(2026, 2, 25, 10);
  const importAt = at(2026, 6, 14, 9);
  // Bibliothèque chargée le 14 juillet : 40 épisodes datés de l'import, plus un historique Plex de mars à juin.
  const imported = series('bib', {}, Array.from({ length: 40 }, (_, index) => [`1x${index + 1}`, importAt + index * 1_000] as [string, number]));
  const plexBefore = series('plex', {}, [['1x1', at(2026, 3, 2)], ['1x2', at(2026, 4, 9)], ['1x3', at(2026, 5, 20)]]);
  for (const record of Object.values(plexBefore.episodeRecords || {})) (record as { plexImported?: boolean }).plexImported = true;
  const after = series('apres', {}, [['1x1', at(2026, 7, 2)]]);
  const scope = scopeProfileViewings([imported, plexBefore, after], signup);
  assert.equal(scope.sinceSource, 'import');
  assert.equal(scope.since, new Date(importAt).setHours(0, 0, 0, 0));
  assert.deepEqual(scope.viewings.map(viewing => viewing.showId), ['apres']);
  assert.equal(scope.beforeSince, 3);
  assert.equal(formatProfileScopeNote(scope, 2026), 'Depuis ton arrivée sur SeenIt le 14 juillet 2026 (premier import)');
  // Revue Codex #952 : des Vu marqués dans l'app avant la grosse journée prouvent l'usage ; c'est un rattrapage tardif.
  const marked = series('marques', {}, [['1x1', at(2026, 0, 10)], ['1x2', at(2026, 1, 12)], ['1x3', at(2026, 2, 26)]]);
  const late = scopeProfileViewings([marked, imported], at(2026, 0, 2));
  assert.equal(late.sinceSource, 'signup');
  assert.equal(late.viewings.length, 3, 'l’historique antérieur au rattrapage reste compté');
  // Sans import, la création du compte reste la borne.
  const plain = scopeProfileViewings([plexBefore, after], signup);
  assert.equal(plain.sinceSource, 'signup');
  assert.equal(plain.viewings.length, 4);
});

test('SEENIT-PROFILE-001 retour terrain v1.4.293 : trois sections ou moins défilent toutes en étagère, alignées sur la marge', () => {
  const library = read('src/screens/LibraryScreen.tsx');
  assert.match(library, /const LIBRARY_ALL_SHELVES_MAX = 3;/);
  assert.match(library, /const allShelves = typedSections\.length <= LIBRARY_ALL_SHELVES_MAX;/);
  assert.match(library, /const rowSections = allShelves \? \[\] : /);
  assert.match(library, /\{shelfSections\.map\(section => \(/);
  assert.match(read('src/screens/moi.css'), /\.moi-shelf-rail\{[^}]*padding:4px 16px 2px;scroll-padding-inline:16px;scroll-snap-type:x proximity/);
});

test('SEENIT-PROFILE-003 retour terrain v1.4.294 : douze mois glissants par défaut et mois sous les tendances', async () => {
  const { buildProfileRollingStats, profileRollingMonthYears, profileRollingWindowStart } = await import('../src/features/profile/profileYearStats.ts');
  const now = at(2026, 10, 12, 8);
  assert.equal(profileRollingWindowStart(now), new Date(2025, 11, 1).getTime(), 'de décembre 2025 à novembre 2026');
  assert.deepEqual(profileRollingMonthYears(now), [2026, 2026, 2026, 2026, 2026, 2026, 2026, 2026, 2026, 2026, 2026, 2025]);
  const stats = buildProfileRollingStats([view('a', at(2025, 11, 20)), view('a', at(2026, 10, 2)), view('a', at(2025, 10, 20))], now);
  assert.equal(stats.months.length, 12);
  assert.equal(stats.months[11], 45, 'décembre 2025 reste à sa place de décembre');
  assert.equal(stats.months[10], 45, 'novembre 2026 seulement, pas novembre 2025');
  assert.equal(stats.minutes, 90);
  // Revue Codex #953 : un visionnage d'aujourd'hui sans heure (midi par défaut) compte dès le matin ; demain, jamais.
  const morning = at(2026, 10, 12, 8);
  const noonUnknown = view('b', at(2026, 10, 12, 12), 100, 'movie', 'b', false);
  const tomorrowUnknown = view('c', at(2026, 10, 13, 12), 100, 'movie', 'c', false);
  assert.equal(buildProfileRollingStats([noonUnknown, tomorrowUnknown], morning).minutes, 100);
  const dashboard = read('src/components/ProAnalyticsDashboard.tsx');
  assert.match(dashboard, /const rolling = pickedYear === null \|\|/);
  assert.match(dashboard, /periodLabel=\{rolling \? 'sur 12 mois' : undefined\}/);
  assert.match(dashboard, /<span>12 derniers mois<\/span>/);
  assert.match(dashboard, /className="moi-week-months"/);
  assert.match(read('src/components/profile/MonthDial.tsx'), /monthYears && monthYears\[month\] !== year/);
});
