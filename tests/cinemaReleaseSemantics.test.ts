import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isMovieAtCinema } from '../src/features/shows/tmdb.ts';

const relativeIso = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
};

const movieWithFrenchRelease = (type: number, days: number) => ({
  media_type: 'movie',
  release_date: relativeIso(days).slice(0, 10),
  release_dates: {
    results: [
      {
        iso_3166_1: 'FR',
        release_dates: [
          { type, release_date: relativeIso(days) },
        ],
      },
    ],
  },
});

test('SEENIT-DISCOVER-001 exige une sortie théâtrale française pour Au cinéma', () => {
  assert.equal(isMovieAtCinema(movieWithFrenchRelease(3, -10)), true);
  assert.equal(isMovieAtCinema(movieWithFrenchRelease(2, -10)), true);
  assert.equal(isMovieAtCinema(movieWithFrenchRelease(4, -10)), false);

  assert.equal(isMovieAtCinema({
    media_type: 'movie',
    release_date: relativeIso(-10).slice(0, 10),
  }), false, 'une date générique récente ne prouve plus une sortie cinéma');
});

test('SEENIT-DISCOVER-001 respecte la fenêtre cinéma et le marqueur issu de la requête théâtrale', () => {
  assert.equal(isMovieAtCinema(movieWithFrenchRelease(3, -76)), false);
  assert.equal(isMovieAtCinema(movieWithFrenchRelease(3, 11)), false);
  assert.equal(isMovieAtCinema({
    media_type: 'movie',
    seenitFrenchTheatrical: true,
  }), true);
});

test('SEENIT-DISCOVER-001 contraint Explorer aux release types TMDB 2 ou 3 en France', () => {
  const source = fs.readFileSync('src/features/shows/tmdb.ts', 'utf8');
  assert.match(source, /region'\s*,\s*'FR'/);
  assert.match(source, /with_release_type'\s*,\s*'2\|3'/);
  assert.match(source, /release_date\.gte/);
  assert.match(source, /release_date\.lte/);
  assert.doesNotMatch(source, /primary_release_date\.gte/);
});
