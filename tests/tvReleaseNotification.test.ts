import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTvReleaseNotification } from '../src/features/notifications/tvReleaseNotification.ts';
import type { Show } from '../src/types.ts';

const show = {
  id: 's1', tmdbId: 42, mediaType: 'tv', title: 'Loups garous', posterPath: '/poster.jpg', backdropPath: '/large.jpg',
  seenEpisodes: ['2x1'], nextEpisodeToWatch: { season_number: 2, episode_number: 2, name: 'Demi-finale', air_date: '2026-11-01' },
} as unknown as Show;

// Retour du 15/11 : la notification de test et le vrai rappel « nouvel épisode » partagent cette construction.
test('nouvel épisode : visuels, épisode à reprendre, catégorie et texte du vrai rappel', () => {
  const built = buildTvReleaseNotification({
    show, released: { season_number: 2, episode_number: 3, name: 'La finale', air_date: '2026-11-15', still_path: '/still.jpg' },
    todayStr: '2026-11-15', provider: { id: 381, name: 'Canal+' }, isSpecificReminder: false,
  });
  assert.equal(built.title, 'Loups garous');
  assert.equal(built.iconUrl, 'https://image.tmdb.org/t/p/w342/poster.jpg');
  assert.equal(built.imageUrl, 'https://image.tmdb.org/t/p/w500/still.jpg', 'image de l’épisode en grand');
  assert.equal(built.options.channelId, 'seenit_episodes');
  assert.equal(built.options.episode, 2, '« ✓ Vu » vise l’épisode à reprendre');
  assert.equal(built.options.actionTitle, '✓ Vu E02');
  assert.equal(built.options.allowMarkWatched, true);
  assert.ok(built.options.body && built.options.summaryText, 'texte du vrai rappel');

  const bell = buildTvReleaseNotification({
    show: { ...show, nextEpisodeToWatch: null } as unknown as Show,
    released: { season_number: 2, episode_number: 3, air_date: '2026-11-15' }, todayStr: '2026-11-15', isSpecificReminder: true,
  });
  assert.equal(bell.options.channelId, 'seenit_reminders', 'cloche explicite : catégorie Rappels');
  assert.equal(bell.imageUrl, 'https://image.tmdb.org/t/p/w500/large.jpg', 'sans image d’épisode : image paysage de la série');
  assert.equal(bell.options.actionTitle, '✓ Vu');
});
