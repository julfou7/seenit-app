import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildNotificationTestSample } from '../src/features/notifications/notificationTestSample.ts';
import type { Show } from '../src/types.ts';

function makeShow(overrides: Partial<Show> & Pick<Show, 'id' | 'title' | 'tmdbId' | 'mediaType'>): Show {
  return {
    userId: 'user-test',
    posterPath: '/poster.jpg',
    backdropPath: '/backdrop.jpg',
    status: 'plan_to_watch',
    isArchived: false,
    updatedAt: 1,
    createdAt: 1,
    seenEpisodes: [],
    episodeRecords: {},
    ...overrides,
  } as Show;
}

const NOW = new Date(2026, 8, 6, 12, 0, 0);

test('SEENIT-NOTIFICATION-005 TNR #106 : Tester choisit le prochain épisode réel sans emoji', () => {
  const toTheLake = makeShow({
    id: 'to-the-lake',
    title: 'To the Lake',
    tmdbId: 81349,
    mediaType: 'tv',
    nextEpisodeToAir: {
      season_number: 2,
      episode_number: 1,
      name: 'Retour tardif',
      air_date: '2026-11-20',
      still_path: '/lake-still.jpg',
    },
  });
  const nearest = makeShow({
    id: 'nearest',
    title: 'Série la plus proche',
    tmdbId: 123,
    mediaType: 'tv',
    nextEpisodeToAir: {
      season_number: 3,
      episode_number: 4,
      name: 'Demain',
      air_date: '2026-09-07',
      still_path: '/nearest-still.jpg',
    },
  });
  const archivedCloser = makeShow({
    id: 'archived',
    title: 'Archivée',
    tmdbId: 456,
    mediaType: 'tv',
    isArchived: true,
    nextEpisodeToAir: {
      season_number: 1,
      episode_number: 2,
      air_date: '2026-09-06',
    },
  });

  const sample = buildNotificationTestSample([toTheLake, archivedCloser, nearest], 'release_today_tv', NOW);

  assert.ok(sample);
  assert.equal(sample.show.title, 'Série la plus proche');
  assert.equal(sample.isUpcoming, true);
  assert.equal(sample.eventDate, '2026-09-07');
  assert.equal(sample.summaryText, 'Nouvel épisode');
  assert.equal(sample.notificationTitle, 'Série la plus proche');
  assert.match(sample.body, /S03 \| E04/);
  assert.match(sample.body, /· Demain/);
  assert.doesNotMatch(sample.body, /Série la plus proche/);
  assert.doesNotMatch(`${sample.summaryText} ${sample.body}`, /[📅🆕🎬📺✅🚀]/u);
  assert.equal(sample.richImageUrl, 'https://image.tmdb.org/t/p/w500/nearest-still.jpg');
  assert.equal(sample.allowMarkWatched, true);
});

test('SEENIT-NOTIFICATION-005 TNR #106 : Tester Nouvelle saison prend une vraie première de saison', () => {
  const normalEpisode = makeShow({
    id: 'normal',
    title: 'Épisode normal',
    tmdbId: 111,
    mediaType: 'tv',
    nextEpisodeToAir: {
      season_number: 4,
      episode_number: 2,
      air_date: '2026-09-07',
    },
  });
  const seasonPremiere = makeShow({
    id: 'premiere',
    title: 'Première réelle',
    tmdbId: 222,
    mediaType: 'tv',
    nextEpisodeToAir: {
      season_number: 5,
      episode_number: 1,
      air_date: '2026-09-15',
      still_path: '/premiere.jpg',
    },
  });

  const sample = buildNotificationTestSample([normalEpisode, seasonPremiere], 'season_d7', NOW);

  assert.ok(sample);
  assert.equal(sample.show.title, 'Première réelle');
  assert.equal(sample.season, 5);
  assert.equal(sample.episode, 1);
  assert.equal(sample.summaryText, 'Bientôt');
  assert.equal(sample.notificationTitle, 'Première réelle');
  assert.equal(sample.body, 'Saison 5 dans 7 jours.');
  assert.equal(sample.allowMarkWatched, false);
});

test('SEENIT-NOTIFICATION-005 TNR #106 : cinéma garde une date réelle et VOD reste un aperçu', () => {
  const oldMovie = makeShow({
    id: 'old',
    title: 'Film déjà sorti',
    tmdbId: 301,
    mediaType: 'movie',
    firstAirDate: '2026-05-01',
  });
  const nextTheater = makeShow({
    id: 'theater',
    title: 'Film cinéma proche',
    tmdbId: 302,
    mediaType: 'movie',
    firstAirDate: '2026-09-08',
  });

  const theaterSample = buildNotificationTestSample([oldMovie, nextTheater], 'movie_theater', NOW);
  assert.ok(theaterSample);
  assert.equal(theaterSample.show.title, 'Film cinéma proche');
  assert.equal(theaterSample.eventDate, '2026-09-08');
  assert.equal(theaterSample.summaryText, 'Au cinéma');
  assert.equal(theaterSample.notificationTitle, 'Film cinéma proche');
  assert.equal(theaterSample.body, 'Dans les salles aujourd’hui.');
  assert.equal(theaterSample.allowMarkWatched, false);

  const vodSample = buildNotificationTestSample([oldMovie, nextTheater], 'movie_dvd_vod', NOW);
  assert.ok(vodSample);
  assert.equal(vodSample.isUpcoming, false);
  assert.equal(vodSample.eventDate, undefined);
  assert.equal(vodSample.summaryText, 'Sortie vidéo');
  assert.equal(vodSample.notificationTitle, vodSample.show.title);
  assert.equal(vodSample.allowMarkWatched, false);
});

test('SEENIT-NOTIFICATION-005 TNR #106 : fallback média explicite et déterministe', () => {
  const stale = makeShow({
    id: 'stale',
    title: 'Ancienne série',
    tmdbId: 401,
    mediaType: 'tv',
    updatedAt: 10,
    nextEpisodeToWatch: {
      season_number: 1,
      episode_number: 8,
      air_date: '2026-08-01',
    },
  });
  const recent = makeShow({
    id: 'recent',
    title: 'Série récente',
    tmdbId: 402,
    mediaType: 'tv',
    updatedAt: 20,
  });

  const sample = buildNotificationTestSample([stale, recent], 'release_today_tv', NOW);

  assert.ok(sample);
  assert.equal(sample.isUpcoming, false);
  assert.equal(sample.show.title, 'Série récente');
  assert.equal(sample.summaryText, 'Nouvel épisode');
});

test('SEENIT-NOTIFICATION-002 TNR #106 : une affiche absente reste absente', () => {
  const noVisual = makeShow({
    id: 'no-visual',
    title: 'Sans visuel',
    tmdbId: 501,
    mediaType: 'movie',
    posterPath: undefined,
    backdropPath: undefined,
  });

  const sample = buildNotificationTestSample([noVisual], 'movie_dvd_vod', NOW);
  assert.ok(sample);
  assert.equal(sample.posterUrl, undefined);
  assert.equal(sample.richImageUrl, undefined);
});

test('SEENIT-NOTIFICATION-005 TNR #106 : Settings réutilise le pipeline natif', () => {
  const source = readFileSync('src/screens/SettingsScreenCore.tsx', 'utf8');

  assert.match(source, /buildNotificationTestSample\(shows, type\)/);
  assert.match(source, /resolveNotificationMediaVisual\(sample\.posterUrl, sample\.richImageUrl\)/);
  assert.match(source, /const sent = await sendMediaReminderNotification\(sample\.notificationTitle/);
  assert.match(source, /const hasVisual = Boolean\(mediaVisual\.icon \|\| mediaVisual\.image\)/);
  assert.match(source, /🧪 Test ·/);
  assert.match(source, /fallback texte/);
  assert.match(source, /allowMarkWatched: sample\.allowMarkWatched/);
  assert.doesNotMatch(source, /\bsendNativeNotification\b/);
});
