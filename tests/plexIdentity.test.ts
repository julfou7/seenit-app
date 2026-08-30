import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPlexParentShowIdentityItem,
  buildResolvedPlexIdentity,
  extractPlexExternalIds,
  extractPlexLocalMetadataId,
  getPlexMetadataLookupKey,
  getPlexParentShowMetadataLookupKey,
  getStrongPlexSourceIdentity,
  isPlexEpisodeAlreadyWatched,
  isPlexMovieAlreadyWatched,
  isStrictPlexIdentityMatch,
  parsePlexGuid,
  unwrapPlexMediaItem
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

test('refuse les identifiants externes contenant un suffixe arbitraire', () => {
  assert.deepEqual(extractPlexExternalIds({ guid: 'tmdb://42garbage' }), {
    tmdbId: null,
    imdbId: null,
    tvdbId: null,
    plexGuid: null
  });
  assert.equal(extractPlexExternalIds({ guid: 'imdb://tt1234567garbage' }).imdbId, null);
  assert.equal(extractPlexExternalIds({ guid: 'tvdb://99/path' }).tvdbId, null);
});

test('accepte les paramètres documentaires des anciens agents sans élargir l’identité', () => {
  assert.equal(extractPlexExternalIds({ guid: 'tmdb://42?lang=fr' }).tmdbId, 42);
  assert.equal(extractPlexExternalIds({ guid: 'imdb://tt1234567#main' }).imdbId, 'tt1234567');
  assert.equal(extractPlexExternalIds({ guid: 'tvdb://99?lang=en' }).tvdbId, 99);
});

test('accepte tout le jeu de caractères documenté pour un ratingKey provider Plex', () => {
  assert.deepEqual(parsePlexGuid('plex://show/AbC-123_def'), {
    type: 'show',
    id: 'AbC-123_def'
  });
  assert.deepEqual(parsePlexGuid('plex://episode/EP_01-test'), {
    type: 'episode',
    id: 'EP_01-test'
  });
  assert.equal(parsePlexGuid('plex://show/abc/def'), null);
  assert.equal(extractPlexExternalIds({ guid: 'plex://show/AbC-123_def' }).plexGuid, 'AbC-123_def');
});

test("déplie les métadonnées imbriquées d'une activité Plex sans utiliser son titre", () => {
  const activity = {
    type: 'watched',
    title: 'Libellé de notification',
    metadata: {
      type: 'movie',
      title: 'Titre du média',
      ratingKey: '5d7768244de0ee001fcc7fed',
      key: '/library/metadata/5d7768244de0ee001fcc7fed',
      guid: 'plex://movie/5d7768244de0ee001fcc7fed',
      Guid: [{ id: 'tmdb://105' }]
    }
  };

  const media = unwrapPlexMediaItem(activity);
  assert.equal(media.type, 'movie');
  assert.equal(media.ratingKey, '5d7768244de0ee001fcc7fed');
  assert.equal(extractPlexExternalIds(activity).tmdbId, 105);
  assert.equal(getPlexMetadataLookupKey(activity), '5d7768244de0ee001fcc7fed');
});

test('déplie une réponse Plex MediaContainer contenant un seul média', () => {
  const response = {
    MediaContainer: {
      Metadata: [{
        type: 'movie',
        guid: 'plex://movie/movie-hash',
        key: '/library/metadata/movie-hash'
      }]
    }
  };

  assert.equal(extractPlexExternalIds(response).plexGuid, 'movie-hash');
  assert.equal(getPlexMetadataLookupKey(response), 'movie-hash');
});

test("récupère un ratingKey local caché dans les champs techniques d'historique Plex", () => {
  assert.equal(extractPlexLocalMetadataId('/library/metadata/218860/thumb/-1'), '218860');
  assert.equal(extractPlexLocalMetadataId('https://example.test/library/metadata/movie_12/art/123'), 'movie_12');
  assert.equal(getPlexMetadataLookupKey({ type: 'movie', metadataItemID: 4242 }), '4242');
  assert.equal(getPlexMetadataLookupKey({ type: 'movie', thumb: '/library/metadata/218860/thumb/-1' }), '218860');
  assert.equal(getPlexMetadataLookupKey({ type: 'movie', art: '/library/metadata/abc-12_def/art/99' }), 'abc-12_def');
});

test("ne confond jamais un GUID provider Plex avec un ratingKey local PMS", () => {
  assert.equal(extractPlexLocalMetadataId('plex://movie/5d7768244de0ee001fcc7fed'), null);
  assert.equal(getPlexMetadataLookupKey({ type: 'movie', metadataKey: 'plex://movie/provider-id' }), null);
});

test("récupère directement le ratingKey local de la série depuis grandparentKey ou grandparentThumb", () => {
  assert.equal(
    getPlexParentShowMetadataLookupKey({
      type: 'episode',
      grandparentKey: '/library/metadata/871'
    }),
    '871'
  );
  assert.equal(
    getPlexParentShowMetadataLookupKey({
      type: 'episode',
      grandparentThumb: '/library/metadata/show_parent/thumb/1234'
    }),
    'show_parent'
  );
  // La clé du show parent ne doit pas être prise pour la clé de l'épisode lui-même.
  assert.equal(
    getPlexMetadataLookupKey({
      type: 'episode',
      grandparentThumb: '/library/metadata/show_parent/thumb/1234'
    }),
    null
  );
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

test("ne promeut jamais le parentGuid saison d'un épisode en identité de série", () => {
  const parentIdentity = buildPlexParentShowIdentityItem({
    type: 'episode',
    guid: 'plex://episode/episode-hash',
    parentGuid: 'plex://season/season-hash'
  });

  assert.equal(parentIdentity.guid, 'plex://episode/episode-hash');
  assert.equal(extractPlexExternalIds(parentIdentity).plexGuid, 'episode-hash');
});

test("conserve le GUID épisode comme fallback quand grandparentGuid manque", () => {
  const parentIdentity = buildPlexParentShowIdentityItem({
    type: 'episode',
    guid: 'plex://episode/67adf81ed10fdd1250401f3e',
    grandparentTitle: "The Handmaid's Tale"
  });

  assert.equal(parentIdentity.guid, 'plex://episode/67adf81ed10fdd1250401f3e');
  assert.equal(extractPlexExternalIds(parentIdentity).plexGuid, '67adf81ed10fdd1250401f3e');
});

test("préfère le GUID épisode au grandparentKey quand le grandparentGuid manque", () => {
  const parentIdentity = buildPlexParentShowIdentityItem({
    type: 'episode',
    guid: 'plex://episode/EP_01-test',
    grandparentKey: '/library/metadata/show-parent',
    grandparentTitle: 'Série de test'
  });

  assert.equal(parentIdentity.guid, 'plex://episode/EP_01-test');
  assert.equal(parentIdentity.ratingKey, 'show-parent');
  assert.equal(extractPlexExternalIds(parentIdentity).plexGuid, 'EP_01-test');
});

test("utilise le grandparentKey uniquement en dernier recours", () => {
  const parentIdentity = buildPlexParentShowIdentityItem({
    type: 'episode',
    grandparentKey: '/library/metadata/show-parent',
    grandparentTitle: 'Série de test'
  });

  assert.equal(parentIdentity.guid, '/library/metadata/show-parent');
  assert.equal(parentIdentity.ratingKey, 'show-parent');
});

test("conserve le ratingKey parent trouvé dans grandparentThumb même sans grandparentKey", () => {
  const parentIdentity = buildPlexParentShowIdentityItem({
    type: 'episode',
    grandparentThumb: '/library/metadata/60715/thumb/123',
    grandparentTitle: 'Bref.'
  });

  assert.equal(parentIdentity.ratingKey, '60715');
});

test("ignore l'identifiant TMDB d'un épisode si la série parente est inconnue", () => {
  const parentIdentity = buildPlexParentShowIdentityItem({
    type: 'episode',
    Guid: [{ id: 'tmdb://999999' }]
  });

  assert.equal(extractPlexExternalIds(parentIdentity).tmdbId, null);
});

test("conserve le GUID Plex propre d'un épisode pour remonter ensuite à sa série", () => {
  const parentIdentity = buildPlexParentShowIdentityItem({
    type: 'episode',
    guid: 'plex://episode/episode-hash',
    Guid: [{ id: 'tmdb://999999' }]
  });

  assert.equal(parentIdentity.guid, 'plex://episode/episode-hash');
  assert.equal(extractPlexExternalIds(parentIdentity).tmdbId, null);
  assert.equal(extractPlexExternalIds(parentIdentity).plexGuid, 'episode-hash');
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
