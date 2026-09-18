import { ok, tryCatch } from '../../core/Result';
import { authenticatedFetch } from '../../lib/apiAuth';
import { getParentalRatingOverride } from '../../store/parentalRatingStore';
import { discoverSeenIt, type SeenItDiscoverOptions } from '../shows/tmdbCore';
import { tmdb } from '../shows/tmdbClient';
import { matchesMaxRecommendedAge, parseMaxAgeFilter, resolveParentalRating } from '../shows/parentalRating';
import { createSupersedingAbortController, filterResolvedPrefixes, shouldApplyProgressivePartial } from './progressiveAgeFilterCore';

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
const PARENTAL_TRANSPORT_MAX_ITEMS = 40;
// Le scheduler client doit remplir tout le transport avant la microtask de flush.
// La concurrence fournisseur reste bornée côté backend à 24.
const PARENTAL_PROGRESSIVE_MAX_CONCURRENT = PARENTAL_TRANSPORT_MAX_ITEMS;
const PROGRESSIVE_SNAPSHOT_BATCH_MS = 120;
const parentalBatchCache = new Map<string, any>();
const parentalTransportPending = new Map<AbortSignal | undefined, Map<string, { identity: BatchIdentity; deferred: DeferredDetails }>>();
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

async function consumeParentalStream(batch: Array<{ identity: BatchIdentity; deferred: DeferredDetails }>, signal?: AbortSignal): Promise<void> {
  const itemsParam = batch.map(entry => entry.identity.key).join(',');
  const response = await tryCatch(authenticatedFetch(`/api/media/parental-ratings?stream=1&items=${encodeURIComponent(itemsParam)}`, { signal }));
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
    } catch {
      // Un changement de filtre peut interrompre le stream : les entrées restantes
      // sont résolues ci-dessous sans réutiliser une génération obsolète.
    } finally {
      if (signal?.aborted) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
  await Promise.all([...unresolved.values()].map(async pending => {
    if (signal?.aborted) {
      pending.deferred.resolve(null);
      return;
    }
    pending.deferred.resolve(await resolveUnit(pending.identity));
  }));
}

async function flushParentalTransport(): Promise<void> {
  parentalTransportFlushScheduled = false;
  const groups = [...parentalTransportPending.entries()];
  parentalTransportPending.clear();

  await Promise.all(groups.map(async ([signal, pending]) => {
    const allEntries = [...pending.values()];
    const entries = allEntries.slice(0, PARENTAL_TRANSPORT_MAX_ITEMS);
    const leftovers = allEntries.slice(PARENTAL_TRANSPORT_MAX_ITEMS);

    if (leftovers.length > 0) {
      const nextPending = new Map<string, { identity: BatchIdentity; deferred: DeferredDetails }>();
      for (const entry of leftovers) nextPending.set(entry.identity.key, entry);
      parentalTransportPending.set(signal, nextPending);
    }

    if (signal?.aborted) {
      for (const entry of entries) entry.deferred.resolve(null);
      return;
    }
    if (entries.length > 0) await consumeParentalStream(entries, signal);
  }));

  if (parentalTransportPending.size > 0) scheduleParentalTransportFlush();
}
function scheduleParentalTransportFlush(): void {
  if (parentalTransportFlushScheduled) return;
  parentalTransportFlushScheduled = true;
  queueMicrotask(() => { void flushParentalTransport(); });
}
function enqueueParentalIdentity(identity: BatchIdentity, signal?: AbortSignal): Promise<any | null> {
  if (signal?.aborted) return Promise.resolve(null);
  const cached = parentalBatchCache.get(identity.key); if (cached) return Promise.resolve(cached);

  let pending = parentalTransportPending.get(signal);
  if (!pending) {
    pending = new Map();
    parentalTransportPending.set(signal, pending);
  }
  const existing = pending.get(identity.key); if (existing) return existing.deferred.promise;
  const deferred = deferredDetails();
  pending.set(identity.key, { identity, deferred });
  scheduleParentalTransportFlush();
  return deferred.promise;
}

export async function resolveParentalRatingBatch(items: any[], signal?: AbortSignal): Promise<Map<string, any | null>> {
  const identities = items.map(identityFor).filter((value): value is BatchIdentity => value !== null);
  const values = await Promise.all(identities.map(identity => enqueueParentalIdentity(identity, signal)));
  return new Map(identities.map((identity, index) => [identity.key, values[index] ?? null]));
}

export interface ProgressiveAgeDiscoverDependencies {
  discover: typeof discoverSeenIt;
  resolveBatch: (items: any[], signal?: AbortSignal) => Promise<Map<string, any | null>>;
}
export function createProgressiveAgeDiscover(
  dependencies: ProgressiveAgeDiscoverDependencies = { discover: discoverSeenIt, resolveBatch: resolveParentalRatingBatch },
  publishSnapshot: ProgressiveSnapshotPublisher = () => undefined,
) {
  let currentGeneration = 0;
  const nextRequestController = createSupersedingAbortController();
  return async function progressiveAgeDiscover(options: SeenItDiscoverOptions, onPartial?: ProgressiveDiscoverPartialHandler) {
    const requestController = nextRequestController();
    const requestSignal = requestController.signal;
    const generation = ++currentGeneration;
    const page = Number(options?.page || 1);
    const maxAge = parseMaxAgeFilter(options?.pegi || 'Tous');
    let pendingSnapshot: ProgressiveAgeSnapshot | null = null;
    let pendingSnapshotTimer: ReturnType<typeof setTimeout> | null = null;

    const flushPendingSnapshot = () => {
      pendingSnapshotTimer = null;
      const snapshot = pendingSnapshot;
      pendingSnapshot = null;
      if (snapshot && !requestSignal.aborted && shouldApplyProgressivePartial(generation, currentGeneration, page)) {
        publishSnapshot(snapshot);
      }
    };

    const queueProgressiveSnapshot = (partial: ProgressiveDiscoverPartial) => {
      if (requestSignal.aborted || !shouldApplyProgressivePartial(generation, currentGeneration, page)) return;
      pendingSnapshot = { generation, page, partial };
      if (pendingSnapshotTimer === null) {
        pendingSnapshotTimer = setTimeout(flushPendingSnapshot, PROGRESSIVE_SNAPSHOT_BATCH_MS);
      }
    };
    if (maxAge === null) {
      if (page === 1) publishSnapshot(null);
      return dependencies.discover(options);
    }
    if (shouldApplyProgressivePartial(generation, currentGeneration, page)) {
      publishSnapshot({ generation, page, partial: null });
    }
    const baseResult = await dependencies.discover({ ...options, pegi: 'Tous' });
    if (!baseResult.ok || !Array.isArray(baseResult.value?.results)) {
      if (!requestSignal.aborted && shouldApplyProgressivePartial(generation, currentGeneration, page)) publishSnapshot(null);
      return baseResult;
    }
    if (requestSignal.aborted) return baseResult;

    const accepted = await filterResolvedPrefixes<any, any | null, any>(
      baseResult.value.results,
      1,
      async prefix => {
        const detailsByKey = await dependencies.resolveBatch(prefix, requestSignal);
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
        queueProgressiveSnapshot(partial);
      },
      PARENTAL_PROGRESSIVE_MAX_CONCURRENT,
    );

    if (pendingSnapshotTimer !== null) {
      clearTimeout(pendingSnapshotTimer);
      pendingSnapshotTimer = null;
    }
    if (pendingSnapshot && !requestSignal.aborted && shouldApplyProgressivePartial(generation, currentGeneration, page)) {
      publishSnapshot(pendingSnapshot);
      pendingSnapshot = null;
    }

    return ok({ ...baseResult.value, results: accepted });
  };
}

export const discoverSeenItProgressive = createProgressiveAgeDiscover(undefined, publishProgressiveAgeSnapshot);
