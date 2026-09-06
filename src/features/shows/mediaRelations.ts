import { MEDIA_RELATION_CATALOG } from './mediaRelations.generated.ts';

export type RelationMediaType = 'movie' | 'tv';
export type MediaKey = `${RelationMediaType}:${number}`;
export type RelationKind = 'saga' | 'universe';

export interface MediaRelationMember {
  mediaKey: MediaKey;
  mediaType: RelationMediaType;
  tmdbId: number;
  label: string;
  releaseDate: string;
  posterPath: string | null;
}

export interface MediaRelationProvenance {
  provider: 'seenit-editorial-review' | 'tmdb-collection' | 'tvdb-approved-list' | 'wikidata-narrative-universe' | 'wikidata-series';
  reference: string;
  reviewedAt: string;
}

export interface MediaRelationGroup {
  groupId: string;
  relationKind: RelationKind;
  source: 'seenit-manifest';
  sourceGroupId: string;
  version: number;
  provenance: MediaRelationProvenance;
  members: readonly MediaRelationMember[];
}

export interface MediaRelationSnapshot {
  collection: any[];
  universe: any[];
}

export const MEDIA_RELATION_GROUPS: readonly MediaRelationGroup[] = Object.freeze(
  MEDIA_RELATION_CATALOG.map(relationGroup => Object.freeze({
    ...relationGroup,
    members: Object.freeze(relationGroup.members.map(relationMember => Object.freeze({ ...relationMember }))),
  })),
);

const groupsByMediaKey = new Map<MediaKey, MediaRelationGroup[]>();
for (const relationGroup of MEDIA_RELATION_GROUPS) {
  for (const relationMember of relationGroup.members) {
    const existing = groupsByMediaKey.get(relationMember.mediaKey) || [];
    if (existing.some(candidate => candidate.relationKind === relationGroup.relationKind)) {
      throw new Error(`Relation ${relationGroup.relationKind} dupliquée pour ${relationMember.mediaKey}`);
    }
    groupsByMediaKey.set(relationMember.mediaKey, [...existing, relationGroup]);
  }
}

export function toMediaKey(mediaType: RelationMediaType, tmdbId: number): MediaKey {
  return `${mediaType}:${Number(tmdbId)}`;
}

export function mediaKeyFrom(item: any, fallbackType?: RelationMediaType): MediaKey | null {
  const id = Number(item?.tmdbId ?? item?.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const mediaType = item?.mediaType || item?.media_type || fallbackType
    || (item?.title !== undefined || item?.release_date !== undefined ? 'movie' : 'tv');
  if (mediaType !== 'movie' && mediaType !== 'tv') return null;
  return toMediaKey(mediaType, id);
}

export function getManifestGroupsForMedia(mediaKey: MediaKey): readonly MediaRelationGroup[] {
  return groupsByMediaKey.get(mediaKey) || [];
}

export function materializeRelationGroup(relationGroup: MediaRelationGroup): any[] {
  return relationGroup.members.map((item, index) => ({
    id: item.tmdbId,
    media_type: item.mediaType,
    ...(item.mediaType === 'movie'
      ? { title: item.label, release_date: item.releaseDate }
      : { name: item.label, first_air_date: item.releaseDate }),
    poster_path: item.posterPath,
    relationGroupId: relationGroup.groupId,
    relationSource: relationGroup.source,
    ...(relationGroup.relationKind === 'saga' ? { sagaOrder: index + 1 } : {}),
  }));
}

export function getManifestRelationSnapshot(mediaKey: MediaKey): MediaRelationSnapshot | null {
  const groups = getManifestGroupsForMedia(mediaKey);
  if (groups.length === 0) return null;
  const saga = groups.find(candidate => candidate.relationKind === 'saga');
  const universe = groups.find(candidate => candidate.relationKind === 'universe');
  return {
    collection: saga ? materializeRelationGroup(saga) : [],
    universe: universe ? materializeRelationGroup(universe) : [],
  };
}

export function relationMediaKeys(items: readonly any[], fallbackType?: RelationMediaType): Set<MediaKey> {
  const keys = new Set<MediaKey>();
  for (const item of items || []) {
    const key = mediaKeyFrom(item, fallbackType);
    if (key) keys.add(key);
  }
  return keys;
}

export class BoundedCache<K, V> {
  private readonly entries = new Map<K, V>();
  private readonly maximumSize: number;

  constructor(maximumSize: number) {
    if (!Number.isInteger(maximumSize) || maximumSize < 1) {
      throw new Error('maximumSize doit être un entier positif');
    }
    this.maximumSize = maximumSize;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maximumSize) {
      const oldestKey = this.entries.keys().next().value as K | undefined;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }
}
