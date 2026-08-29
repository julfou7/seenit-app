import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPlexParentShowIdentityItem,
  buildResolvedPlexIdentity,
  extractPlexExternalIds,
  getStrongPlexSourceIdentity,
  isPlexEpisodeAlreadyWatched,
  isPlexMovieAlreadyWatched,
  isStrictPlexIdentityMatch
} from '../src/features/plex/plexIdentity.ts';

test('extrait les identifiants externes des différentes formes Plex', () => {
  const ids = extractPlexExternalIds({
    guid: 'plex://movie/abc123',
    Guid: [{ id: 'imdb://tt1234567' }, { id: 'tmdb://42' }],
    guids: [{ id: 'tvdb://99' }]
  });

  assert.deepEqual(ids, {
    tmdbId: 42,
    imdbId: 'tt1234567',
    tvdbId: 99,
    plexGuid: 'abc123'
  });
});

test('refuse un premier résultat Plex sans identifiant strictement égal', () => {
  const wrongFirstResult = { type: 'movie', slug: 'mauvais-film', Guid: [{ id: 'tmdb://999' }] };
  assert.equal(
    isStrictPlexIdentityMatch(wrongFirstResult, { tmdbId: 42, mediaType: 'movie' }),
    false
  );
});

test('accepte uniquement le bon remake grâce au TMDB ID', () => {
  const remake2015 = { type: 'movie', title: 'Cendrillon', year: 2015, Guid: [{ id: 'tmdb://150689' }] };
  const remake1899 = { type: 'movie', title: 'Cendrillon', year: 1899, Guid: [{ id: 'tmdb://114108' }] };
  assert.equal(isStrictPlexIdentityMatch(remake2015, { tmdbId: 150689, mediaType: 'movie' }), true);
  assert.equal(isStrictPlexIdentityMatch(remake1899, { tmdbId: 150689, mediaType: 'movie' }), false);
});

test('construit une identité résolue distincte pour chaque épisode', () => {
  assert.equal(buildResolvedPlexIdentity('tv', 1399, 1, 1), 'tv:1399:S1:E1');
  assert.equal(buildResolvedPlexIdentity('tv', 1399, 1, 2), 'tv:1399:S1:E2');
});

test("résout un épisode uniquement depuis l'identité de sa série parente", () => {
  const parentIdentity = buildPlexParentShowIdentityItem({
    type: 'episode',
    Guid: [{ id: 'tmdb://999999' }],
    grandparentGuid: 'tmdb://1399',
    parentGuid: 'plex://season/season-hash'
  });

  assert.equal(extractPlexExternalIds(parentIdentity).tmdbId, 1399);
  assert.equal(extractPlexExternalIds(parentIdentity).plexGuid, null);
});

test("ignore l'identifiant TMDB d'un épisode si la série parente est inconnue", () => {
  const parentIdentity = buildPlexParentShowIdentityItem({
    type: 'episode',
    Guid: [{ id: 'tmdb://999999' }]
  });

  assert.equal(extractPlexExternalIds(parentIdentity).tmdbId, null);
});

test("utilise les GUID enrichis de la série parente sans reprendre ceux de l'épisode", () => {
  const parentIdentity = buildPlexParentShowIdentityItem({
    type: 'episode',
    Guid: [{ id: 'tmdb://999999' }],
    grandparentGuids: [{ id: 'tmdb://1399' }, { id: 'tvdb://121361' }]
  });

  assert.deepEqual(extractPlexExternalIds(parentIdentity), {
    tmdbId: 1399,
    imdbId: null,
    tvdbId: 121361,
    plexGuid: null
  });
});

test("reconnaît un épisode déjà vu depuis seenEpisodes ou episodeRecords", () => {
  assert.equal(isPlexEpisodeAlreadyWatched({ seenEpisodes: ['1x4'] }, 1, 4), true);
  assert.equal(isPlexEpisodeAlreadyWatched({ episodeRecords: { '1x4': { watchedAt: 123 } } }, 1, 4), true);
  assert.equal(isPlexEpisodeAlreadyWatched({ episodeRecords: { S01E04: { watchedAt: 123 } } }, 1, 4), true);
  assert.equal(isPlexEpisodeAlreadyWatched({ seenEpisodes: ['1x5'] }, 1, 4), false);
});

test("reconnaît un film déjà vu même si l'index seenEpisodes est absent", () => {
  assert.equal(isPlexMovieAlreadyWatched({ episodeRecords: { movie: { watchedAt: 123 } } }), true);
  assert.equal(isPlexMovieAlreadyWatched({ status: 'completed' }), true);
  assert.equal(isPlexMovieAlreadyWatched({ status: 'watching' }), false);
});

test('ne fabrique aucune identité forte depuis un titre ou une année', () => {
  assert.equal(getStrongPlexSourceIdentity({ type: 'movie', title: 'King Kong', year: 2005 }), null);
});
