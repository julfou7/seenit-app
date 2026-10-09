import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHeroOverviewPreview,
  formatHeroEpisode,
  resolveHeroNextEpisode,
} from '../src/features/discover/heroPresentation.ts';

test('le Hero recalcule la progression depuis les épisodes vus avant un nextEpisodeToWatch obsolète', () => {
  const next = resolveHeroNextEpisode({
    seenEpisodes: ['1x1', '1x2'],
    nextEpisodeToWatch: { season_number: 1, episode_number: 1 },
    seasonsCache: [
      {
        season_number: 1,
        episodes: [
          { season_number: 1, episode_number: 1 },
          { season_number: 1, episode_number: 2 },
          { season_number: 1, episode_number: 3 },
          { season_number: 1, episode_number: 4 },
        ],
      },
    ],
  });

  assert.deepEqual(next, { season: 1, episode: 3 });
  assert.equal(formatHeroEpisode(next!), 'S01E03');
});

test('le Hero conserve nextEpisodeToWatch comme fallback sans cache de saisons', () => {
  assert.deepEqual(
    resolveHeroNextEpisode({
      seenEpisodes: ['1x1', '1x2'],
      nextEpisodeToWatch: { season_number: 1, episode_number: 3 },
    }),
    { season: 1, episode: 3 },
  );
});

test('un nextEpisodeToWatch déjà vu ne fait pas régresser le CTA', () => {
  assert.equal(
    resolveHeroNextEpisode({
      seenEpisodes: ['1x1', '1x2', '1x3'],
      nextEpisodeToWatch: { season_number: 1, episode_number: 1 },
    }),
    null,
  );
});

test('le synopsis compact coupe sur une frontière de mot', () => {
  const overview = "Deux familles du crime s'affrontent dans une lutte à mort qui menace de faire tomber des empires. Prisonniers d'une guerre qui les dépasse.";
  const preview = buildHeroOverviewPreview(overview, 100);

  assert.equal(preview.truncated, true);
  assert.equal(preview.text, "Deux familles du crime s'affrontent dans une lutte à mort qui menace de faire tomber des empires.");
  assert.doesNotMatch(preview.text, /\bPr$/);
});
