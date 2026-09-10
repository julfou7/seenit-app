import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getTmdbArtwork,
  getTrackedMediaArtworkConvergence,
} from '../src/features/shows/mediaArtwork.ts';

const tmdbFacadeSource = readFileSync(new URL('../src/features/shows/tmdb.ts', import.meta.url), 'utf8');
const trackedArtworkSource = readFileSync(new URL('../src/features/shows/trackedMediaArtwork.ts', import.meta.url), 'utf8');
const productionArtworkSource = `${tmdbFacadeSource}\n${trackedArtworkSource}\n${readFileSync(new URL('../src/features/shows/mediaArtwork.ts', import.meta.url), 'utf8')}`;

test('SEENIT-METADATA-002 conserve le dernier visuel si TMDB ne fournit pas de remplaçant exploitable', () => {
  assert.deepEqual(
    getTmdbArtwork({ poster_path: '/poster-neuf.jpg', backdrop_path: '/fond-neuf.jpg' }),
    { posterPath: '/poster-neuf.jpg', backdropPath: '/fond-neuf.jpg' },
  );
  assert.deepEqual(getTmdbArtwork({ poster_path: null, backdrop_path: '   ' }), {});

  const tracked = [{
    id: 'tv-doc',
    tmdbId: 123,
    mediaType: 'tv' as const,
    posterPath: '/poster-stable.jpg',
    backdropPath: '/fond-stable.jpg',
  }];
  assert.equal(
    getTrackedMediaArtworkConvergence(tracked, 'tv', 123, { poster_path: null, backdrop_path: '' }),
    null,
  );
});

test('SEENIT-METADATA-002 converge uniquement par mediaType et TMDB ID exacts', () => {
  const tracked = [
    { id: 'tv-doc', tmdbId: 123, mediaType: 'tv' as const, posterPath: '/ancien-poster.jpg', backdropPath: '/ancien-fond.jpg' },
    { id: 'movie-doc', tmdbId: 123, mediaType: 'movie' as const, posterPath: '/film.jpg', backdropPath: '/film-fond.jpg' },
    { id: 'same-title-wrong-id', tmdbId: 999, mediaType: 'tv' as const, posterPath: '/autre.jpg', backdropPath: '/autre-fond.jpg' },
  ];

  assert.deepEqual(
    getTrackedMediaArtworkConvergence(tracked, 'tv', 123, {
      name: 'Nouvelle École',
      poster_path: '/nouvelle-ecole-s5.jpg',
      backdrop_path: '/nouvelle-ecole-s5-fond.jpg',
    }),
    {
      showId: 'tv-doc',
      updates: {
        posterPath: '/nouvelle-ecole-s5.jpg',
        backdropPath: '/nouvelle-ecole-s5-fond.jpg',
      },
    },
  );
  assert.equal(
    getTrackedMediaArtworkConvergence(tracked, 'movie', 999, { poster_path: '/nouveau.jpg' }),
    null,
  );
  assert.doesNotMatch(productionArtworkSource, /Nouvelle École|nouvelle-ecole-s5/);
});

test('SEENIT-METADATA-002 persiste uniquement posterPath et backdropPath après hydratation TMDB', () => {
  assert.match(tmdbFacadeSource, /convergeTrackedMediaArtworkFromTmdb\('tv', Number\(id\), details\)/);
  assert.match(tmdbFacadeSource, /convergeTrackedMediaArtworkFromTmdb\('movie', Number\(id\), details\)/);
  assert.match(trackedArtworkSource, /updateDoc\(doc\(db, 'users', userId, 'shows', convergence\.showId\), convergence\.updates\)/);
  assert.doesNotMatch(trackedArtworkSource, /updatedAt|seenEpisodes|episodeRecords|isFavorite|userRating|status:/);
});
