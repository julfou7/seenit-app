import type { Show } from '../../types.ts';
import { normalizeCharacterName, type CharacterRecord } from './characters.ts';

export const CHARACTER_SEARCH_FAST_BATCH_SIZE = 8;
export const CHARACTER_SEARCH_BATCH_SIZE = 16;
export const CHARACTER_SEARCH_CONCURRENCY = 3;

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

export function orderedCharacterSearchKeys(shows: readonly Show[]) {
  const eligible = shows.filter(show => Number.isInteger(Number(show.tmdbId)) && Number(show.tmdbId) > 0);
  const sorted = [...eligible].sort((left, right) => {
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

export function buildCharacterSearchBatchesFromKeys(keys: readonly string[]) {
  const unique = [...new Set(keys)];
  if (!unique.length) return [] as string[][];
  const firstSize = Math.min(CHARACTER_SEARCH_FAST_BATCH_SIZE, unique.length);
  const batches = [unique.slice(0, firstSize)];
  for (let offset = firstSize; offset < unique.length; offset += CHARACTER_SEARCH_BATCH_SIZE) {
    batches.push(unique.slice(offset, offset + CHARACTER_SEARCH_BATCH_SIZE));
  }
  return batches;
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
