import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Show } from '../src/types.ts';
import {
  buildProfileBadges,
  buildProfileProjection,
  buildProfileYearStats,
  buildProfileYearStory,
  collectProfileViewings,
  defaultProfileYear,
  formatProfileImportNote,
  formatProfilePunchSlot,
  listProfileYearTotals,
  listProfileYears,
  partitionProfileViewings,
} from '../src/features/profile/profileYearStats.ts';

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
  assert.deepEqual(stats.platforms.map(platform => platform.name), ['Netflix', 'Plex', 'Autres']);
  assert.equal(stats.platforms.reduce((sum, platform) => sum + platform.minutes, 0), stats.minutes);

  const past = buildProfileYearStats(collectProfileViewings(library()), 2025, NOW);
  assert.equal(past.months.length, 12);
  assert.equal(past.episodes, 3);
});

test('Moi · Quand tu regardes ignore les heures inconnues et nomme le créneau', () => {
  const shows = library();
  shows.push(show({ id: 'legacy', title: 'Import', seenEpisodes: ['1x1'], episodeRecords: { '1x1': { watchedAt: at(2026, 9, 4, 9), watchedTimeKnown: false } } }));
  const { punch } = buildProfileYearStats(collectProfileViewings(shows), 2026, NOW);
  assert.equal(punch.hours.length, 8);
  assert.equal(punch.rows.length, 7);
  assert.ok(!punch.hours.includes(9) || punch.rows.every(row => row[punch.hours.indexOf(9)] === 0));
  assert.ok(punch.slot);
  assert.match(formatProfilePunchSlot(punch.slot), /^[a-z]+, \d+ h – \d+ h$/);
  assert.equal(Math.max(...punch.rows.flat()), 1);

  assert.equal(punch.startHour, 15, 'la fenêtre couvre aussi le film vu à 15 h');
  const evening = buildProfileYearStats(collectProfileViewings([library()[0]]), 2026, NOW).punch;
  assert.equal(evening.startHour, 18, 'à égalité, la fenêtre de soirée 18 h – 2 h est retenue');

  const empty = buildProfileYearStats([], 2026, NOW);
  assert.equal(empty.punch.startHour, 18);
  assert.equal(empty.punch.slot, null);
  assert.equal(empty.recordMonth, null);
});

test('Moi · Mon année raconte les mois récents d’abord et détecte une série de jours', () => {
  const story = buildProfileYearStory(collectProfileViewings(library()), 2026);
  assert.ok(story);
  assert.equal(story.headline, 'L’année Better Call Saul, puis Breaking Bad.');
  assert.deepEqual(story.months.map(month => month.month), [9, 6]);
  assert.equal(story.months[0].title, 'Better Call Saul · 10 épisodes');
  assert.equal(story.months[0].event, 'Record · 10 jours d’affilée');
  assert.equal(story.months[1].title, 'Breaking Bad · 8 épisodes');
  assert.equal(story.months[1].share, 1);
  assert.equal(buildProfileYearStory([], 2026), null);
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

test('Moi · badges : mêmes seuils historiques, progression bornée', () => {
  const badges = buildProfileBadges({ totalMinutes: 300, totalEpisodesSeen: 8, totalMoviesSeen: 0, completedTvCount: 0 });
  assert.deepEqual(badges.map(badge => badge.title), ['Centenaire', 'Oiseau de nuit', 'Grand écran', 'Binge-Master']);
  assert.deepEqual(badges.map(badge => badge.unlocked), [false, false, false, false]);
  assert.equal(badges[0].detail, '8 / 100 vus');
  assert.ok(badges.every(badge => badge.progress >= 0 && badge.progress < 1));

  const unlocked = buildProfileBadges({ totalMinutes: 30_000, totalEpisodesSeen: 418, totalMoviesSeen: 54, completedTvCount: 6 });
  assert.ok(unlocked.every(badge => badge.unlocked && badge.progress === 1));
  assert.equal(unlocked[2].detail, '54 films');
  assert.equal(unlocked[3].detail, '6 séries finies');
});

test('Moi · onglet en trois sous-vues, Ma liste par défaut et Réglages derrière la roue', () => {
  assert.match(profileSource, /import '\.\/moi\.css'/);
  assert.match(profileSource, /type ProfileTab = 'library' \| 'stats' \| 'year'/);
  assert.match(profileSource, /\['library', 'Ma liste'\], \['stats', 'Chiffres'\], \['year', 'Mon année'\]/);
  assert.match(profileSource, /useState<ProfileTab>\('library'\)/);
  assert.match(profileSource, /aria-label="Réglages"/);
  assert.match(profileSource, /hasUpdate && <span className="moi-gear-dot"/);
  assert.match(profileSource, /titres suivis/);
  assert.match(profileSource, /<Activity mode=\{profileContentVisible && activeTab === 'year' \? 'visible' : 'hidden'\}>/);
  assert.doesNotMatch(profileSource, /<SeenItLogo/);
  assert.match(moiCss, /\.moi-gear\{[^}]*width:44px;height:44px/);
  assert.match(moiCss, /\.moi-seg button\[aria-pressed=true\]\{background:#E5A93D;color:#000/);
});

test('Moi · Ma liste en pastilles comptées et grille unique des cartes habituelles', () => {
  assert.match(librarySource, /className="moi-chips" role="group"/);
  assert.match(librarySource, /aria-pressed=\{selected\}/);
  assert.match(librarySource, /<span className="moi-chip-count">\{section\.data\.length\}<\/span>/);
  assert.match(librarySource, /<GridMediaCard[\s\S]*showProgress=\{true\}/);
  assert.doesNotMatch(librarySource, /hideBadges=\{true\}/);
  assert.doesNotMatch(librarySource, /emoji/);
  assert.match(librarySource, /sections\.find\(section => section\.id === 'watching'\)/);
});

test('Moi · Chiffres et Mon année gardent un seul or et les personnes fréquentes', () => {
  assert.match(dashboardSource, /buildProfileYearStats\(viewings, year\)/);
  assert.match(dashboardSource, /partitionProfileViewings\(collectProfileViewings\(shows\)\)/);
  assert.match(storySource, /partitionProfileViewings\(collectProfileViewings\(shows\)\)/);
  assert.match(dashboardSource, /Devant l’écran/);
  assert.match(dashboardSource, /Heures par mois/);
  assert.match(dashboardSource, /Quand tu regardes/);
  assert.match(dashboardSource, /Où tu regardes/);
  assert.match(dashboardSource, /buildProfileBadges\(data\)/);
  assert.match(dashboardSource, /onPersonClick\?\.\(person\.id\)/);
  assert.doesNotMatch(dashboardSource, /indigo|rose-|emerald|cinephileArchetype/);
  assert.match(storySource, /Et maintenant/);
  assert.match(storySource, /buildProfileProjection\(shows, viewings\)/);
});
