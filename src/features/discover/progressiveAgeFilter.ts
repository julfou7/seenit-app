import { ok, tryCatch, type Result } from '../../core/Result';
import { authenticatedFetch } from '../../lib/apiAuth';
import { getParentalRatingOverride } from '../../store/parentalRatingStore';
import { DISCOVER_CRITICAL_GRID_ITEMS } from '../../screens/discoverPresentation';
import {
  discoverSeenIt,
  tmdb,
  type SeenItDiscoverOptions,
} from '../shows/tmdb';
import {
  matchesMaxRecommendedAge,
  parseMaxAgeFilter,
  resolveParentalRating,
} from '../shows/parentalRating';

type MediaType = 'movie' | 'tv';

type DiscoverValue = Awaited<ReturnType<typeof discoverSeenIt>> extends Result<infer TValue>
  ? TValue
  : never;

export type ProgressiveDiscoverPartial = DiscoverValue & { results: any[] };
export type ProgressiveDiscoverPartialHandler = (partial: ProgressiveDiscoverPartial) => void;

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

export function shouldApplyProgressivePartial(
  requestGeneration: number,
  currentGeneration: number,
  page: number,
): boolean {
  return page === 1 && requestGeneration === currentGeneration;
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
) {
  return async function progressiveAgeDiscover(
    options: SeenItDiscoverOptions,
    onPartial?: ProgressiveDiscoverPartialHandler,
  ) {
    const maxAge = parseMaxAgeFilter(options?.pegi || 'Tous');
    if (maxAge === null) return dependencies.discover(options);

    const baseResult = await dependencies.discover({ ...options, pegi: 'Tous' });
    if (!baseResult.ok || !Array.isArray(baseResult.value?.results)) return baseResult;

    const rawResults = baseResult.value.results;
    const accepted: any[] = [];
    let lastPublishedCount = 0;

    for (let offset = 0; offset < rawResults.length; offset += DISCOVER_CRITICAL_GRID_ITEMS) {
      const prefix = rawResults.slice(offset, offset + DISCOVER_CRITICAL_GRID_ITEMS);
      const detailsByKey = await dependencies.resolveBatch(prefix);

      for (const item of prefix) {
        const identity = identityFor(item);
        if (!identity) continue;
        const override = getParentalRatingOverride(identity.mediaType, identity.id);
        const details = detailsByKey.get(identity.key) ?? null;
        const rating = override
          ? resolveParentalRating(identity.mediaType, null, override)
          : details
            ? resolveParentalRating(identity.mediaType, details)
            : null;
        if (!rating || !matchesMaxRecommendedAge(rating, maxAge)) continue;
        accepted.push({ ...item, seenitParentalRating: rating });
      }

      if (onPartial && accepted.length > lastPublishedCount) {
        lastPublishedCount = accepted.length;
        onPartial({
          ...baseResult.value,
          results: [...accepted],
        });
      }
    }

    return ok({
      ...baseResult.value,
      results: accepted,
    });
  };
}

export const discoverSeenItProgressive = createProgressiveAgeDiscover();
