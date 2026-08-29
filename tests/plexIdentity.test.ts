import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPlexParentShowIdentityItem,
  buildResolvedPlexIdentity,
  extractPlexExternalIds,
  getStrongPlexSourceIdentity,
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

test('ne fabrique aucune identité forte depuis un titre ou une année', () => {
  assert.equal(getStrongPlexSourceIdentity({ type: 'movie', title: 'King Kong', year: 2005 }), null);
});
