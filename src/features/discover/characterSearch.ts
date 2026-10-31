import type { Show } from '../../types.ts';
import { buildCharacters, normalizeCharacterName, type CharacterCast, type CharacterMedia, type CharacterRecord } from './characters.ts';
import { getManifestGroupsForMedia, type MediaKey } from '../shows/mediaRelations.ts';
import type { ActorIndex } from '../people/movieActors.ts';

export const CHARACTER_SEARCH_FAST_BATCH_SIZE = 8;
export const CHARACTER_SEARCH_BATCH_SIZE = 16;
export const CHARACTER_SEARCH_CONCURRENCY = 3;
export const CHARACTER_SEARCH_CACHE_CONCURRENCY = 12;

type CachedCharacterDetails = {
  runtime?: unknown;
  aggregate_credits?: { cast?: unknown };
  credits?: { cast?: unknown };
  belongs_to_collection?: unknown;
};

type CachedCastMember = {
  id?: unknown;
  name?: unknown;
  profile_path?: unknown;
  roles?: unknown;
  character?: unknown;
  episode_count?: unknown;
  total_episode_count?: unknown;
};

type CachedRole = {
  character?: unknown;
  episode_count?: unknown;
};

type CachedCollection = {
  id?: unknown;
  name?: unknown;
};

function mediaKey(show: Show) {
  return `${show.mediaType}:${Number(show.tmdbId)}`;
}

function priorityBucket(show: Show) {
  if (show.isArchived) return 5;
  if (show.status === 'watching') return 0;
  if (show.isFavorite) return 1;
  if (show.status === 'plan_to_watch') return 2;
  if (show.status === 'completed') return 3;
  return 4;
}

function activityTimestamp(show: Show) {
  return Math.max(Number(show.lastWatchedAt || 0), Number(show.updatedAt || 0), Number(show.createdAt || 0));
}

export function preferredCharacterSearchKeysFromActorIndex(index: ActorIndex, query: string) {
  const needle = normalizeCharacterName(query);
  if (needle.length < 2) return [] as string[];
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const actor of Object.values(index || {})) {
    for (const title of actor.seen || []) {
      if (!normalizeCharacterName(title.character || '').includes(needle)) continue;
      const key = `${title.mediaType}:${Number(title.tmdbId)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

export function orderedCharacterSearchKeys(shows: readonly Show[], preferredKeys: readonly string[] = []) {
  const eligible = shows.filter(show => Number.isInteger(Number(show.tmdbId)) && Number(show.tmdbId) > 0);
  const preferredRank = new Map(preferredKeys.map((key, index) => [key, index]));
  const sorted = [...eligible].sort((left, right) => {
    const leftPreferred = preferredRank.get(mediaKey(left));
    const rightPreferred = preferredRank.get(mediaKey(right));
    if (leftPreferred !== undefined || rightPreferred !== undefined) {
      if (leftPreferred === undefined) return 1;
      if (rightPreferred === undefined) return -1;
      if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred;
    }
    const bucket = priorityBucket(left) - priorityBucket(right);
    if (bucket) return bucket;
    const activity = activityTimestamp(right) - activityTimestamp(left);
    if (activity) return activity;
    return mediaKey(left).localeCompare(mediaKey(right));
  });
  const seen = new Set<string>();
  return sorted.flatMap(show => {
    const key = mediaKey(show);
    if (seen.has(key)) return [];
    seen.add(key);
    return [key];
  });
}

export function buildCharacterSearchBatchesFromKeys(keys: readonly string[], preferredCount = 0) {
  const unique = [...new Set(keys)];
  if (!unique.length) return [] as string[][];
  const prioritySize = Math.min(Math.max(0, Math.floor(preferredCount)), CHARACTER_SEARCH_FAST_BATCH_SIZE, unique.length);
  const firstSize = prioritySize || Math.min(CHARACTER_SEARCH_FAST_BATCH_SIZE, unique.length);
  const batches = [unique.slice(0, firstSize)];
  for (let offset = firstSize; offset < unique.length; offset += CHARACTER_SEARCH_BATCH_SIZE) {
    batches.push(unique.slice(offset, offset + CHARACTER_SEARCH_BATCH_SIZE));
  }
  return batches;
}

function positiveInteger(value: unknown) {
  const count = Number(value);
  return Number.isInteger(count) && count > 0 ? count : null;
}

function cachedCharacterMedia(show: Show, details: unknown): CharacterMedia | null {
  if (!details || typeof details !== 'object') return null;
  const payload = details as CachedCharacterDetails;
  const key = mediaKey(show) as MediaKey;
  const groups = getManifestGroupsForMedia(key);
  const group = groups.find(item => item.relationKind === 'universe') || groups[0];
  const collectionValue = payload.belongs_to_collection;
  const collection = collectionValue && typeof collectionValue === 'object' && !Array.isArray(collectionValue)
    ? collectionValue as CachedCollection
    : null;
  const collectionId = positiveInteger(collection?.id);
  const collectionName = typeof collection?.name === 'string' ? collection.name.trim() : '';
  const source = show.mediaType === 'tv'
    ? (Array.isArray(payload.aggregate_credits?.cast) ? payload.aggregate_credits.cast : payload.credits?.cast)
    : payload.credits?.cast;
  if (!Array.isArray(source)) return null;
  const cast: CharacterCast[] = source.slice(0, 200).flatMap(actorValue => {
    if (!actorValue || typeof actorValue !== 'object') return [];
    const actor = actorValue as CachedCastMember;
    const id = Number(actor.id);
    const actorName = typeof actor.name === 'string' ? actor.name.trim() : '';
    if (!Number.isInteger(id) || id <= 0 || !actorName) return [];
    const rawRoles: unknown[] = show.mediaType === 'tv' && Array.isArray(actor.roles) && actor.roles.length
      ? actor.roles.slice(0, 24)
      : typeof actor.character === 'string' && actor.character.trim()
        ? [{ character: actor.character, episode_count: actor.episode_count ?? actor.total_episode_count }]
        : [];
    const roles = rawRoles.flatMap(roleValue => {
      if (!roleValue || typeof roleValue !== 'object') return [];
      const role = roleValue as CachedRole;
      const name = typeof role.character === 'string' ? role.character.trim() : '';
      return name ? [{ name, count: positiveInteger(role.episode_count) }] : [];
    });
    return roles.length ? [{
      id,
      name: actorName,
      photo: typeof actor.profile_path === 'string' && actor.profile_path ? actor.profile_path : null,
      roles,
    }] : [];
  });
  if (!cast.length) return null;
  return {
    key,
    id: Number(show.tmdbId),
    type: show.mediaType,
    title: show.title,
    poster: show.posterPath,
    releaseDate: show.firstAirDate,
    runtime: Number.isFinite(Number(payload.runtime)) ? Number(payload.runtime) : null,
    cinema: false,
    universeId: group?.groupId || (collectionId ? `collection:${collectionId}` : key),
    universe: group?.members[0]?.label || collectionName || show.title,
    cast,
    collectionId: collectionId || undefined,
    coverageComplete: false,
    seasons: [],
  };
}

export function buildCachedTrackedCharacterResults(shows: readonly Show[], metadata: ReadonlyMap<string, unknown>, query: string) {
  const needle = normalizeCharacterName(query);
  if (needle.length < 2) return [] as CharacterRecord[];
  const media = shows.flatMap(show => {
    const cached = cachedCharacterMedia(show, metadata.get(mediaKey(show)));
    return cached ? [cached] : [];
  });
  return buildCharacters(media).filter(character =>
    [character.name, ...character.aliases].some(name => normalizeCharacterName(name).includes(needle)),
  );
}

export function mergeCharacterSearchRecords(left: CharacterRecord, right: CharacterRecord): CharacterRecord {
  if (left.id !== right.id) return right;
  const aliases = [...new Set([...left.aliases, ...right.aliases])];
  const actors = [...left.actors];
  for (const actor of right.actors) if (!actors.some(existing => existing.id === actor.id)) actors.push(actor);
  const works = left.works.map(work => ({ ...work }));
  for (const work of right.works) {
    const existing = works.find(candidate => candidate.key === work.key);
    if (!existing) works.push({ ...work });
    else Object.assign(existing, work, { creditCount: existing.creditCount ?? work.creditCount });
  }
  works.sort((a, b) => (a.releaseDate || '9999').localeCompare(b.releaseDate || '9999'));
  return {
    ...left,
    ...right,
    name: left.name || right.name,
    seed: left.seed || right.seed,
    aliases,
    actors,
    works,
    complete: Boolean(left.complete && right.complete),
  };
}

function textMatchRank(character: CharacterRecord, query: string) {
  const needle = normalizeCharacterName(query);
  const names = [character.name, ...character.aliases].map(normalizeCharacterName).filter(Boolean);
  if (names.some(name => name === needle)) return 0;
  if (names.some(name => name.startsWith(needle))) return 1;
  return 2;
}

export function sortCharacterSearchResults(results: readonly CharacterRecord[], orderedKeys: readonly string[], query: string) {
  const keyRank = new Map(orderedKeys.map((key, index) => [key, index]));
  const workRank = (character: CharacterRecord) => character.works.reduce((best, work) => Math.min(best, keyRank.get(work.key) ?? Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
  return [...results].sort((left, right) => {
    const match = textMatchRank(left, query) - textMatchRank(right, query);
    if (match) return match;
    const tracked = workRank(left) - workRank(right);
    if (tracked) return tracked;
    return left.name.localeCompare(right.name, 'fr', { sensitivity: 'base' });
  });
}

export async function runCharacterSearchBatches<T>(
  batches: readonly string[][],
  worker: (batch: readonly string[], index: number) => Promise<T>,
  onBatch: (value: T, index: number) => void,
  signal: AbortSignal,
  concurrency = CHARACTER_SEARCH_CONCURRENCY,
) {
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, Math.floor(concurrency)), batches.length);
  const run = async () => {
    while (!signal.aborted) {
      const index = cursor++;
      if (index >= batches.length) return;
      const value = await worker(batches[index], index);
      if (signal.aborted) return;
      onBatch(value, index);
    }
  };
  await Promise.all(Array.from({ length: workerCount }, run));
}
