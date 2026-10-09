import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHeroOverviewPreview,
  formatHeroEpisode,
  resolveHeroNextEpisode,
} from '../src/features/discover/heroPresentation.ts';

test('MobLand : E01/E02 vus font reprendre à E03 même avec un pointeur dérivé resté sur E01', () => {
  const next = resolveHeroNextEpisode({
    seenEpisodes: ['1x1', '1x2'],
    totalAiredEpisodes: 10,
    nextEpisodeToWatch: { season_number: 1, episode_number: 1, episode_count: 10 },
  });

  assert.deepEqual(next, { season: 1, episode: 3 });
  assert.equal(formatHeroEpisode(next!), 'S01E03');
});

test('un nextEpisodeToWatch encore en avance sur la progression reste prioritaire', () => {
  assert.deepEqual(
    resolveHeroNextEpisode({
      seenEpisodes: ['1x1', '1x2'],
      nextEpisodeToWatch: { season_number: 1, episode_number: 3 },
    }),
    { season: 1, episode: 3 },
  );
});

test('un pointeur obsolète ne dépend pas de seasonsCache pour être corrigé', () => {
  assert.deepEqual(
    resolveHeroNextEpisode({
      seenEpisodes: ['1x1', '1x2', '1x3'],
      nextEpisodeToWatch: { season_number: 1, episode_number: 1 },
    }),
    { season: 1, episode: 4 },
  );
});

test('le Hero reste à jour quand tous les épisodes diffusés sont déjà vus', () => {
  assert.equal(
    resolveHeroNextEpisode({
      seenEpisodes: ['1x1', '1x2'],
      totalAiredEpisodes: 2,
      nextEpisodeToWatch: { season_number: 1, episode_number: 1 },
    }),
    null,
  );
});

test('la reprise passe à la saison suivante quand la taille de saison est connue', () => {
  assert.deepEqual(
    resolveHeroNextEpisode({
      seenEpisodes: ['1x9', '1x10'],
      nextEpisodeToWatch: { season_number: 1, episode_number: 1, episode_count: 10 },
    }),
    { season: 2, episode: 1 },
  );
});

test('une série terminée ne fabrique pas de saison suivante après le final connu', () => {
  assert.equal(
    resolveHeroNextEpisode({
      seenEpisodes: ['1x10'],
      seriesEnded: true,
      nextEpisodeToWatch: {
        season_number: 1,
        episode_number: 1,
        episode_count: 10,
        is_final_season: true,
        series_ended: true,
      },
    }),
    null,
  );
});

test('le synopsis compact coupe sur une frontière de mot', () => {
  const overview = "Deux familles du crime s'affrontent dans une lutte à mort qui menace de faire tomber des empires. Prisonniers d'une guerre qui les dépasse.";
  const preview = buildHeroOverviewPreview(overview);

  assert.equal(preview.truncated, true);
  assert.equal(preview.text, "Deux familles du crime s'affrontent dans une lutte à mort qui menace de faire tomber des empires.");
  assert.doesNotMatch(preview.text, /\bPr$/);
});
