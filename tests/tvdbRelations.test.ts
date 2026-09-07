import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyTVDBList,
  extractExactTMDBRemoteId,
  extractExactTVDBSearchIdentity,
  getTVDBEntityIdentity,
  selectSingleOfficialTVDBList,
} from '../src/services/tvdb.ts';

test('TVDB choisit uniquement une liste officielle unique et qualifiable', () => {
  assert.deepEqual(
    selectSingleOfficialTVDBList([
      { id: 10, name: 'Community Universe', isOfficial: false },
      { id: 20, name: 'Official Franchise', isOfficial: true },
    ]),
    { id: 20, name: 'Official Franchise', isOfficial: true },
  );

  assert.equal(selectSingleOfficialTVDBList([
    { id: 20, name: 'Official Franchise', isOfficial: true },
    { id: 21, name: 'Official Universe', isOfficial: true },
  ]), null, 'deux listes officielles admissibles sont ambiguës et doivent être masquées');

  assert.equal(selectSingleOfficialTVDBList([
    { id: 30, name: 'Famous Universe', isOfficial: false },
  ]), null, 'un nom de liste ne remplace jamais le statut officiel');

  assert.equal(selectSingleOfficialTVDBList([
    { id: 40, name: 'Award Winners', isOfficial: true },
  ]), null, 'une liste officielle générique ne doit pas être transformée en franchise');
});

test('TVDB qualifie seulement la liste exacte déjà atteinte pour le libellé UI', () => {
  assert.equal(classifyTVDBList({ name: 'Game of Thrones Franchise' }), 'franchise');
  assert.equal(classifyTVDBList({ nameTranslated: 'Marvel Cinematic Universe' }), 'universe');
  assert.equal(classifyTVDBList({ name: 'Best of 2026' }), null);
});

test('TVDB conserve une identité typée et rejette les entités ambiguës', () => {
  assert.deepEqual(getTVDBEntityIdentity({ seriesId: 42 }), { id: 42, media_type: 'tv' });
  assert.deepEqual(getTVDBEntityIdentity({ movieId: 42 }), { id: 42, media_type: 'movie' });
  assert.equal(getTVDBEntityIdentity({ seriesId: 42, movieId: 42 }), null);
  assert.equal(getTVDBEntityIdentity({}), null);
});

test('TVDB exige une identité TMDB externe unique et explicite', () => {
  assert.equal(extractExactTMDBRemoteId([{ type: 12, id: '1396' }]), 1396);
  assert.equal(extractExactTMDBRemoteId([{ sourceName: 'TheMovieDB.com', id: '559969' }]), 559969);
  assert.equal(extractExactTMDBRemoteId([{ sourceName: 'IMDb', id: '123' }]), null);
  assert.equal(extractExactTMDBRemoteId([
    { type: 12, id: '1396' },
    { sourceName: 'TMDB', id: '60059' },
  ]), null, 'des IDs TMDB contradictoires ne doivent jamais être départagés');
});

test('TVDB résout un remote ID exact dans le type demandé sans premier résultat implicite', () => {
  assert.equal(extractExactTVDBSearchIdentity([{ movie: { id: 101 } }], 'movie'), 101);
  assert.equal(extractExactTVDBSearchIdentity([{ series: { id: 202 } }], 'tv'), 202);
  assert.equal(extractExactTVDBSearchIdentity([{ movie: { id: 101 } }], 'tv'), null);
  assert.equal(extractExactTVDBSearchIdentity([
    { movie: { id: 101 } },
    { movie: { id: 102 } },
  ], 'movie'), null, 'plusieurs identités du même type restent ambiguës');
});
