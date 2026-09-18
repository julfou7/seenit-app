import { ok, tryCatch } from '../../core/Result';
import { authenticatedFetch } from '../../lib/apiAuth';
import { emitAgeFilterBrowserTrace, installAgeFilterBrowserTraceSurface } from '../../lib/ageFilterTrace';
import { getParentalRatingOverride } from '../../store/parentalRatingStore';
import { discoverSeenIt, type SeenItDiscoverOptions } from '../shows/tmdbCore';
import { tmdb } from '../shows/tmdbClient';
import { matchesMaxRecommendedAge, parseMaxAgeFilter, resolveParentalRating } from '../shows/parentalRating';
import { readParentalRatingCache, writeParentalRatingCache } from '../shows/parentalRatingCache';
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
export interface AgeFilterTraceContext {
  traceId: string;
  generation: number;
  page: number;
  maxAge: number;
  startedAt: number;
}
interface ParentalPendingEntry {
  identity: BatchIdentity;
  deferred: DeferredDetails;
  trace?: AgeFilterTraceContext;
}

function createAgeFilterTraceId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const value = Math.floor(Math.random() * 16);
    return (char === 'x' ? value : ((value & 0x3) | 0x8)).toString(16);
  });
}

function logAgeFilterTrace(
  trace: AgeFilterTraceContext | undefined,
  phase: string,
  context: Record<string, string | number | boolean | null> = {},
): void {
  if (!trace) return;
  emitAgeFilterBrowserTrace({
    traceId: trace.traceId,
    generation: trace.generation,
    page: trace.page,
    maxAge: trace.maxAge,
    phase,
    elapsedMs: Math.max(0, Date.now() - trace.startedAt),
    ...context,
  });
}

function readBackendDiagnosticContext(value: any): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== 'object') return {};
  const allowed = [
    'backendElapsedMs', 'itemCount', 'movieCount', 'tvCount',
    'steadyConcurrency', 'burstConcurrency', 'stallBurstMs', 'timeoutMs',
    'ordinal', 'mediaType', 'queueWaitMs', 'providerMs', 'outcome',
    'httpStatus', 'hasDetails', 'active', 'queued', 'resolvedCount',
    'nullCount', 'firstWriteMs', 'maxActive', 'maxQueued', 'burstGrants',
    'aborted',
  ] as const;
  const safe: Record<string, string | number | boolean | null> = {};
  for (const key of allowed) {
    const entry = value[key];
    if (typeof entry === 'string') safe[key] = entry.slice(0, 80);
    else if (typeof entry === 'number' && Number.isFinite(entry)) safe[key] = entry;
    else if (typeof entry === 'boolean') safe[key] = entry;
    else if (entry === null) safe[key] = null;
  }
  return safe;
}

installAgeFilterBrowserTraceSurface();

const BATCH_CACHE_MAX = 240;
const PARENTAL_TRANSPORT_MAX_ITEMS = 40;
// Le scheduler client doit remplir tout le transport avant la microtask de flush.
// La concurrence fournisseur reste bornée côté backend à 24.
const PARENTAL_PROGRESSIVE_MAX_CONCURRENT = PARENTAL_TRANSPORT_MAX_ITEMS;
const PROGRESSIVE_SNAPSHOT_BATCH_MS = 120;
const parentalBatchCache = new Map<string, any>();
const parentalTransportPending = new Map<AbortSignal | undefined, Map<string, ParentalPendingEntry>>();
let parentalTransportFlushScheduled = false;

function identityFor(item: any): BatchIdentity | null {
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
async function resolveUnit(identity: BatchIdentity, trace?: AgeFilterTraceContext): Promise<any | null> {
  const cached = parentalBatchCache.get(identity.key);
  if (cached) {
    logAgeFilterTrace(trace, 'fallback_cache_hit', { mediaType: identity.mediaType, cacheSize: parentalBatchCache.size });
    return cached;
  }
  const persistent = readPersistentBatchDetails(identity);
  if (persistent) {
    logAgeFilterTrace(trace, 'fallback_persistent_cache_hit', { mediaType: identity.mediaType });
    return persistent;
  }
  const startedAt = Date.now();
  logAgeFilterTrace(trace, 'fallback_unit_start', { mediaType: identity.mediaType });
  const result = await tmdb.getParentalRatingDetails(identity.id, identity.mediaType);
  logAgeFilterTrace(trace, 'fallback_unit_done', {
    mediaType: identity.mediaType,
    ok: result.ok && Boolean(result.value),
    durationMs: Math.max(0, Date.now() - startedAt),
  });
  if (!result.ok || !result.value) return null;
  rememberBatchDetails(identity.key, result.value); return result.value;
}
function deferredDetails(): DeferredDetails {
  let resolve!: (value: any | null) => void;
  const promise = new Promise<any | null>(done => { resolve = done; });
  return { promise, resolve };
}

async function consumeParentalStream(batch: ParentalPendingEntry[], signal?: AbortSignal): Promise<void> {
  const trace = batch.find(entry => entry.trace)?.trace;
  const transportStartedAt = Date.now();
  const itemsParam = batch.map(entry => entry.identity.key).join(',');
  logAgeFilterTrace(trace, 'transport_request_start', {
    batchSize: batch.length,
    movieCount: batch.filter(entry => entry.identity.mediaType === 'movie').length,
    tvCount: batch.filter(entry => entry.identity.mediaType === 'tv').length,
  });
  const traceHeaders = trace ? {
    'X-SeenIt-Age-Trace': trace.traceId,
    'X-SeenIt-Age-Generation': String(trace.generation),
    'X-SeenIt-Age-Page': String(trace.page),
    'X-SeenIt-Age-Max': String(trace.maxAge),
  } : undefined;
  const response = await tryCatch(authenticatedFetch(
    `/api/media/parental-ratings?stream=1&items=${encodeURIComponent(itemsParam)}`,
    { signal, headers: traceHeaders },
  ));
  const unresolved = new Map(batch.map(entry => [entry.identity.key, entry]));
  logAgeFilterTrace(trace, 'transport_response_headers', {
    ok: response.ok && response.value.ok,
    httpStatus: response.ok ? response.value.status : 0,
    headerWaitMs: Math.max(0, Date.now() - transportStartedAt),
  });
  if (response.ok && response.value.ok && response.value.body) {
    const reader = response.value.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lineNumber = 0;
    let firstLineAt: number | null = null;
    const acceptLine = (line: string) => {
      if (!line.trim()) return;
      try {
        const entry = JSON.parse(line);
        if (entry?.type === 'age_filter_diagnostic' && entry?.diagnostic?.phase) {
          logAgeFilterTrace(trace, `backend_${String(entry.diagnostic.phase).slice(0, 64)}`, readBackendDiagnosticContext(entry.diagnostic.context));
          return;
        }
        const pending = unresolved.get(entry?.key);
        if (!pending) return;
        if (entry?.diagnostic?.phase) {
          logAgeFilterTrace(
            pending.trace || trace,
            `backend_${String(entry.diagnostic.phase).slice(0, 64)}`,
            readBackendDiagnosticContext(entry.diagnostic.context),
          );
        }
        unresolved.delete(entry.key);
        lineNumber += 1;
        if (firstLineAt === null) firstLineAt = Date.now();
        const hasDetails = Boolean(entry.details && typeof entry.details === 'object');
        if (hasDetails) rememberBatchDetails(entry.key, entry.details);
        logAgeFilterTrace(pending.trace || trace, 'transport_stream_item', {
          sequence: lineNumber,
          mediaType: pending.identity.mediaType,
          hasDetails,
          remaining: unresolved.size,
          streamElapsedMs: Math.max(0, Date.now() - transportStartedAt),
        });
        pending.deferred.resolve(hasDetails ? entry.details : null);
      } catch {
        logAgeFilterTrace(trace, 'transport_stream_malformed_line', { lineLength: line.length });
      }
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
      logAgeFilterTrace(trace, 'transport_stream_done', {
        lines: lineNumber,
        unresolved: unresolved.size,
        firstLineMs: firstLineAt === null ? -1 : Math.max(0, firstLineAt - transportStartedAt),
        durationMs: Math.max(0, Date.now() - transportStartedAt),
      });
    } catch {
      logAgeFilterTrace(trace, 'transport_stream_interrupted', {
        aborted: Boolean(signal?.aborted),
        lines: lineNumber,
        unresolved: unresolved.size,
        durationMs: Math.max(0, Date.now() - transportStartedAt),
      });
      // Un changement de filtre peut interrompre le stream : les entrées restantes
      // sont résolues ci-dessous sans réutiliser une génération obsolète.
    } finally {
      if (signal?.aborted) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  } else {
    logAgeFilterTrace(trace, 'transport_stream_unavailable', {
      unresolved: unresolved.size,
      durationMs: Math.max(0, Date.now() - transportStartedAt),
    });
  }
  if (unresolved.size > 0) {
    logAgeFilterTrace(trace, 'transport_fallback_start', { unresolved: unresolved.size, aborted: Boolean(signal?.aborted) });
  }
  await Promise.all([...unresolved.values()].map(async pending => {
    if (signal?.aborted) {
      pending.deferred.resolve(null);
      return;
    }
    pending.deferred.resolve(await resolveUnit(pending.identity, pending.trace || trace));
  }));
  logAgeFilterTrace(trace, 'transport_complete', {
    batchSize: batch.length,
    durationMs: Math.max(0, Date.now() - transportStartedAt),
    aborted: Boolean(signal?.aborted),
  });
}

async function flushParentalTransport(): Promise<void> {
  parentalTransportFlushScheduled = false;
  const groups = [...parentalTransportPending.entries()];
  parentalTransportPending.clear();

  await Promise.all(groups.map(async ([signal, pending]) => {
    const allEntries = [...pending.values()];
    const entries = allEntries.slice(0, PARENTAL_TRANSPORT_MAX_ITEMS);
    const leftovers = allEntries.slice(PARENTAL_TRANSPORT_MAX_ITEMS);
    const trace = allEntries.find(entry => entry.trace)?.trace;
    logAgeFilterTrace(trace, 'transport_flush', {
      queued: allEntries.length,
      sending: entries.length,
      leftovers: leftovers.length,
      aborted: Boolean(signal?.aborted),
    });

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
function enqueueParentalIdentity(identity: BatchIdentity, signal?: AbortSignal, trace?: AgeFilterTraceContext): Promise<any | null> {
  if (signal?.aborted) {
    logAgeFilterTrace(trace, 'transport_enqueue_aborted', { mediaType: identity.mediaType });
    return Promise.resolve(null);
  }
  const cached = parentalBatchCache.get(identity.key);
  if (cached) {
    logAgeFilterTrace(trace, 'transport_cache_hit', { mediaType: identity.mediaType, cacheSize: parentalBatchCache.size });
    return Promise.resolve(cached);
  }

  const persistent = readPersistentBatchDetails(identity);
  if (persistent) {
    logAgeFilterTrace(trace, 'transport_persistent_cache_hit', { mediaType: identity.mediaType });
    return Promise.resolve(persistent);
  }

  let pending = parentalTransportPending.get(signal);
  if (!pending) {
    pending = new Map();
    parentalTransportPending.set(signal, pending);
  }
  const existing = pending.get(identity.key);
  if (existing) {
    logAgeFilterTrace(trace, 'transport_dedupe_hit', { mediaType: identity.mediaType, pendingSize: pending.size });
    return existing.deferred.promise;
  }
  const deferred = deferredDetails();
  pending.set(identity.key, { identity, deferred, trace });
  logAgeFilterTrace(trace, 'transport_enqueue', { mediaType: identity.mediaType, pendingSize: pending.size });
  scheduleParentalTransportFlush();
  return deferred.promise;
}

export async function resolveParentalRatingBatch(
  items: any[],
  signal?: AbortSignal,
  trace?: AgeFilterTraceContext,
): Promise<Map<string, any | null>> {
  const identities = items.map(identityFor).filter((value): value is BatchIdentity => value !== null);
  logAgeFilterTrace(trace, 'batch_resolve_start', { requested: items.length, valid: identities.length });
  const values = await Promise.all(identities.map(identity => enqueueParentalIdentity(identity, signal, trace)));
  logAgeFilterTrace(trace, 'batch_resolve_done', {
    requested: items.length,
    resolved: values.filter(Boolean).length,
    nulls: values.filter(value => !value).length,
  });
  return new Map(identities.map((identity, index) => [identity.key, values[index] ?? null]));
}

export interface ProgressiveAgeDiscoverDependencies {
  discover: typeof discoverSeenIt;
  resolveBatch: (
    items: any[],
    signal?: AbortSignal,
    trace?: AgeFilterTraceContext,
  ) => Promise<Map<string, any | null>>;
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
    const trace: AgeFilterTraceContext | undefined = maxAge === null ? undefined : {
      traceId: createAgeFilterTraceId(),
      generation,
      page,
      maxAge,
      startedAt: Date.now(),
    };
    logAgeFilterTrace(trace, 'discover_start', { rawFilter: String(options?.pegi || 'Tous').slice(0, 16) });
    let pendingSnapshot: ProgressiveAgeSnapshot | null = null;
    let pendingSnapshotTimer: ReturnType<typeof setTimeout> | null = null;

    const flushPendingSnapshot = () => {
      pendingSnapshotTimer = null;
      const snapshot = pendingSnapshot;
      pendingSnapshot = null;
      if (snapshot && !requestSignal.aborted && shouldApplyProgressivePartial(generation, currentGeneration, page)) {
        logAgeFilterTrace(trace, 'snapshot_publish', { results: snapshot.partial?.results?.length || 0 });
        publishSnapshot(snapshot);
      }
    };

    const queueProgressiveSnapshot = (partial: ProgressiveDiscoverPartial) => {
      if (requestSignal.aborted || !shouldApplyProgressivePartial(generation, currentGeneration, page)) return;
      pendingSnapshot = { generation, page, partial };
      logAgeFilterTrace(trace, 'snapshot_queue', { results: partial.results?.length || 0 });
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
      logAgeFilterTrace(trace, 'snapshot_reset');
    }
    const discoverStartedAt = Date.now();
    logAgeFilterTrace(trace, 'source_discover_start');
    const baseResult = await dependencies.discover({
      ...options,
      pegi: 'Tous',
      parentalPrefilterMaxAge: maxAge,
    });
    logAgeFilterTrace(trace, 'source_discover_done', {
      ok: baseResult.ok,
      durationMs: Math.max(0, Date.now() - discoverStartedAt),
      rawResults: baseResult.ok && Array.isArray(baseResult.value?.results) ? baseResult.value.results.length : 0,
      totalPages: baseResult.ok ? Number(baseResult.value?.total_pages || 0) : 0,
    });
    if (!baseResult.ok || !Array.isArray(baseResult.value?.results)) {
      if (!requestSignal.aborted && shouldApplyProgressivePartial(generation, currentGeneration, page)) publishSnapshot(null);
      return baseResult;
    }
    if (requestSignal.aborted) {
      logAgeFilterTrace(trace, 'discover_aborted_after_source');
      return baseResult;
    }

    const accepted = await filterResolvedPrefixes<any, any | null, any>(
      baseResult.value.results,
      1,
      async prefix => {
        const detailsByKey = await dependencies.resolveBatch(prefix, requestSignal, trace);
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
        logAgeFilterTrace(trace, 'partial_accepted', { accepted: partialResults.length });
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
      logAgeFilterTrace(trace, 'snapshot_publish_final', { results: pendingSnapshot.partial?.results?.length || 0 });
      publishSnapshot(pendingSnapshot);
      pendingSnapshot = null;
    }

    logAgeFilterTrace(trace, 'discover_complete', {
      accepted: accepted.length,
      aborted: Boolean(requestSignal.aborted),
    });
    return ok({ ...baseResult.value, results: accepted });
  };
}

export const discoverSeenItProgressive = createProgressiveAgeDiscover(undefined, publishProgressiveAgeSnapshot);
