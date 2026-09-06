import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  MEDIA_RELATION_CATALOG,
  MEDIA_RELATION_CATALOG_SHA256,
  MEDIA_RELATION_CATALOG_VERSION,
} from '../src/features/shows/mediaRelations.generated.ts';

const require = createRequire(import.meta.url);
const {
  normalizeCatalog,
  renderSnapshot,
} = require('../scripts/media-relations-catalog.cjs');
const {
  buildCandidateSnapshot,
  queryFor,
} = require('../scripts/discover-media-relations.cjs');

const member = (mediaKey: `movie:${number}` | `tv:${number}`) => {
  const [mediaType, id] = mediaKey.split(':');
  return {
    mediaKey,
    mediaType,
    tmdbId: Number(id),
    label: `Libellé ${mediaKey}`,
    releaseDate: '2026-01-01',
    posterPath: null,
  };
};

const catalog = (groups: any[]) => ({
  schemaVersion: 1,
  catalogVersion: 1,
  groups,
});

const group = (members: string[], overrides: Record<string, unknown> = {}) => ({
  groupId: 'fixture-universe',
  relationKind: 'universe',
  sourceGroupId: 'Q100',
  version: 1,
  provenance: {
    provider: 'wikidata-narrative-universe',
    reference: 'https://www.wikidata.org/wiki/Q100',
    reviewedAt: '2026-09-06',
  },
  members: members.map(key => member(key as `movie:${number}` | `tv:${number}`)),
  ...overrides,
});

const binding = (
  relationGroup: number,
  work: number,
  mediaType: 'movie' | 'tv',
  tmdbId: number,
  relationKind: 'saga' | 'universe' = 'universe',
) => ({
  relationGroup: { value: `http://www.wikidata.org/entity/Q${relationGroup}` },
  relationKind: { value: relationKind },
  work: { value: `http://www.wikidata.org/entity/Q${work}` },
  mediaType: { value: mediaType },
  tmdbId: { value: String(tmdbId) },
});

test('SEENIT-RELATION-001 génère un snapshot déterministe depuis le catalogue éditorial', () => {
  const rendered = renderSnapshot({
    ...catalog([group(['tv:2', 'movie:1'])]),
    catalogVersion: MEDIA_RELATION_CATALOG_VERSION,
  });
  assert.equal(rendered, renderSnapshot({
    ...catalog([group(['movie:1', 'tv:2'])]),
    catalogVersion: MEDIA_RELATION_CATALOG_VERSION,
  }));
  assert.match(rendered, /Fichier généré/);
  assert.match(MEDIA_RELATION_CATALOG_SHA256, /^[a-f0-9]{64}$/);
  assert.ok(MEDIA_RELATION_CATALOG.length >= 9);
});

test('SEENIT-RELATION-001 rejette les identités, conflits et champs heuristiques', () => {
  assert.throws(
    () => normalizeCatalog(catalog([group(['movie:1', 'tv:2'], { title: 'Univers deviné' })])),
    /champ interdit ou inconnu « title »/,
  );
  assert.throws(
    () => normalizeCatalog(catalog([group(['movie:1', 'tv:2'], {
      members: [member('movie:1'), { ...member('tv:2'), tmdbId: 999 }],
    })])),
    /tmdbId diverge de mediaKey/,
  );
  assert.throws(
    () => normalizeCatalog(catalog([
      group(['movie:1', 'tv:2']),
      group(['movie:1', 'tv:3'], { groupId: 'second-universe', sourceGroupId: 'Q200' }),
    ])),
    /appartient à deux groupes universe/,
  );
});

test('SEENIT-RELATION-001 découvre des candidats exacts sans les publier', () => {
  const currentCatalog = catalog([group(['movie:90', 'tv:91'])]);
  const snapshot = buildCandidateSnapshot([
    binding(500, 1, 'movie', 10),
    binding(500, 2, 'tv', 20),
  ], currentCatalog, '2026-09-06T10:00:00.000Z');
  assert.equal(snapshot.candidates.length, 1);
  assert.deepEqual(snapshot.candidates[0], {
    candidateId: 'wikidata-universe:Q500',
    relationKind: 'universe',
    source: 'wikidata-narrative-universe',
    sourceGroupId: 'Q500',
    reference: 'https://www.wikidata.org/wiki/Q500',
    reviewStatus: 'pending-review',
    members: ['movie:10', 'tv:20'],
    overlaps: [],
  });
  assert.doesNotMatch(JSON.stringify(snapshot.candidates[0]), /title|year|popularity|brand|cast/i);
});

test('SEENIT-RELATION-001 écarte un mapping Wikidata typé ambigu', () => {
  const snapshot = buildCandidateSnapshot([
    binding(500, 1, 'movie', 10),
    binding(500, 1, 'tv', 10),
    binding(500, 2, 'tv', 20),
  ], catalog([group(['movie:90', 'tv:91'])]), '2026-09-06T10:00:00.000Z');
  assert.equal(snapshot.candidates.length, 0);
  assert.deepEqual(snapshot.rejected, [{ workId: 'Q1', reason: 'typed_identity_ambiguous' }]);
});

test('SEENIT-RELATION-001 limite la découverte hors ligne aux propriétés structurées exactes', () => {
  const query = queryFor(0);
  assert.match(query, /wdt:P1080/);
  assert.match(query, /wdt:P179/);
  assert.match(query, /wdt:P4947/);
  assert.match(query, /wdt:P4983/);
  assert.doesNotMatch(query, /label|title|year|popularity|keyword|cast|studio/i);
});
