import type { Application } from 'express';
import {
  registerMediaProviderRoutes as registerCoreMediaProviderRoutes,
} from './mediaProviderBackendCore.ts';
import { registerParentalRatingBatchRoute } from './parentalRatingBatchBackend.ts';

export {
  assertMediaProviderSecrets,
  buildProviderRequest,
  classifyTVDBList,
  extractExactTMDBRemoteId,
  extractExactTVDBSearchIdentity,
  getTVDBEntityIdentity,
  selectSingleOfficialTVDBList,
} from './mediaProviderBackendCore.ts';
export type { TVDBFranchiseItem, TVDBRelationKind } from './mediaProviderBackendCore.ts';

// Les garde-fous du core restent autoritaires pour external_source / imdb_id.
const TMDB_ORIGIN = 'https://api.themoviedb.org';
const DISCOVER_BATCH_TTL_MS = 30_000;
const PREFETCH_CACHE_TTL_MS = 60_000;
const MAX_DISCOVER_BATCHES = 16;
const MAX_PREFETCH_CACHE_ENTRIES = 80;
const MAX_DISCOVER_RESULTS = 20;
const MAX_PREFETCH_CONCURRENT = 24;
const MAX_PARENTAL_RESPONSE_BYTES = 256 * 1024;
const MAX_DISCOVER_RESPONSE_BYTES = 4 * 1024 * 1024;

type MediaType = 'movie' | 'tv';
type CoreDependencies = Parameters<typeof registerCoreMediaProviderRoutes>[1];
interface ResponseSnapshot {
  body: string;
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
}
interface DiscoverBatch {
  mediaType: MediaType;
  ids: number[];
  expiresAt: number;
}

function responseFromSnapshot(snapshot: ResponseSnapshot): Response {
  return new Response(snapshot.body, {
    status: snapshot.status,
    statusText: snapshot.statusText,
    headers: snapshot.headers,
  });
}

async function readResponseSnapshot(response: Response, maxBytes: number): Promise<ResponseSnapshot> {
  if (!response.body) {
    return {
      body: '',
      status: response.status,
      statusText: response.statusText,
      headers: Array.from(response.headers.entries()),
    };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error('PREFETCH_RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    body: new TextDecoder().decode(merged),
    status: response.status,
    statusText: response.statusText,
    headers: Array.from(response.headers.entries()),
  };
}

function parseTmdbRequest(input: RequestInfo | URL): URL | null {
  try {
    const value = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const url = new URL(value);
    return url.origin === TMDB_ORIGIN ? url : null;
  } catch {
    return null;
  }
}

function parentalIdentity(url: URL): { mediaType: MediaType; id: number; endpoint: string } | null {
  const match = url.pathname.match(/^\/3\/(movie|tv)\/([1-9]\d{0,12})\/(release_dates|content_ratings)$/);
  if (!match) return null;
  const mediaType = match[1] as MediaType;
  const endpoint = match[3];
  if ((mediaType === 'movie' && endpoint !== 'release_dates')
    || (mediaType === 'tv' && endpoint !== 'content_ratings')) return null;
  return { mediaType, id: Number(match[2]), endpoint };
}

function discoverMediaType(url: URL): MediaType | null {
  const match = url.pathname.match(/^\/3\/discover\/(movie|tv)$/);
  return match ? match[1] as MediaType : null;
}

function parentalCacheKey(url: URL): string {
  const copy = new URL(url.toString());
  const credential = copy.searchParams.get('api_key') || '';
  copy.searchParams.delete('api_key');
  copy.searchParams.sort();
  return `${credential}:${copy.pathname}?${copy.searchParams.toString()}`;
}

export function createParentalRatingPrefetchFetch(
  upstream: typeof fetch,
  now: () => number = Date.now,
): typeof fetch {
  const discoverBatches: DiscoverBatch[] = [];
  const cache = new Map<string, { snapshot: ResponseSnapshot; expiresAt: number }>();
  const inFlight = new Map<string, Promise<ResponseSnapshot>>();
  const waiters: Array<() => void> = [];
  let active = 0;
  let lastCredential = '';

  const prune = () => {
    const current = now();
    while (discoverBatches.length > 0 && discoverBatches[0].expiresAt <= current) discoverBatches.shift();
    for (const [key, entry] of cache) if (entry.expiresAt <= current) cache.delete(key);
  };

  const runBounded = async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= MAX_PREFETCH_CONCURRENT) {
      await new Promise<void>(resolve => waiters.push(resolve));
    }
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiters.shift()?.();
    }
  };

  const rememberDiscover = (mediaType: MediaType, snapshot: ResponseSnapshot) => {
    if (snapshot.status < 200 || snapshot.status >= 300) return;
    let payload: any;
    try { payload = JSON.parse(snapshot.body); } catch { return; }
    const ids = Array.isArray(payload?.results)
      ? payload.results
          .map((item: any) => Number(item?.id))
          .filter((id: number) => Number.isInteger(id) && id > 0)
          .slice(0, MAX_DISCOVER_RESULTS)
      : [];
    if (ids.length === 0) return;
    prune();
    discoverBatches.push({ mediaType, ids, expiresAt: now() + DISCOVER_BATCH_TTL_MS });
    while (discoverBatches.length > MAX_DISCOVER_BATCHES) discoverBatches.shift();
  };

  const getMatchingBatch = (mediaType: MediaType, id: number): DiscoverBatch | null => {
    prune();
    for (let index = discoverBatches.length - 1; index >= 0; index -= 1) {
      const batch = discoverBatches[index];
      if (batch.mediaType === mediaType && batch.ids.includes(id)) return batch;
    }
    return null;
  };

  const fetchParental = async (url: URL, init?: RequestInit): Promise<ResponseSnapshot> => {
    const credential = url.searchParams.get('api_key') || '';
    if (credential !== lastCredential) {
      lastCredential = credential;
      cache.clear();
      inFlight.clear();
    }

    const key = parentalCacheKey(url);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) {
      cache.delete(key);
      cache.set(key, cached);
      return cached.snapshot;
    }
    if (cached) cache.delete(key);

    let pending = inFlight.get(key);
    if (!pending) {
      pending = runBounded(async () => {
        const response = await upstream(url, init);
        const snapshot = await readResponseSnapshot(response, MAX_PARENTAL_RESPONSE_BYTES);
        if (snapshot.status >= 200 && snapshot.status < 300) {
          cache.delete(key);
          cache.set(key, { snapshot, expiresAt: now() + PREFETCH_CACHE_TTL_MS });
          while (cache.size > MAX_PREFETCH_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
        }
        return snapshot;
      });
      inFlight.set(key, pending);
    }
    try {
      return await pending;
    } finally {
      if (inFlight.get(key) === pending) inFlight.delete(key);
    }
  };

  const prefetchBatch = (requestUrl: URL, identity: { mediaType: MediaType; id: number; endpoint: string }, init?: RequestInit) => {
    const batch = getMatchingBatch(identity.mediaType, identity.id);
    if (!batch) return null;
    const promises = new Map<number, Promise<ResponseSnapshot>>();
    for (const id of batch.ids) {
      const sibling = new URL(requestUrl.toString());
      sibling.pathname = `/3/${identity.mediaType}/${id}/${identity.endpoint}`;
      promises.set(id, fetchParental(sibling, init));
    }
    void Promise.allSettled(promises.values());
    return promises.get(identity.id) || null;
  };

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = parseTmdbRequest(input);
    if (!url) return upstream(input, init);

    const mediaType = discoverMediaType(url);
    if (mediaType) {
      const response = await upstream(input, init);
      const snapshot = await readResponseSnapshot(response, MAX_DISCOVER_RESPONSE_BYTES);
      rememberDiscover(mediaType, snapshot);
      return responseFromSnapshot(snapshot);
    }

    const identity = parentalIdentity(url);
    if (!identity) return upstream(input, init);

    const prefetched = prefetchBatch(url, identity, init);
    const snapshot = prefetched
      ? await prefetched
      : await fetchParental(url, init);
    return responseFromSnapshot(snapshot);
  }) as typeof fetch;
}

export function registerMediaProviderRoutes(app: Application, dependencies: CoreDependencies): void {
  const upstream = dependencies.fetch || fetch;
  const acceleratedFetch = createParentalRatingPrefetchFetch(upstream);
  registerParentalRatingBatchRoute(app, {
    ...dependencies,
    // The explicit batch endpoint is the progressive age-filter contract. It must
    // execute only the media requested by the client; routing it through the old
    // Explorer warmup turns a one-item prefix into a hidden 20-item fan-out.
    fetch: upstream,
  });
  registerCoreMediaProviderRoutes(app, {
    ...dependencies,
    fetch: acceleratedFetch,
  });
}
