import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MEDIA_RELATION_GROUPS,
  getManifestGroupsForMedia,
  getManifestRelationSnapshot,
  mediaKeyFrom,
  relationMediaKeys,
  toMediaKey,
  type MediaKey,
} from '../src/features/shows/mediaRelations.ts';

const tmdbClientSource = readFileSync(new URL('../src/features/shows/tmdbClient.ts', import.meta.url), 'utf8');
const detailSource = readFileSync(new URL('../src/screens/ShowDetailScreen.tsx', import.meta.url), 'utf8');
const mediaRelationsSource = readFileSync(new URL('../src/features/shows/mediaRelations.ts', import.meta.url), 'utf8');

const keysFor = (mediaKey: MediaKey, kind: 'saga' | 'universe' = 'universe') => {
  const relation = getManifestGroupsForMedia(mediaKey).find(group => group.relationKind === kind);
  return relation?.members.map(member => member.mediaKey) || [];
};

test('SEENIT-RELATION-001 rend Yellowstone et Breaking Bad exacts et réciproques', () => {
  const yellowstone = keysFor('tv:73586');
  assert.deepEqual(yellowstone, [
    'tv:73586', 'tv:118357', 'tv:157744', 'tv:157732', 'tv:290856', 'tv:299167',
  ]);
  for (const member of yellowstone) assert.deepEqual(keysFor(member), yellowstone);

  const breakingBad = keysFor('tv:1396');
  assert.deepEqual(breakingBad, ['tv:1396', 'tv:60059', 'movie:559969']);
  for (const member of breakingBad) assert.deepEqual(keysFor(member), breakingBad);
});

test('SEENIT-RELATION-001 relie les onze films Wizarding World et la série par identités exactes', () => {
  const wizardingWorld = keysFor('movie:671');
  assert.equal(wizardingWorld.length, 12);
  assert.ok(wizardingWorld.includes('movie:338953'));
  assert.ok(wizardingWorld.includes('tv:224377'));
  assert.deepEqual(keysFor('movie:338953'), wizardingWorld);
  assert.deepEqual(keysFor('tv:224377'), wizardingWorld);
});

test('SEENIT-RELATION-001 sépare MCU, DCEU, DCU, Arrowverse et Batman', () => {
  const mcu = keysFor('movie:1726');
  assert.ok(mcu.includes('movie:299534'));
  assert.ok(mcu.includes('tv:85271'));
  assert.ok(!mcu.includes('movie:36657'), 'X-Men ne doit pas rejoindre implicitement le MCU');

  const nolan = keysFor('movie:155', 'saga');
  assert.deepEqual(nolan, ['movie:272', 'movie:155', 'movie:49026']);
  assert.equal(getManifestGroupsForMedia('movie:155').some(group => group.relationKind === 'universe'), false);
  assert.notEqual(keysFor('movie:49521')[0], keysFor('movie:1061474')[0]);
  assert.notEqual(keysFor('tv:1412')[0], keysFor('movie:414906')[0]);
});

test('SEENIT-RELATION-001 relie The Punisher 2017 à One Last Kill sans fusionner le film 2004', () => {
  const punisher = keysFor('tv:67178');
  assert.ok(punisher.includes('movie:1439930'));
  assert.deepEqual(keysFor('movie:1439930'), punisher);
  assert.ok(!punisher.includes('movie:7220'), 'Le film The Punisher de 2004 reste une continuité distincte');
  assert.equal(getManifestRelationSnapshot('movie:7220'), null);
});

test('SEENIT-RELATION-001 applique le même résolveur réciproque à tous les groupes du manifeste', () => {
  for (const relation of MEDIA_RELATION_GROUPS) {
    const expected = relation.members.map(member => member.mediaKey);
    for (const member of relation.members) {
      const resolved = getManifestGroupsForMedia(member.mediaKey)
        .find(candidate => candidate.groupId === relation.groupId);
      assert.ok(resolved, `${member.mediaKey} doit retrouver le groupe ${relation.groupId}`);
      assert.deepEqual(resolved.members.map(candidate => candidate.mediaKey), expected);
    }
  }
});

test('SEENIT-RELATION-001 interdit tout matching nominatif dans les résolveurs de manifeste', () => {
  const lookupSource = mediaRelationsSource.slice(
    mediaRelationsSource.indexOf('export function getManifestGroupsForMedia'),
    mediaRelationsSource.indexOf('export function materializeRelationGroup'),
  );
  const snapshotSource = mediaRelationsSource.slice(
    mediaRelationsSource.indexOf('export function getManifestRelationSnapshot'),
    mediaRelationsSource.indexOf('export function relationMediaKeys'),
  );
  assert.match(lookupSource, /groupsByMediaKey\.get\(mediaKey\)/);
  assert.doesNotMatch(lookupSource, /title|name|label|year|popularity|startsWith|includes|RegExp/i);
  assert.doesNotMatch(snapshotSource, /title|name|label|year|popularity|startsWith|includes|RegExp/i);
});

test('SEENIT-RELATION-001 masque les auto-relations et qualifie les IDs par type', () => {
  assert.equal(getManifestRelationSnapshot('tv:250988'), null);
  assert.notEqual(toMediaKey('movie', 42), toMediaKey('tv', 42));
  assert.equal(mediaKeyFrom({ id: 42, title: 'Film' }), 'movie:42');
  assert.equal(mediaKeyFrom({ id: 42, name: 'Série' }), 'tv:42');

  const typedKeys = relationMediaKeys([
    { id: 42, media_type: 'movie' },
    { id: 42, media_type: 'tv' },
  ]);
  assert.deepEqual([...typedKeys], ['movie:42', 'tv:42']);
});

test('SEENIT-RELATION-001 n’accepte que des groupes versionnés à provenance explicite', () => {
  assert.ok(MEDIA_RELATION_GROUPS.length >= 8);
  for (const relation of MEDIA_RELATION_GROUPS) {
    assert.equal(relation.source, 'seenit-manifest');
    assert.ok(relation.groupId);
    assert.ok(relation.sourceGroupId);
    assert.ok(relation.version >= 1);
    assert.ok(relation.members.length > 1);
    assert.equal(new Set(relation.members.map(member => member.mediaKey)).size, relation.members.length);
  }
});

test('SEENIT-RELATION-001 retire les fallbacks titre TVDB et déduplique les similaires par mediaKey', () => {
  const resolverSource = tmdbClientSource.slice(
    tmdbClientSource.indexOf('async getUniverseAndCollection'),
    tmdbClientSource.indexOf('async getCollectionDetails'),
  );
  assert.doesNotMatch(resolverSource, /searchMulti|getTVDBFranchiseTimeline|original_title|popularity|vote_count/);
  assert.match(resolverSource, /getManifestRelationSnapshot/);
  assert.match(detailSource, /getPrioritizedSimilarMedia\(tmdbDetails, collectionData, universeData\)/);
  assert.match(detailSource, /excludedKeys\.has\(itemKey\)/);
});
