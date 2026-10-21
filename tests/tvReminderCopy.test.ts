import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { type Show } from '../src/types.ts';
import {
  buildTvEpisodeReminderCopy,
  buildTvSeasonReminderSummary,
  type TvReminderEpisode,
} from '../src/features/notifications/tvReminderCopy.ts';

const today = '2026-09-28';

function showFixture(overrides: Partial<Show> = {}): Show {
  return {
    id: 'tv-1',
    userId: 'user-1',
    tmdbId: 123,
    title: "L'Arène",
    mediaType: 'tv',
    posterPath: null,
    backdropPath: null,
    status: 'watching',
    isArchived: false,
    updatedAt: 0,
    createdAt: 0,
    seenEpisodes: [],
    episodeRecords: {},
    ...overrides,
  };
}

function episode(
  season_number: number,
  episode_number: number,
  name?: string,
): TvReminderEpisode {
  return {
    season_number,
    episode_number,
    name,
    air_date: today,
  };
}

test('SEENIT-NOTIFICATION-002 et #623 affichent le numéro de saison et le numéro du nouvel épisode', () => {
  assert.equal(
    buildTvSeasonReminderSummary(episode(2, 1, 'Reprise')),
    '📅 Nouvelle saison · Saison 2',
  );

  const released = episode(2, 3, 'Le combat');
  const show = showFixture({
    seenEpisodes: ['2x1', '2x2'],
    totalAiredEpisodes: 3,
    nextEpisodeToWatch: released,
  });

  const copy = buildTvEpisodeReminderCopy(show, released, today);
  assert.equal(copy.summaryText, '🆕 Nouvel épisode · S02 | E03');
  assert.equal(copy.body, "S02 | E03 · Le combat disponible aujourd'hui.");
  assert.doesNotMatch(copy.summaryText, /\+ \d+/);
});

test('SEENIT-NOTIFICATION-002 et #623 signalent un seul épisode supplémentaire à rattraper', () => {
  const released = episode(2, 3, 'La finale');
  const nextToWatch = episode(2, 2, 'Demi-finale');
  const show = showFixture({
    seenEpisodes: ['2x1'],
    totalAiredEpisodes: 3,
    nextEpisodeToWatch: nextToWatch,
  });

  const copy = buildTvEpisodeReminderCopy(show, released, today);
  assert.equal(
    copy.summaryText,
    '🆕 Nouvel épisode · S02 | E03 · À voir S02 | E02 · + 1 épisode',
  );
  assert.equal(
    copy.body,
    "À voir : S02 | E02 · Demi-finale · + 1 épisode. Nouvel épisode : S02 | E03 · La finale disponible aujourd'hui.",
  );
});

test('SEENIT-NOTIFICATION-002 et #623 alignent le rappel en retard sur le prochain épisode à voir et le compteur de l’accueil', () => {
  const released = episode(2, 5, 'Cinquième manche');
  const nextToWatch = episode(2, 2, 'Deuxième manche');
  const show = showFixture({
    seenEpisodes: ['2x1'],
    totalAiredEpisodes: 5,
    nextEpisodeToWatch: nextToWatch,
  });

  const copy = buildTvEpisodeReminderCopy(show, released, today);
  assert.equal(
    copy.summaryText,
    '🆕 Nouvel épisode · S02 | E05 · À voir S02 | E02 · + 3 épisodes',
  );
  assert.equal(
    copy.body,
    "À voir : S02 | E02 · Deuxième manche · + 3 épisodes. Nouvel épisode : S02 | E05 · Cinquième manche disponible aujourd'hui.",
  );

  // Le nom de ce TNR est conservé pour l'ancrage SEENIT-NOTIFICATION-002 historique.
  // Depuis #690, la carte 8f réserve cet emplacement aux badges et ne répète plus le compteur.
  const homeSource = readFileSync('src/components/cards/ContinueWatchingCard.tsx', 'utf8');
  assert.doesNotMatch(homeSource, /getExtraAvailableEpisodes/);
  assert.doesNotMatch(homeSource, /restant/);
  assert.match(homeSource, /episodeFreshnessBadge/);
});

test('SEENIT-NOTIFICATION-002 et #623 restent lisibles lorsque TMDB ne fournit pas de nom d’épisode', () => {
  const released = episode(1, 2);
  const show = showFixture({
    seenEpisodes: ['1x1'],
    totalAiredEpisodes: 2,
    nextEpisodeToWatch: released,
  });

  const copy = buildTvEpisodeReminderCopy(show, released, today);
  assert.equal(copy.summaryText, '🆕 Nouvel épisode · S01 | E02');
  assert.equal(copy.body, "S01 | E02 disponible aujourd'hui.");
  assert.doesNotMatch(`${copy.summaryText} ${copy.body}`, /undefined|null/);
});

test('SEENIT-NOTIFICATION-002 et #623 reprogramment une alarme future si le contexte de progression change', () => {
  const source = readFileSync('src/hooks/useRemindersNotifier.ts', 'utf8');
  assert.match(source, /REMINDER_SCHEDULE_SCHEMA = 'v7'/);
  assert.match(
    source,
    /contentRevision = getMediaReminderNotificationId\(\`copy:\$\{summaryText\}:\$\{msgBody\}\`\)/,
  );
  assert.doesNotMatch(source, /_c\$\{contentRevision\}/);
  assert.match(source, /activeContentRevision !== contentRevision/);
  assert.match(source, /writeUserScopedJson\(uid, scheduleKey, contentRevision\)/);
});
