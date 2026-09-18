import { ok, tryCatch } from '../../core/Result';
import { authenticatedFetch } from '../../lib/apiAuth';
import { getParentalRatingOverride } from '../../store/parentalRatingStore';
import { discoverSeenIt, type SeenItDiscoverOptions } from '../shows/tmdbCore';
import { tmdb } from '../shows/tmdbClient';
import { matchesMaxRecommendedAge, parseMaxAgeFilter, resolveParentalRating } from '../shows/parentalRating';
import { filterResolvedPrefixes, shouldApplyProgressivePartial } from './progressiveAgeFilterCore';

export { shouldApplyProgressivePartial } from './progressiveAgeFilterCore';

type MediaType = 'movie' | 'tv';
export interface ProgressiveDiscoverPartial { results: any[]; total_pages?: number; total_results?: number; [key: string]: any; }
export type ProgressiveDiscoverPartialHandler = (partial: ProgressiveDiscoverPartial) => void;
export interface ProgressiveAgeSnapshot { generation: number; page: number; partial: ProgressiveDiscoverPartial | null; }
type ProgressiveSnapshotPublisher = (snapshot: ProgressiveAgeSnapshot | null) => void;

let globalSnapshot: ProgressiveAgeSnapshot | null = null;
const globalSnapshotListeners = new Set<() => void>();
export function getProgressiveAgeSnapshot(): ProgressiveAgeSnapshot | null { return globalSnapshot; }
export function subscribeProgressiveAgeSnapshot(listener: () => void): () => void { globalSnapshotListeners.add(listener); return () => globalSnapshotListeners.delete(listener); }
export function publishProgressiveAgeSnapshot(snapshot: ProgressiveAgeSnapshot | null): void { globalSnapshot = snapshot; for (const listener of globalSnapshotListeners) listener(); }

interface BatchIdentity { item: any; mediaType: MediaType; id: number; key: string; }
interface DeferredDetails { promise: Promise<any | null>; resolve: (value: any | null) => void; }

const BATCH_CACHE_MAX = 240;
const PARENTAL_PROGRESSIVE_MAX_CONCURRENT = 24;
const PARENTAL_TRANSPORT_MAX_ITEMS = 40;
const parentalBatchCache = new Map<string, any>();
const parentalTransportPending = new Map<string, { identity: BatchIdentity; deferred: DeferredDetails }>();
let parentalTransportFlushScheduled = false;

function identityFor(item: any): BatchIdentity | null {
  const id = Number(item?.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const mediaType: MediaType = item?.media_type === 'movie' || Boolean(item?.release_date) ? 'movie' : 'tv';
  return { item, mediaType, id, key: `${mediaType}:${id}` };
}
function rememberBatchDetails(key: string, details: any): void {
  parentalBatchCache.delete(key); parentalBatchCache.set(key, details);
  while (parentalBatchCache.size > BATCH_CACHE_MAX) parentalBatchCache.delete(parentalBatchCache.keys().next().value!);
}
async function resolveUnit(identity: BatchIdentity): Promise<any | null> {
  const cached = parentalBatchCache.get(identity.key); if (cached) return cached;
  const result = await tmdb.getParentalRatingDetails(identity.id, identity.mediaType);
  if (!result.ok || !result.value) return null;
  rememberBatchDetails(identity.key, result.value); return result.value;
}
function deferredDetails(): DeferredDetails {
  let resolve!: (value: any | null) => void;
  const promise = new Promise<any | null>(done => { resolve = done; });
  return { promise, resolve };
}

async function consumeParentalStream(batch: Array<{ identity: BatchIdentity; deferred: DeferredDetails }>): Promise<void> {
  const itemsParam = batch.map(entry => entry.identity.key).join(',');
  const response = await tryCatch(authenticatedFetch(`/api/media/parental-ratings?stream=1&items=${encodeURIComponent(itemsParam)}`));
  const unresolved = new Map(batch.map(entry => [entry.identity.key, entry]));
  if (response.ok && response.value.ok && response.value.body) {
    const reader = response.value.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const acceptLine = (line: string) => {
      if (!line.trim()) return;
      try {
        const entry = JSON.parse(line);
        const pending = unresolved.get(entry?.key);
        if (!pending) return;
        unresolved.delete(entry.key);
        if (entry.details && typeof entry.details === 'object') rememberBatchDetails(entry.key, entry.details);
        pending.deferred.resolve(entry.details && typeof entry.details === 'object' ? entry.details : null);
      } catch { /* malformed line remains unresolved and falls back safely */ }
    };
    try {
      for (;;) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (const line of lines) acceptLine(line);
        if (done) break;
      }
      acceptLine(buffer);
    } finally { reader.releaseLock(); }
  }
  await Promise.all([...unresolved.values()].map(async pending => pending.deferred.resolve(await resolveUnit(pending.identity))));
}

async function flushParentalTransport(): Promise<void> {
  parentalTransportFlushScheduled = false;
  const entries = [...parentalTransportPending.values()].slice(0, PARENTAL_TRANSPORT_MAX_ITEMS);
  for (const entry of entries) parentalTransportPending.delete(entry.identity.key);
  if (parentalTransportPending.size > 0) scheduleParentalTransportFlush();
  if (entries.length > 0) await consumeParentalStream(entries);
}
function scheduleParentalTransportFlush(): void {
  if (parentalTransportFlushScheduled) return;
  parentalTransportFlushScheduled = true;
  queueMicrotask(() => { void flushParentalTransport(); });
}
function enqueueParentalIdentity(identity: BatchIdentity): Promise<any | null> {
  const cached = parentalBatchCache.get(identity.key); if (cached) return Promise.resolve(cached);
  const existing = parentalTransportPending.get(identity.key); if (existing) return existing.deferred.promise;
  const deferred = deferredDetails();
  parentalTransportPending.set(identity.key, { identity, deferred });
  scheduleParentalTransportFlush();
  return deferred.promise;
}

export async function resolveParentalRatingBatch(items: any[]): Promise<Map<string, any | null>> {
  const identities = items.map(identityFor).filter((value): value is BatchIdentity => value !== null);
  const values = await Promise.all(identities.map(identity => enqueueParentalIdentity(identity)));
  return new Map(identities.map((identity, index) => [identity.key, values[index] ?? null]));
}

export interface ProgressiveAgeDiscoverDependencies { discover: typeof discoverSeenIt; resolveBatch: typeof resolveParentalRatingBatch; }
export function createProgressiveAgeDiscover(
  dependencies: ProgressiveAgeDiscoverDependencies = { discover: discoverSeenIt, resolveBatch: resolveParentalRatingBatch },
  publishSnapshot: ProgressiveSnapshotPublisher = () => undefined,
) {
  let currentGeneration = 0;
  return async function progressiveAgeDiscover(options: SeenItDiscoverOptions, onPartial?: ProgressiveDiscoverPartialHandler) {
    const generation = ++currentGeneration;
    const page = Number(options?.page || 1);
    const maxAge = parseMaxAgeFilter(options?.pegi || 'Tous');
    if (page === 1) publishSnapshot(maxAge === null ? null : { generation, page, partial: null });
    if (maxAge === null) return dependencies.discover(options);
    const baseResult = await dependencies.discover({ ...options, pegi: 'Tous' });
    if (!baseResult.ok || !Array.isArray(baseResult.value?.results)) {
      if (page === 1 && generation === currentGeneration) publishSnapshot(null);
      return baseResult;
    }

    const accepted = await filterResolvedPrefixes<any, any | null, any>(
      baseResult.value.results,
      1,
      async prefix => {
        const detailsByKey = await dependencies.resolveBatch(prefix);
        return prefix.map(item => { const identity = identityFor(item); return identity ? detailsByKey.get(identity.key) ?? null : null; });
      },
      (item, details) => {
        const identity = identityFor(item); if (!identity) return null;
        const override = getParentalRatingOverride(identity.mediaType, identity.id);
        const rating = override ? resolveParentalRating(identity.mediaType, null, override) : details ? resolveParentalRating(identity.mediaType, details) : null;
        if (!rating || !matchesMaxRecommendedAge(rating, maxAge)) return null;
        return { ...item, seenitParentalRating: rating };
      },
      partialResults => {
        const partial: ProgressiveDiscoverPartial = { ...baseResult.value, results: partialResults };
        if (onPartial) onPartial(partial);
        if (shouldApplyProgressivePartial(generation, currentGeneration, page)) publishSnapshot({ generation, page, partial });
      },
      PARENTAL_PROGRESSIVE_MAX_CONCURRENT,
    );
    return ok({ ...baseResult.value, results: accepted });
  };
}

export const discoverSeenItProgressive = createProgressiveAgeDiscover(undefined, publishProgressiveAgeSnapshot);
