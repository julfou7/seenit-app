import { ok, tryCatch } from '../../core/Result';
import { authenticatedFetch } from '../../lib/apiAuth';
import { getParentalRatingOverride } from '../../store/parentalRatingStore';
import { DISCOVER_CRITICAL_GRID_ITEMS } from '../../screens/discoverPresentation';
import {
  discoverSeenIt,
  type SeenItDiscoverOptions,
} from '../shows/tmdbCore';
import { tmdb } from '../shows/tmdbClient';
import {
  matchesMaxRecommendedAge,
  parseMaxAgeFilter,
  resolveParentalRating,
} from '../shows/parentalRating';
import {
  filterResolvedPrefixes,
  shouldApplyProgressivePartial,
} from './progressiveAgeFilterCore';

export { shouldApplyProgressivePartial } from './progressiveAgeFilterCore';

type MediaType = 'movie' | 'tv';

export interface ProgressiveDiscoverPartial {
  results: any[];
  total_pages?: number;
  total_results?: number;
  [key: string]: any;
}
export type ProgressiveDiscoverPartialHandler = (partial: ProgressiveDiscoverPartial) => void;

export interface ProgressiveAgeSnapshot {
  generation: number;
  page: number;
  partial: ProgressiveDiscoverPartial | null;
}

type ProgressiveSnapshotPublisher = (snapshot: ProgressiveAgeSnapshot | null) => void;

let globalSnapshot: ProgressiveAgeSnapshot | null = null;
const globalSnapshotListeners = new Set<() => void>();

export function getProgressiveAgeSnapshot(): ProgressiveAgeSnapshot | null {
  return globalSnapshot;
}

export function subscribeProgressiveAgeSnapshot(listener: () => void): () => void {
  globalSnapshotListeners.add(listener);
  return () => globalSnapshotListeners.delete(listener);
}

export function publishProgressiveAgeSnapshot(snapshot: ProgressiveAgeSnapshot | null): void {
  globalSnapshot = snapshot;
  for (const listener of globalSnapshotListeners) listener();
}

interface BatchIdentity {
  item: any;
  mediaType: MediaType;
  id: number;
  key: string;
}

const BATCH_CACHE_MAX = 240;
const parentalBatchCache = new Map<string, any>();

function identityFor(item: any): BatchIdentity | null {
  const id = Number(item?.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const mediaType: MediaType = item?.media_type === 'movie' || Boolean(item?.release_date) ? 'movie' : 'tv';
  return { item, mediaType, id, key: `${mediaType}:${id}` };
}

function rememberBatchDetails(key: string, details: any): void {
  parentalBatchCache.delete(key);
  parentalBatchCache.set(key, details);
  while (parentalBatchCache.size > BATCH_CACHE_MAX) {
    parentalBatchCache.delete(parentalBatchCache.keys().next().value!);
  }
}

async function resolveUnit(identity: BatchIdentity): Promise<any | null> {
  const cached = parentalBatchCache.get(identity.key);
  if (cached) return cached;
  const result = await tmdb.getParentalRatingDetails(identity.id, identity.mediaType);
  if (!result.ok || !result.value) return null;
  rememberBatchDetails(identity.key, result.value);
  return result.value;
}

export async function resolveParentalRatingBatch(items: any[]): Promise<Map<string, any | null>> {
  const identities = items.map(identityFor).filter((value): value is BatchIdentity => value !== null);
  const resolved = new Map<string, any | null>();
  const missing: BatchIdentity[] = [];

  for (const identity of identities) {
    const cached = parentalBatchCache.get(identity.key);
    if (cached) resolved.set(identity.key, cached);
    else missing.push(identity);
  }
  if (missing.length === 0) return resolved;

  const itemsParam = missing.map(identity => identity.key).join(',');
  const response = await tryCatch(authenticatedFetch(`/api/media/parental-ratings?items=${encodeURIComponent(itemsParam)}`));
  if (response.ok && response.value.ok) {
    const payload = await tryCatch(response.value.json());
    if (payload.ok && Array.isArray(payload.value?.results)) {
      for (const entry of payload.value.results) {
        if (typeof entry?.key !== 'string' || !missing.some(identity => identity.key === entry.key)) continue;
        if (entry.details && typeof entry.details === 'object') {
          rememberBatchDetails(entry.key, entry.details);
          resolved.set(entry.key, entry.details);
        }
      }
    }
  }

  await Promise.all(missing.map(async identity => {
    if (resolved.has(identity.key)) return;
    resolved.set(identity.key, await resolveUnit(identity));
  }));
  return resolved;
}

export interface ProgressiveAgeDiscoverDependencies {
  discover: typeof discoverSeenIt;
  resolveBatch: typeof resolveParentalRatingBatch;
}

export function createProgressiveAgeDiscover(
  dependencies: ProgressiveAgeDiscoverDependencies = {
    discover: discoverSeenIt,
    resolveBatch: resolveParentalRatingBatch,
  },
  publishSnapshot: ProgressiveSnapshotPublisher = () => undefined,
) {
  let currentGeneration = 0;

  return async function progressiveAgeDiscover(
    options: SeenItDiscoverOptions,
    onPartial?: ProgressiveDiscoverPartialHandler,
  ) {
    const generation = ++currentGeneration;
    const page = Number(options?.page || 1);
    const maxAge = parseMaxAgeFilter(options?.pegi || 'Tous');

    if (page === 1) {
      publishSnapshot(maxAge === null ? null : { generation, page, partial: null });
    }
    if (maxAge === null) return dependencies.discover(options);

    const baseResult = await dependencies.discover({ ...options, pegi: 'Tous' });
    if (!baseResult.ok || !Array.isArray(baseResult.value?.results)) {
      if (page === 1 && generation === currentGeneration) publishSnapshot(null);
      return baseResult;
    }

    const accepted = await filterResolvedPrefixes<any, any | null, any>(
      baseResult.value.results,
      DISCOVER_CRITICAL_GRID_ITEMS,
      async prefix => {
        const detailsByKey = await dependencies.resolveBatch(prefix);
        return prefix.map(item => {
          const identity = identityFor(item);
          return identity ? detailsByKey.get(identity.key) ?? null : null;
        });
      },
      (item, details) => {
        const identity = identityFor(item);
        if (!identity) return null;
        const override = getParentalRatingOverride(identity.mediaType, identity.id);
        const rating = override
          ? resolveParentalRating(identity.mediaType, null, override)
          : details
            ? resolveParentalRating(identity.mediaType, details)
            : null;
        if (!rating || !matchesMaxRecommendedAge(rating, maxAge)) return null;
        return { ...item, seenitParentalRating: rating };
      },
      partialResults => {
        const partial: ProgressiveDiscoverPartial = {
          ...baseResult.value,
          results: partialResults,
        };
        if (onPartial) onPartial(partial);
        if (shouldApplyProgressivePartial(generation, currentGeneration, page)) {
          publishSnapshot({ generation, page, partial });
        }
      },
    );

    return ok({
      ...baseResult.value,
      results: accepted,
    });
  };
}

export const discoverSeenItProgressive = createProgressiveAgeDiscover(
  undefined,
  publishProgressiveAgeSnapshot,
);
