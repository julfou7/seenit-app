import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractExactTMDBRemoteId,
  getTVDBEntityIdentity,
  selectSingleOfficialTVDBList,
} from '../src/services/tvdb.ts';

test('TVDB choisit uniquement une liste officielle unique', () => {
  assert.deepEqual(
    selectSingleOfficialTVDBList([
      { id: 10, name: 'Community Universe', isOfficial: false },
      { id: 20, name: 'Official Franchise', isOfficial: true },
    ]),
    { id: 20, name: 'Official Franchise', isOfficial: true },
  );

  assert.equal(selectSingleOfficialTVDBList([
    { id: 20, isOfficial: true },
    { id: 21, isOfficial: true },
  ]), null, 'deux listes officielles sont ambiguës et doivent être masquées');

  assert.equal(selectSingleOfficialTVDBList([
    { id: 30, name: 'Famous Universe', isOfficial: false },
  ]), null, 'un nom de liste ne constitue jamais une preuve');
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
