import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Show } from '../src/types.ts';
import {
  buildProfileProjection,
  buildProfileYearStats,
  collectProfileViewings,
  defaultProfileYear,
  countUndatedProfileViewings,
  formatProfileImportNote,
  formatProfilePunchSlot,
  formatProfileUndatedNote,
  listProfileYearTotals,
  listProfileYears,
  partitionProfileViewings,
} from '../src/features/profile/profileYearStats.ts';
import { buildTieredBadges } from '../src/features/profile/profileDashboard.ts';
import { buildYearInSeries, buildYearHeadline } from '../src/features/profile/profileYearRecap.ts';

const profileSource = readFileSync('src/screens/ProfileScreen.tsx', 'utf8');
const librarySource = readFileSync('src/screens/LibraryScreen.tsx', 'utf8');
const dashboardSource = readFileSync('src/components/ProAnalyticsDashboard.tsx', 'utf8');
const storySource = readFileSync('src/components/ProfileYearStory.tsx', 'utf8');
const moiCss = readFileSync('src/screens/moi.css', 'utf8');

const at = (year: number, month: number, day: number, hour = 21) => new Date(year, month, day, hour, 0, 0).getTime();
const NOW = at(2026, 9, 30, 12);

const show = (overrides: Partial<Show>): Show => ({
  id: 'show',
  userId: 'uid',
  tmdbId: 1,
  title: 'Série',
  mediaType: 'tv',
  posterPath: '/poster.jpg',
  backdropPath: null,
  status: 'watching',
  isArchived: false,
  updatedAt: at(2026, 0, 1),
  createdAt: at(2025, 0, 1),
  seenEpisodes: [],
  episodeRecords: {},
  ...overrides,
});

const episodes = (season: number, from: number, to: number, watchedAt: (episode: number) => number, extra: Record<string, unknown> = {}) => {
  const seenEpisodes: string[] = [];
  const episodeRecords: Show['episodeRecords'] = {};
  for (let episode = from; episode <= to; episode++) {
    seenEpisodes.push(`${season}x${episode}`);
    episodeRecords[`${season}x${episode}`] = { watchedAt: watchedAt(episode), ...extra };
  }
  return { seenEpisodes, episodeRecords };
};

const library = (): Show[] => {
  const saul = episodes(1, 1, 10, episode => at(2026, 9, 1 + episode, 21));
  const breaking = episodes(5, 1, 8, episode => at(2026, 6, episode, 22), { plexImported: true });
  const old = episodes(1, 1, 3, episode => at(2025, 2, episode, 20));
  return [
    show({ id: 'saul', tmdbId: 60059, title: 'Better Call Saul', totalAiredEpisodes: 63, networks: [{ name: 'Netflix' }], ...saul }),
    show({ id: 'bb', tmdbId: 1396, title: 'Breaking Bad', totalAiredEpisodes: 62, networks: [{ name: 'AMC' }], ...breaking }),
    show({ id: 'old', tmdbId: 3, title: 'Ancienne', ...old }),
    show({ id: 'dune', tmdbId: 438631, title: 'Dune', mediaType: 'movie', status: 'completed', seenEpisodes: ['movie'], episodeRecords: { movie: { watchedAt: at(2026, 6, 20, 15), runtime: 155 } } }),
    show({ id: 'avoir', tmdbId: 9, title: 'À voir', mediaType: 'movie', status: 'plan_to_watch', seenEpisodes: [] }),
  ];
};

test('Moi · collecte un visionnage daté par épisode ou film vu, avec la provenance Plex', () => {
  const viewings = collectProfileViewings(library());
  assert.equal(viewings.length, 10 + 8 + 3 + 1);
  assert.ok(viewings.every(viewing => viewing.showId !== 'avoir'), 'un film non vu ne compte pas');
  assert.equal(viewings.find(viewing => viewing.showId === 'dune')?.minutes, 155, 'la durée réelle prime');
  assert.equal(viewings.find(viewing => viewing.showId === 'saul')?.minutes, 45, 'repli 45 min par épisode');
  assert.ok(viewings.filter(viewing => viewing.showId === 'bb').every(viewing => viewing.platform === 'Plex'));
  assert.deepEqual(listProfileYears(viewings, NOW), [2026, 2025]);
  assert.equal(defaultProfileYear(viewings, NOW), 2026);
  assert.equal(defaultProfileYear(viewings.filter(viewing => viewing.showId === 'old'), NOW), 2025);
});

test('Moi · le sélecteur d’année liste les années réelles avec leur temps, sans dates impossibles', () => {
  const shows = [...library(), show({ id: 'clock', title: 'Horloge fausse', seenEpisodes: ['1x1', '1x2'], episodeRecords: { '1x1': { watchedAt: new Date(1999, 5, 1).getTime() }, '1x2': { watchedAt: at(2031, 0, 1) } } })];
  const totals = listProfileYearTotals(collectProfileViewings(shows), NOW);
  assert.deepEqual(totals.map(entry => entry.year), [2026, 2025], '1999 et 2031 ne sont pas proposées');
  assert.equal(totals[0].minutes, 18 * 45 + 155);
  assert.equal(totals[1].minutes, 3 * 45);
  assert.deepEqual(listProfileYearTotals([], NOW), [{ year: 2026, minutes: 0 }]);
  assert.match(dashboardSource, /role="listbox"/);
  assert.match(dashboardSource, /role="option"/);
  assert.doesNotMatch(dashboardSource, /cycleYear/);
});

test('Moi · Chiffres par année : total, mois jusqu’au mois courant, record et plateformes', () => {
  const stats = buildProfileYearStats(collectProfileViewings(library()), 2026, NOW);
  assert.equal(stats.episodes, 18);
  assert.equal(stats.films, 1);
  assert.equal(stats.minutes, 18 * 45 + 155);
  assert.equal(stats.months.length, 10, 'janvier à octobre pour l’année courante');
  assert.equal(stats.months[6], 8 * 45 + 155);
  assert.equal(stats.recordMonth, 6);
  assert.deepEqual(stats.platforms.map(platform => platform.name), ['Netflix', 'Plex'], 'plus de ligne « Autres »');
  assert.equal(stats.unknownPlatformShare, Math.round(155 / stats.minutes * 100), 'le temps sans plateforme connue est annoncé à part');
  assert.equal(stats.monthEpisodes[6], 8);
  assert.equal(stats.monthFilms[6], 1);
  assert.equal(stats.seriesMinutes + stats.filmMinutes, stats.minutes);

  const past = buildProfileYearStats(collectProfileViewings(library()), 2025, NOW);
  assert.equal(past.months.length, 12);
  assert.equal(past.episodes, 3);
});

test('Moi · Quand tu regardes : la semaine en tranches de trois heures, heures inconnues ignorées', () => {
  const shows = library();
  shows.push(show({ id: 'legacy', title: 'Import', seenEpisodes: ['1x1'], episodeRecords: { '1x1': { watchedAt: at(2026, 9, 4, 9), watchedTimeKnown: false } } }));
  const { punch } = buildProfileYearStats(collectProfileViewings(shows), 2026, NOW);
  assert.deepEqual(punch.hours, [0, 3, 6, 9, 12, 15, 18, 21]);
  assert.equal(punch.rows.length, 7);
  assert.ok(punch.rows.every(row => row[3] === 0), 'le visionnage de 9 h sans heure prouvée est ignoré');
  assert.equal(Math.max(...punch.rows.flat()), 1);
  assert.ok(punch.slot);
  assert.equal(punch.slot.fromHour % 3, 0);
  assert.match(formatProfilePunchSlot(punch.slot), /^le [a-z]+, de (\d+ h|minuit) à (\d+ h|minuit)$/);
  assert.equal(formatProfilePunchSlot({ day: 6, fromHour: 21, toHour: 0 }), 'le dimanche, de 21 h à minuit');
  const empty = buildProfileYearStats([], 2026, NOW);
  assert.equal(empty.punch.slot, null);
  assert.equal(empty.recordMonth, null);
});

test('Moi · Mon année : titre de l’année et année en séries, sans film', () => {
  const viewings = collectProfileViewings(library());
  assert.equal(buildYearHeadline(viewings, 2026).lead, 'Better Call Saul');
  assert.equal(buildYearHeadline(viewings, 2026).second, 'Breaking Bad');
  const months = buildYearInSeries(viewings, library(), 2026, NOW);
  assert.deepEqual(months.map(month => month.month), [9, 6]);
  assert.deepEqual(months.map(month => month.title), ['Better Call Saul', 'Breaking Bad']);
  assert.ok(months.every(month => month.title !== 'Dune'), 'jamais de film');
  assert.equal(months[0].tag?.label, 'En cours');
});

test('Moi · projection « tu finis le… » sur les quatre dernières semaines', () => {
  const shows = library();
  const projection = buildProfileProjection(shows, collectProfileViewings(shows), NOW);
  assert.ok(projection);
  assert.equal(projection.title, 'Better Call Saul');
  assert.equal(projection.remaining, 53);
  assert.equal(projection.perWeek, 2.5, 'le rythme affiché est celui qui sert à la date');
  assert.match(projection.finishDate, /^\d{1,2} [a-zéû]+( \d{4})?$/);

  const dropped = shows.map(item => item.id === 'saul' ? { ...item, status: 'dropped' as const } : item);
  assert.equal(buildProfileProjection(dropped, collectProfileViewings(dropped), NOW), null);
});

test('Moi · une journée de plus de 24 h (import TV Time) sort des Chiffres et de Mon année', () => {
  const imported = episodes(1, 1, 300, () => at(2026, 6, 14, 18) + 3, {});
  const shows = [...library(), show({ id: 'import', tmdbId: 77, title: 'Import', ...imported })];
  const { viewings, imports } = partitionProfileViewings(collectProfileViewings(shows));
  assert.equal(imports.length, 1);
  assert.equal(imports[0].count, 300);
  assert.equal(imports[0].minutes, 300 * 45);
  assert.ok(viewings.every(viewing => viewing.showId !== 'import'));
  assert.equal(viewings.length, collectProfileViewings(library()).length, 'les vrais jours restent intacts');
  assert.equal(formatProfileImportNote(imports, 2026), 'Sans l’import du 14 juillet (225 h)');
  assert.equal(formatProfileImportNote(imports, 2025), null);
  assert.equal(buildProfileYearStats(viewings, 2026, NOW).recordMonth, 6, 'juillet reste un vrai mois, sans l’import');
  assert.equal(buildProfileYearStats(viewings, 2026, NOW).months[6], 8 * 45 + 155);

  const busy = partitionProfileViewings(collectProfileViewings([show({ id: 'binge', ...episodes(1, 1, 30, () => at(2026, 8, 1, 20)) })]));
  assert.equal(busy.imports.length, 0, '22 h 30 dans la journée reste un vrai marathon');
});

test('Moi · un film importé sans date de visionnage n’est jamais daté par la synchro des fiches', () => {
  // Import TV Time : film « vu » sans enregistrement, puis document touché par la synchro des fiches en août.
  const imported = show({ id: 'tvtime-film', title: 'Film importé', mediaType: 'movie', status: 'completed', seenEpisodes: ['1x1'], episodeRecords: { '1x1': { watchedAt: at(2026, 6, 14, 18) } }, updatedAt: at(2026, 7, 20), createdAt: at(2026, 6, 14) });
  const undatedEpisode = show({ id: 'undated', title: 'Série sans date', seenEpisodes: ['1x1', '1x2'], episodeRecords: {}, updatedAt: at(2026, 7, 20), lastWatchedAt: at(2026, 7, 20) });
  const watchedInApp = show({ id: 'app-film', title: 'Film vu dans l’app', mediaType: 'movie', status: 'completed', seenEpisodes: ['movie'], episodeRecords: {}, lastWatchedAt: at(2026, 8, 3, 22), updatedAt: at(2026, 9, 1) });
  const viewings = collectProfileViewings([imported, undatedEpisode, watchedInApp]);
  assert.deepEqual(viewings.map(viewing => viewing.showId), ['app-film'], 'seule la dernière action « vu » d’un film date le visionnage');
  assert.equal(new Date(viewings[0].watchedAt).getMonth(), 8);
  assert.equal(countUndatedProfileViewings([imported, undatedEpisode, watchedInApp]), 3);
  assert.equal(formatProfileUndatedNote(3), '3 visionnages sans date ne sont pas comptés (import sans date de visionnage).');
  assert.equal(formatProfileUndatedNote(0), null);
  assert.equal(buildYearInSeries(viewings, [imported, undatedEpisode, watchedInApp], 2026, NOW).length, 0, 'aucun mois fabriqué depuis la synchro');
});

test('Moi · badges à niveaux : palier atteint, prochain palier et progression bornée', () => {
  const badges = buildTieredBadges({ centenaire: 6377, night_owl: 20, big_screen: 112, binge_master: 3 });
  assert.deepEqual(badges.map(badge => badge.title), ['Centenaire', 'Oiseau de nuit', 'Grand écran', 'Binge-Master']);
  assert.deepEqual(badges.map(badge => badge.level), [5, 1, 3, 1]);
  assert.equal(badges[0].detail, `${(6377).toLocaleString('fr-FR')} sur ${(7500).toLocaleString('fr-FR')} vus`);
  assert.equal(badges[1].detail, '20 sur 25 nuits');
  assert.equal(badges[2].detail, '112 sur 150 films');
  assert.equal(badges[3].detail, '3 sur 5 séries finies');
  assert.ok(badges.every(badge => badge.progress >= 0 && badge.progress < 1));
  const first = buildTieredBadges({ centenaire: 8, night_owl: 0, big_screen: 0, binge_master: 0 });
  assert.deepEqual(first.map(badge => badge.level), [0, 0, 0, 0], 'les anciens seuils deviennent le niveau 1');
  const max = buildTieredBadges({ centenaire: 12_000, night_owl: 100, big_screen: 300, binge_master: 30 });
  assert.ok(max.every(badge => badge.progress === 1 && badge.next === null && /palier maximal/.test(badge.detail)));
});

test('Moi · page unique : plus d’onglets, sous-pages avec retour et Réglages derrière la roue', () => {
  assert.match(profileSource, /import '\.\/moi\.css'/);
  assert.match(profileSource, /type ProfilePage = \{ kind: 'home' \}/);
  assert.doesNotMatch(profileSource, /PROFILE_TABS|ProfileTab|moi-seg/);
  assert.match(profileSource, /<MoiYearCard viewings=\{viewings\}/);
  assert.match(profileSource, /<MoiFateRow left=\{fate\.left\.length\}/);
  assert.match(profileSource, /aria-label="Retour à Moi"/);
  assert.match(profileSource, /if \(page\.kind !== 'home'\) backHome\(\);/);
  assert.match(profileSource, /lazy\(\(\) => import\('\.\.\/components\/ProAnalyticsDashboard'\)/);
  assert.match(profileSource, /aria-label="Réglages"/);
  assert.match(profileSource, /hasUpdate && <span className="moi-gear-dot"/);
  assert.match(profileSource, /titres suivis/);
  assert.doesNotMatch(profileSource, /<SeenItLogo/);
  assert.match(moiCss, /\.moi-gear\{[^}]*width:44px;height:44px/);
});

test('Moi · Ma liste en étagères avec filtre par type et grille complète par section', () => {
  assert.match(librarySource, /aria-label="Filtrer Ma liste par type"/);
  assert.match(librarySource, /\[\['all', 'Tout'\], \['tv', 'Séries'\], \['movie', 'Films'\]\]/);
  assert.match(librarySource, /const SHELF_SECTIONS = \['watching', 'toWatchMovie', 'favorites'\] as const;/);
  assert.match(librarySource, />Tout voir</);
  assert.match(librarySource, /<GridMediaCard[\s\S]*showProgress=\{true\}/);
  assert.doesNotMatch(librarySource, /hideBadges=\{true\}/);
  assert.match(moiCss, /\.moi-shelf-item\{width:112px;flex-shrink:0;scroll-snap-align:start;--seenit-media-title:#fff\}/);
  assert.match(moiCss, /\.moi-type-dot\[data-type=tv\]\{background:#4F46E5\}\.moi-type-dot\[data-type=movie\]\{background:#E11D48\}/);
});

test('Moi · Mes chiffres et Mon année gardent un seul or, les données réelles et les personnes', () => {
  assert.match(dashboardSource, /buildProfileYearStats\(viewings, year\)/);
  assert.match(dashboardSource, /scopeProfileViewings\(shows, since\)/);
  assert.match(storySource, /scopeProfileViewings\(shows, since\)/);
  for (const title of ['Heures par mois', 'Tendances', 'Ce que tu regardes', 'Quand tu regardes', 'Où tu regardes', 'Séries laissées en route', 'Tes réactions', 'Tes têtes d’affiche', 'Badges']) assert.ok(dashboardSource.includes(title), title);
  assert.match(dashboardSource, /onPersonClick\?\.\(person\.id\)/);
  assert.doesNotMatch(dashboardSource, /indigo|rose-|emerald|cinephileArchetype/);
  for (const title of ['jour par jour', 'Ton année en séries', 'Films ou séries, mois par mois', 'Ton top de l’année', 'Et maintenant']) assert.ok(storySource.includes(title), title);
  assert.match(storySource, /buildProfileProjection\(shows, viewings, now\)/);
});
