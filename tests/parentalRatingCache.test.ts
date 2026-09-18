import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PARENTAL_RATING_CACHE_TTL_MS,
  readParentalRatingCache,
  writeParentalRatingCache,
} from '../src/features/shows/parentalRatingCache.ts';
import { resolveParentalRating } from '../src/features/shows/parentalRating.ts';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

test('SEENIT-PARENTAL-001 persiste les preuves parentales sans transformer un inconnu', () => {
  const storage = new MemoryStorage();
  writeParentalRatingCache(1029575, 'movie', {
    release_dates: {
      results: [
        { iso_3166_1: 'FR', release_dates: [{ certification: 'TP' }] },
        { iso_3166_1: 'US', release_dates: [{ certification: 'PG-13' }] },
      ],
    },
  }, { storage, now: 1_000, defer: false });

  const movie = readParentalRatingCache(1029575, 'movie', { storage, now: 2_000 });
  assert.ok(movie);
  assert.equal(movie.data.release_dates.results.length, 1);
  assert.equal(movie.data.release_dates.results[0].iso_3166_1, 'US');
  assert.equal(resolveParentalRating('movie', movie.data).age, 13);

  writeParentalRatingCache(55, 'tv', {
    content_ratings: { results: [{ iso_3166_1: 'FR', rating: '10' }] },
  }, { storage, now: 1_000, defer: false });
  const unknown = readParentalRatingCache(55, 'tv', { storage, now: 2_000 });
  assert.ok(unknown, 'une réponse TMDB valide sans preuve US reste cacheable');
  assert.equal(resolveParentalRating('tv', unknown.data).isKnown, false);
  assert.equal(resolveParentalRating('tv', unknown.data).label, 'Âge à vérifier');
});

test('issue #326 expire une preuve parentale avant de la réutiliser indéfiniment', () => {
  const storage = new MemoryStorage();
  writeParentalRatingCache(7, 'tv', {
    content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-Y7' }] },
  }, { storage, now: 10_000, defer: false });

  assert.ok(readParentalRatingCache(7, 'tv', {
    storage,
    now: 10_000 + PARENTAL_RATING_CACHE_TTL_MS - 1,
  }));
  assert.equal(readParentalRatingCache(7, 'tv', {
    storage,
    now: 10_000 + PARENTAL_RATING_CACHE_TTL_MS,
  }), null);
});
