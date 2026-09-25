import { ok, tryCatch } from '../../core/Result';
import { authenticatedFetch } from '../../lib/apiAuth';
import { getParentalRatingOverride, getParentalRatingOverridesSnapshot } from '../../store/parentalRatingStore';
import { discoverSeenIt, type SeenItDiscoverOptions } from '../shows/tmdbCore';
import { tmdb } from '../shows/tmdbClient';
import { matchesMaxRecommendedAge, parseMaxAgeFilter, resolveParentalRating } from '../shows/parentalRating';
import { readParentalRatingCache, writeParentalRatingCache } from '../shows/parentalRatingCache';
import { createPagePrefetchWindow, createSupersedingAbortController, filterResolvedPrefixes, shouldApplyProgressivePartial } from './progressiveAgeFilterCore';

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
interface ParentalPendingEntry {
  identity: BatchIdentity;
  deferred: DeferredDetails;
}

const BATCH_CACHE_MAX = 240;
const PARENTAL_TRANSPORT_MAX_ITEMS = 40;
// Le scheduler client doit remplir tout le transport avant la microtask de flush.
// La concurrence fournisseur reste bornée côté backend à 24.
const PARENTAL_PROGRESSIVE_MAX_CONCURRENT = PARENTAL_TRANSPORT_MAX_ITEMS;
const PROGRESSIVE_SNAPSHOT_BATCH_MS = 120;
const AGE_SOURCE_PREFETCH_AHEAD = 2;
const AGE_SOURCE_PREFETCH_MAX_ENTRIES = 8;
const parentalBatchCache = new Map<string, any>();
const parentalTransportPending = new Map<AbortSignal | undefined, Map<string, ParentalPendingEntry>>();
let parentalTransportFlushScheduled = false;

function identityFor(item: Record<string, unknown>): BatchIdentity | null {
  const id = Number(item?.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const mediaType: MediaType = item?.media_type === 'movie' || Boolean(item?.release_date) ? 'movie' : 'tv';
  return { item, mediaType, id, key: `${mediaType}:${id}` };
}
function rememberBatchDetails(key: string, details: any, persist = true): void {
  parentalBatchCache.delete(key); parentalBatchCache.set(key, details);
  while (parentalBatchCache.size > BATCH_CACHE_MAX) parentalBatchCache.delete(parentalBatchCache.keys().next().value!);
  if (!persist) return;
  const [mediaType, rawId] = key.split(':');
  const id = Number(rawId);
  if ((mediaType === 'movie' || mediaType === 'tv') && Number.isInteger(id) && id > 0) {
    writeParentalRatingCache(id, mediaType, details);
  }
}
function readPersistentBatchDetails(identity: BatchIdentity): any | null {
  const cached = readParentalRatingCache(identity.id, identity.mediaType);
  if (!cached) return null;
  rememberBatchDetails(identity.key, cached.data, false);
  return cached.data;
}
async function resolveUnit(identity: BatchIdentity): Promise<any | null> {
  const cached = parentalBatchCache.get(identity.key);
  if (cached) return cached;
  const persistent = readPersistentBatchDetails(identity);
  if (persistent) return persistent;
  const result = await tmdb.getParentalRatingDetails(identity.id, identity.mediaType);
  if (!result.ok || !result.value) return null;
  rememberBatchDetails(identity.key, result.value);
  return result.value;
}
function deferredDetails(): DeferredDetails {
  let resolve!: (value: any | null) => void;
  const promise = new Promise<any | null>(done => { resolve = done; });
  return { promise, resolve };
}

async function consumeParentalStream(batch: ParentalPendingEntry[], signal?: AbortSignal): Promise<void> {
  const itemsParam = batch.map(entry => entry.identity.key).join(',');
  const response = await tryCatch(authenticatedFetch(
    `/api/media/parental-ratings?stream=1&items=${encodeURIComponent(itemsParam)}`,
    { signal },
  ));
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
        const hasDetails = Boolean(entry.details && typeof entry.details === 'object');
        if (hasDetails) rememberBatchDetails(entry.key, entry.details);
        pending.deferred.resolve(hasDetails ? entry.details : null);
      } catch { /* ligne malformée : fallback fail-closed plus bas */ }
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
      // Une génération annulée peut interrompre le stream ; les entrées restantes
      // gardent le fallback fail-closed sans réutiliser une réponse obsolète.
    } finally {
      if (signal?.aborted) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
  await Promise.all([...unresolved.values()].map(async pending => {
    if (signal?.aborted) { pending.deferred.resolve(null); return; }
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
      const nextPending = new Map<string, ParentalPendingEntry>();
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
  const cached = parentalBatchCache.get(identity.key);
  if (cached) return Promise.resolve(cached);
  const persistent = readPersistentBatchDetails(identity);
  if (persistent) return Promise.resolve(persistent);
  let pending = parentalTransportPending.get(signal);
  if (!pending) { pending = new Map(); parentalTransportPending.set(signal, pending); }
  const existing = pending.get(identity.key);
  if (existing) return existing.deferred.promise;
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
function createSourcePrefetchKey(options: SeenItDiscoverOptions, maxAge: number): string {
  const overrides = getParentalRatingOverridesSnapshot();
  const hasRescuingMovieOverride = Object.entries(overrides).some(([key, override]) => (
    key.startsWith('movie:')
    && Number.isInteger(override?.age)
    && override.age >= 0
    && override.age <= maxAge
  ));
  return JSON.stringify({
    type: options.type || 'all',
    category: options.category || 'Tout',
    watchProviders: [...(options.watchProviders || [])].sort(),
    genres: [...(options.genres || [])].sort(),
    maxAge,
    minRating: options.minRating || 'Toutes',
    movieReleaseAfterYear: options.movieReleaseAfterYear || 'Toutes',
    sortBy: options.sortBy || 'popular',
    sortOrder: options.sortOrder || 'desc',
    hasRescuingMovieOverride,
  });
}

export function createProgressiveAgeDiscover(
  dependencies: ProgressiveAgeDiscoverDependencies = { discover: discoverSeenIt, resolveBatch: resolveParentalRatingBatch },
  publishSnapshot: ProgressiveSnapshotPublisher = () => undefined,
) {
  let currentGeneration = 0;
  const nextRequestController = createSupersedingAbortController();
  const sourcePagePrefetch = createPagePrefetchWindow<
    Awaited<ReturnType<ProgressiveAgeDiscoverDependencies['discover']>>
  >(AGE_SOURCE_PREFETCH_AHEAD, AGE_SOURCE_PREFETCH_MAX_ENTRIES);
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
    const sourcePrefetchKey = createSourcePrefetchKey(options, maxAge);
    const loadSourcePage = (targetPage: number) => dependencies.discover({
      ...options,
      page: targetPage,
      pegi: 'Tous',
      parentalPrefilterMaxAge: maxAge,
    });
    const sourcePage = sourcePagePrefetch.get(sourcePrefetchKey, page, loadSourcePage);
    sourcePagePrefetch.primeAhead(sourcePrefetchKey, page, loadSourcePage);
    const baseResult = await sourcePage.promise;
    if (!baseResult.ok || !Array.isArray(baseResult.value?.results)) {
      if (!requestSignal.aborted && shouldApplyProgressivePartial(generation, currentGeneration, page)) publishSnapshot(null);
      return baseResult;
    }
    if (requestSignal.aborted) {
      return baseResult;
    }

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
