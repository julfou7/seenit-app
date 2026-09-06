import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  hasRecordedMediaProgress,
  isExplicitPendingRewatch,
  normalizeTrackedMediaState,
  shouldNormalizeInitialTrackingState,
} from '../src/features/shows/mediaTrackingState.ts';

const useShowsSource = readFileSync(new URL('../src/hooks/useShows.ts', import.meta.url), 'utf8');

const base = {
  status: 'watching' as const,
  mediaType: 'tv' as const,
  seenEpisodes: [] as string[],
  episodeRecords: {},
  isFavorite: true,
  notificationsEnabled: true,
  isArchived: false,
  userRating: 8,
};

test('SEENIT-LIBRARY-001 normalise tout suivi sans progression vers plan_to_watch', () => {
  assert.equal(shouldNormalizeInitialTrackingState(base), true);
  assert.equal(normalizeTrackedMediaState(base).status, 'plan_to_watch');

  const movie = normalizeTrackedMediaState({ ...base, mediaType: 'movie' as const });
  assert.equal(movie.status, 'plan_to_watch');
});

test('SEENIT-LIBRARY-001 conserve watching dès qu’une progression existe', () => {
  const withSeenEpisode = { ...base, seenEpisodes: ['S01E01'] };
  assert.equal(hasRecordedMediaProgress(withSeenEpisode), true);
  assert.equal(normalizeTrackedMediaState(withSeenEpisode).status, 'watching');

  const withRecord = { ...base, episodeRecords: { S01E01: { watchedAt: 123 } } };
  assert.equal(hasRecordedMediaProgress(withRecord), true);
  assert.equal(normalizeTrackedMediaState(withRecord).status, 'watching');
});

test('SEENIT-LIBRARY-001 conserve le Revoir explicite avant S1E1', () => {
  const rewatch = {
    ...base,
    lastWatchedAt: 123,
    nextEpisodeToWatch: { season_number: 1, episode_number: 1 },
  };
  assert.equal(isExplicitPendingRewatch(rewatch), true);
  assert.equal(normalizeTrackedMediaState(rewatch).status, 'watching');
});

test('SEENIT-LIBRARY-001 préserve les intentions orthogonales et reste idempotent', () => {
  const once = normalizeTrackedMediaState(base);
  const twice = normalizeTrackedMediaState(once);

  assert.equal(once.status, 'plan_to_watch');
  assert.equal(once.isFavorite, true);
  assert.equal(once.notificationsEnabled, true);
  assert.equal(once.isArchived, false);
  assert.equal(once.userRating, 8);
  assert.deepEqual(twice, once);
});

test('SEENIT-LIBRARY-001 applique la même normalisation partagée aux créations, mises à jour et legacy', () => {
  const normalizerUses = useShowsSource.match(/normalizeTrackedMediaState/g) || [];
  assert.ok(normalizerUses.length >= 2, 'addShow et updateShow doivent partager le normaliseur');
  assert.match(useShowsSource, /shouldNormalizeInitialTrackingState/);
  assert.match(useShowsSource, /LEGACY_NORMALIZATION_BATCH_SIZE/);
});
