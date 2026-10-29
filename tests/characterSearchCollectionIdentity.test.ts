import assert from 'node:assert/strict';
import test from 'node:test';
import type { Show } from '../src/types.ts';
import { buildCachedTrackedCharacterResults } from '../src/features/discover/characterSearch.ts';

function movie(tmdbId: number, title: string): Show {
  return {
    id: `movie-${tmdbId}`,
    userId: 'user-a',
    tmdbId,
    title,
    mediaType: 'movie',
    posterPath: null,
    backdropPath: null,
    status: 'completed',
    isArchived: false,
    updatedAt: 1,
    createdAt: 1,
    seenEpisodes: [],
    episodeRecords: {},
  };
}

test('le cache local reprend belongs_to_collection pour garder la même identité que le backend', () => {
  const dune = movie(438631, 'Dune');
  const metadata = new Map<string, unknown>([['movie:438631', {
    belongs_to_collection: { id: 726871, name: 'Dune Collection' },
    credits: {
      cast: [
        { id: 1190668, name: 'Timothée Chalamet', profile_path: '/paul.jpg', character: 'Paul Atreides' },
      ],
    },
  }]]);

  const results = buildCachedTrackedCharacterResults([dune], metadata, 'Paul');
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'collection:726871:paul atreides');
  assert.equal(results[0].universeId, 'collection:726871');
  assert.equal(results[0].universe, 'Dune Collection');
  assert.equal(results[0].seed, 'movie:438631');
});
