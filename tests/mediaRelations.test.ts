import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { toMediaKey } from '../src/features/shows/mediaRelations.ts';

const tmdbSource = readFileSync(new URL('../src/features/shows/tmdb.ts', import.meta.url), 'utf8');
const tvdbClientSource = readFileSync(new URL('../src/services/tvdb.ts', import.meta.url), 'utf8');
const detailSource = readFileSync(new URL('../src/screens/ShowDetailScreenCore.tsx', import.meta.url), 'utf8');
const explorerSource = readFileSync(new URL('../src/lib/recommendations.ts', import.meta.url), 'utf8');

test('SEENIT-RELATION-001 conserve une identité typée movie et tv', () => {
  assert.equal(toMediaKey('movie', 42), 'movie:42');
  assert.equal(toMediaKey('tv', 42), 'tv:42');
  assert.notEqual(toMediaKey('movie', 42), toMediaKey('tv', 42));
});

test('SEENIT-RELATION-001 réserve la saga film à la collection TMDB exacte', () => {
  assert.match(tmdbSource, /mediaType !== 'movie'\) return \[\]/);
  assert.match(tmdbSource, /belongs_to_collection\?\.id/);
  assert.match(tmdbSource, /getCollectionDetails\(collectionId\)/);
  assert.doesNotMatch(tmdbSource, /getManifestRelationSnapshot/);
});

test('SEENIT-RELATION-001 appelle TVDB uniquement avec les identifiants externes exacts', () => {
  assert.match(tmdbSource, /external_ids\?\.tvdb_id/);
  assert.match(tmdbSource, /external_ids\?\.imdb_id/);
  assert.match(tmdbSource, /getTVDBFranchiseRelation/);
  assert.match(tvdbClientSource, /authenticatedFetch/);
  assert.match(tvdbClientSource, /\/api\/media\/tvdb\/franchise/);
  assert.doesNotMatch(tvdbClientSource, /mediaTitle|original_title|popularity|api4\.thetvdb\.com|TVDB_API_KEY/);
});

test('SEENIT-RELATION-001 déduplique TVDB après la collection par clé typée', () => {
  assert.match(tmdbSource, /collectionKeys\.has\(itemKey\)/);
  assert.match(tmdbSource, /universeSeen\.has\(itemKey\)/);
  assert.match(tmdbSource, /seenitRelationKind: relationKind/);
});

test('SEENIT-RELATION-001 retire les similaires de la fiche mais pas la découverte Explorer', () => {
  assert.match(tmdbSource, /similar: _similar, recommendations: _recommendations/);
  assert.doesNotMatch(detailSource, /getPrioritizedSimilarMedia|Films similaires|Séries similaires|visibleSimilar|similarObserverRef/);
  assert.match(detailSource, /Dans la même franchise/);
  assert.match(detailSource, /seenitRelationKind === 'franchise'/);
  assert.match(explorerSource, /recommend/i);
});
