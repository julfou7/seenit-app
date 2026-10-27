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

test('SEENIT-NOTIFICATION-005 #778 sépare le type du fait compact sans emoji ni répétition', () => {
  assert.equal(buildTvSeasonReminderSummary(episode(2, 1, 'Reprise')), 'Nouvelle saison');

  const released = episode(2, 3, 'Le combat');
  const show = showFixture({
    seenEpisodes: ['2x1', '2x2'],
    totalAiredEpisodes: 3,
    nextEpisodeToWatch: released,
  });

  const copy = buildTvEpisodeReminderCopy(show, released, today);
  assert.equal(copy.summaryText, 'Nouvel épisode');
  assert.equal(copy.body, 'S02 | E03 · Le combat disponible aujourd’hui.');
  assert.equal(copy.detailText, undefined);
  assert.doesNotMatch(`${copy.summaryText} ${copy.body}`, /[📅🆕🎬📺✅🚀]/u);
  assert.equal((copy.body.match(/S02 \| E03/g) || []).length, 1);
});

test('SEENIT-NOTIFICATION-005 #623 exprime le retard en nombre total d’épisodes à voir', () => {
  const released = episode(2, 3, 'La finale');
  const nextToWatch = episode(2, 2, 'Demi-finale');
  const show = showFixture({
    seenEpisodes: ['2x1'],
    totalAiredEpisodes: 3,
    nextEpisodeToWatch: nextToWatch,
  });

  const copy = buildTvEpisodeReminderCopy(show, released, today);
  assert.equal(copy.summaryText, 'Nouvel épisode');
  assert.equal(copy.body, 'À voir : S02 | E02 · 2 épisodes t’attendent.');
  assert.equal(copy.detailText, 'Tu as 2 épisodes à reprendre. Un nouvel épisode est disponible aujourd’hui.');
  assert.equal((`${copy.body} ${copy.detailText}`.match(/S\d{2} \| E\d{2}/g) || []).length, 1);
});

test('SEENIT-NOTIFICATION-005 #623 reste aligné sur la reprise réelle quand plusieurs épisodes attendent', () => {
  const released = episode(2, 5, 'Cinquième manche');
  const nextToWatch = episode(2, 2, 'Deuxième manche');
  const show = showFixture({
    seenEpisodes: ['2x1'],
    totalAiredEpisodes: 5,
    nextEpisodeToWatch: nextToWatch,
  });

  const copy = buildTvEpisodeReminderCopy(show, released, today);
  assert.equal(copy.summaryText, 'Nouvel épisode');
  assert.equal(copy.body, 'À voir : S02 | E02 · 4 épisodes t’attendent.');
  assert.equal(copy.detailText, 'Tu as 4 épisodes à reprendre. Un nouvel épisode est disponible aujourd’hui.');

  const homeSource = readFileSync('src/components/cards/ContinueWatchingCard.tsx', 'utf8');
  assert.doesNotMatch(homeSource, /getExtraAvailableEpisodes/);
  assert.doesNotMatch(homeSource, /restant/);
  assert.match(homeSource, /episodeFreshnessBadge/);
});

test('SEENIT-NOTIFICATION-005 reste lisible lorsque TMDB ne fournit pas de nom d’épisode', () => {
  const released = episode(1, 2);
  const show = showFixture({
    seenEpisodes: ['1x1'],
    totalAiredEpisodes: 2,
    nextEpisodeToWatch: released,
  });

  const copy = buildTvEpisodeReminderCopy(show, released, today);
  assert.equal(copy.summaryText, 'Nouvel épisode');
  assert.equal(copy.body, 'S01 | E02 disponible aujourd’hui.');
  assert.doesNotMatch(`${copy.summaryText} ${copy.body}`, /undefined|null/);
});

test('SEENIT-NOTIFICATION-006 migre les alarmes futures vers le payload subText v8', () => {
  const source = readFileSync('src/hooks/useRemindersNotifier.ts', 'utf8');
  assert.match(source, /REMINDER_SCHEDULE_SCHEMA = 'v8'/);
  assert.match(
    source,
    /contentRevision = getMediaReminderNotificationId\(\`copy:\$\{summaryText\}:\$\{msgBody\}:\$\{detailText \|\| ''\}\`\)/,
  );
  assert.doesNotMatch(source, /_c\$\{contentRevision\}/);
  assert.match(source, /activeContentRevision !== contentRevision/);
  assert.match(source, /writeUserScopedJson\(uid, scheduleKey, contentRevision\)/);
});
