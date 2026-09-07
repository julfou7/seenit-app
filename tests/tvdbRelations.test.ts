import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyTVDBList,
  extractExactTMDBRemoteId,
  extractExactTVDBSearchIdentity,
  getTVDBEntityIdentity,
  selectSingleOfficialTVDBList,
} from '../src/features/providers/mediaProviderBackend.ts';

test('SEENIT-RELATION-001 qualifie uniquement franchise ou univers explicites', () => {
  assert.equal(classifyTVDBList({ name: 'Game of Thrones Franchise' }), 'franchise');
  assert.equal(classifyTVDBList({ name: 'Marvel Cinematic Universe' }), 'universe');
  assert.equal(classifyTVDBList({ name: 'Award Winners' }), null);
});

test('SEENIT-RELATION-001 retient une seule liste officielle admissible', () => {
  const franchise = { id: 7038, isOfficial: true, name: 'Game of Thrones Franchise' };
  assert.deepEqual(selectSingleOfficialTVDBList([franchise]), franchise);
  assert.equal(selectSingleOfficialTVDBList([franchise, { id: 2, isOfficial: true, name: 'Other Franchise' }]), null);
  assert.equal(selectSingleOfficialTVDBList([{ id: 1, isOfficial: true, name: 'Award Winners' }]), null);
  assert.equal(selectSingleOfficialTVDBList([{ id: 1, isOfficial: false, name: 'Example Franchise' }]), null);
});

test('SEENIT-RELATION-001 conserve le type exact des membres TVDB', () => {
  assert.deepEqual(getTVDBEntityIdentity({ seriesId: 121361 }), { id: 121361, media_type: 'tv' });
  assert.deepEqual(getTVDBEntityIdentity({ movieId: 603 }), { id: 603, media_type: 'movie' });
  assert.equal(getTVDBEntityIdentity({ seriesId: 1, movieId: 2 }), null);
});

test('SEENIT-RELATION-001 remappe un membre TVDB vers un unique TMDB exact', () => {
  assert.equal(extractExactTMDBRemoteId([{ type: 12, id: '94997' }]), 94997);
  assert.equal(extractExactTMDBRemoteId([{ sourceName: 'TMDB', id: '94997' }]), 94997);
  assert.equal(extractExactTMDBRemoteId([{ type: 12, id: '1' }, { type: 12, id: '2' }]), null);
});

test('SEENIT-RELATION-001 résout le pont IMDb remoteid sans premier résultat arbitraire', () => {
  assert.equal(extractExactTVDBSearchIdentity([{ type: 'movie', tvdb_id: '123' }], 'movie'), 123);
  assert.equal(extractExactTVDBSearchIdentity([{ type: 'series', tvdb_id: '456' }], 'tv'), 456);
  assert.equal(extractExactTVDBSearchIdentity([{ type: 'movie', tvdb_id: '123' }, { type: 'movie', tvdb_id: '456' }], 'movie'), null);
  assert.equal(extractExactTVDBSearchIdentity([{ type: 'series', tvdb_id: '456' }], 'movie'), null);
});
