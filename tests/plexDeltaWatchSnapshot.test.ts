import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPlexDeltaWatchedSectionQueries,
  shouldIncludePlexItemForDelta
} from '../src/features/plex/plexDeltaWatchSnapshot.ts';

test('SEENIT-PLEX-005 la delta interroge uniquement les éléments actuellement vus des sections Plex', () => {
  const queries = buildPlexDeltaWatchedSectionQueries('https://plex.example:32400/', 'Serveur test', [
    { key: '1', type: 'movie', title: 'Films' },
    { key: '2', type: 'show', title: 'Séries' },
    { key: '3', type: 'artist', title: 'Musique' }
  ]);

  assert.equal(queries.length, 2);
  assert.equal(queries[0].mediaType, 'movie');
  assert.equal(queries[1].mediaType, 'episode');
  for (const query of queries) {
    const url = new URL(query.endpoint);
    assert.equal(url.searchParams.get('unwatched'), '0');
    assert.equal(url.searchParams.get('includeGuids'), '1');
  }
  assert.match(queries[0].endpoint, /\/library\/sections\/1\/all\?/);
  assert.match(queries[1].endpoint, /\/library\/sections\/2\/allLeaves\?/);
});

test('SEENIT-PLEX-005 un état courant vu n’est jamais rejeté par le curseur historique de la delta', () => {
  const cursor = 2_000;

  assert.equal(shouldIncludePlexItemForDelta('library-watched', 1_000, cursor), true);
  assert.equal(shouldIncludePlexItemForDelta('pms-history', 1_000, cursor), false);
  assert.equal(shouldIncludePlexItemForDelta('pms-history', 3_000, cursor), true);
});
