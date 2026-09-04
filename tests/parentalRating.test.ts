import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decorateParentalRatingDetails,
  matchesMaxRecommendedAge,
  parentalRatingKey,
  parseMaxAgeFilter,
  resolveParentalRating,
} from '../src/features/shows/parentalRating.ts';

const familyPlan = {
  release_dates: {
    results: [
      { iso_3166_1: 'FR', release_dates: [{ certification: 'TP' }] },
      { iso_3166_1: 'US', release_dates: [{ certification: 'PG-13' }] },
    ],
  },
};

test('SEENIT-PARENTAL-001 préfère la certification US explicite et refuse un faux Tous publics', () => {
  const result = resolveParentalRating('movie', familyPlan);
  assert.equal(result.source, 'tmdb-us');
  assert.equal(result.age, 13);
  assert.equal(result.label, 'PG-13 · US · 13+');
  assert.notEqual(result.shortLabel, 'Tous publics');

  const onlyFrench = resolveParentalRating('movie', {
    release_dates: { results: [{ iso_3166_1: 'FR', release_dates: [{ certification: 'TP' }] }] },
  });
  assert.equal(onlyFrench.label, 'Âge à vérifier');
});

test('SEENIT-PARENTAL-001 traite les inconnues et les ratings adultes sans sous-classer', () => {
  assert.equal(resolveParentalRating('movie', {}).label, 'Âge à vérifier');
  assert.equal(resolveParentalRating('movie', {
    release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'NR' }] }] },
  }).label, 'Âge à vérifier');

  assert.equal(resolveParentalRating('movie', {
    release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'R' }] }] },
  }).age, 17);
  assert.equal(resolveParentalRating('movie', {
    release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'NC-17' }] }] },
  }).age, 18);
  assert.equal(resolveParentalRating('movie', {
    release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: '18' }] }] },
  }).age, 18);
  assert.equal(resolveParentalRating('tv', {
    content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-MA' }] },
  }).age, 18);
});

test('SEENIT-PARENTAL-001 applique un âge maximum cumulatif et exclut les inconnues', () => {
  const allPublic = resolveParentalRating('movie', {
    release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'G' }] }] },
  });
  const seven = resolveParentalRating('tv', {
    content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-Y7' }] },
  });
  const ten = resolveParentalRating('movie', {
    release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'PG' }] }] },
  });
  const thirteen = resolveParentalRating('movie', familyPlan);
  const unknown = resolveParentalRating('movie', {});

  assert.equal(matchesMaxRecommendedAge(allPublic, 10), true);
  assert.equal(matchesMaxRecommendedAge(seven, 10), true);
  assert.equal(matchesMaxRecommendedAge(ten, 10), true);
  assert.equal(matchesMaxRecommendedAge(thirteen, 10), false);
  assert.equal(matchesMaxRecommendedAge(unknown, 10), false);
  assert.equal(matchesMaxRecommendedAge(unknown, null), true);

  assert.equal(parseMaxAgeFilter('Tous'), null);
  assert.equal(parseMaxAgeFilter('age:10'), 10);
  assert.equal(parseMaxAgeFilter('age:18'), 18);
});

test('SEENIT-PARENTAL-001 donne priorité au choix personnel par identité TMDB exacte', () => {
  const override = { age: 6, updatedAt: 1 };
  const result = resolveParentalRating('movie', familyPlan, override);
  assert.equal(result.source, 'personal');
  assert.equal(result.label, '6+ · Choix personnel');
  assert.equal(parentalRatingKey('movie', 1029575), 'movie:1029575');
  assert.equal(parentalRatingKey('tv', 1029575), 'tv:1029575');
});

test('SEENIT-PARENTAL-001 adapte les écrans legacy sans muter la certification TMDB source', () => {
  const source = structuredClone(familyPlan);
  const decorated = decorateParentalRatingDetails('movie', source);

  assert.equal(source.release_dates.results[0].release_dates[0].certification, 'TP');
  assert.equal(source.release_dates.results[1].release_dates[0].certification, 'PG-13');
  assert.equal(decorated.release_dates.results[0].release_dates[0].certification, '');
  assert.equal(decorated.release_dates.results[1].release_dates[0].certification, 'PG-13 · US · 13+');
  assert.equal(decorated.seenitParentalRating.original, 'PG-13');
});
