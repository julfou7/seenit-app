import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { buildLibraryMedia, normalizeKnownLibraryDate } from '../src/screens/libraryPresentation.ts';
import { type Show } from '../src/types.ts';

const makeShow = (overrides: Partial<Show> = {}): Show => ({
  id: 'library-date-test',
  userId: 'user',
  tmdbId: 123,
  title: 'Test',
  mediaType: 'tv',
  status: 'plan_to_watch',
  seenEpisodes: [],
  ...overrides,
} as Show);

test('issue #314 omet toute année sentinelle quand la date est absente', () => {
  const media = buildLibraryMedia(makeShow({ firstAirDate: undefined }));

  assert.equal(media.first_air_date, undefined);
  assert.equal(media.release_date, undefined);
  assert.equal((media.first_air_date || media.release_date || '').substring(0, 4), '');
});

test('issue #314 refuse les dates TBA ou invalides', () => {
  assert.equal(normalizeKnownLibraryDate('TBA'), undefined);
  assert.equal(normalizeKnownLibraryDate('2026-02-31'), undefined);
  assert.equal(normalizeKnownLibraryDate(''), undefined);
});

test('issue #314 conserve une vraie date de série ou de film', () => {
  const series = buildLibraryMedia(makeShow({ firstAirDate: '2026-10-15' }));
  assert.equal(series.first_air_date, '2026-10-15');
  assert.equal(series.release_date, undefined);

  const movie = buildLibraryMedia(makeShow({
    mediaType: 'movie',
    firstAirDate: '2027-05-02',
  }));
  assert.equal(movie.first_air_date, undefined);
  assert.equal(movie.release_date, '2027-05-02');
});

test('issue #314 câble le helper sur le chemin de production Ma Liste', () => {
  const source = fs.readFileSync('src/screens/LibraryScreen.tsx', 'utf8');

  assert.match(source, /media:\s*buildLibraryMedia\(show\)/);
  assert.doesNotMatch(source, /2000-01-01/);
});
