import { authenticatedFetch } from '../../lib/apiAuth';
import { type Result, ok, err, tryCatch } from '../../core/Result';
import { TMDBClient as CoreTMDBClient } from './tmdbClientCore';

export * from './tmdbClientCore';

export const PARENTAL_RATING_BATCH_MAX_ITEMS = 40;
const PARENTAL_RATING_BATCH_CACHE_MAX = 80;

type ParentalMediaType = 'movie' | 'tv';
interface PendingParentalRating {
  id: number;
  mediaType: ParentalMediaType;
  key: string;
  resolve: (result: Result<any>) => void;
}

/**
 * Extension transport du client TMDB historique.
 *
 * Le moteur parental continue de consommer exactement les mêmes payloads
 * release_dates/content_ratings ; seule leur acquisition réseau est regroupée
 * afin d'éviter jusqu'à 40 allers-retours Firebase-authentifiés dans Explorer.
 */
export class TMDBClient extends CoreTMDBClient {
  private parentalBatchCache = new Map<string, any>();
  private parentalBatchInFlight = new Map<string, Promise<Result<any>>>();
  private parentalBatchQueue: PendingParentalRating[] = [];
  private parentalBatchScheduled = false;

  override peekParentalRatingDetails(id: number, type: ParentalMediaType = 'tv'): any | null {
    const normalizedId = Number(id);
    return super.peekParentalRatingDetails(normalizedId, type)
      || this.parentalBatchCache.get(`${type}_${normalizedId}`)
      || null;
  }

  override async getParentalRatingDetails(id: number, type: ParentalMediaType = 'tv'): Promise<Result<any>> {
    const normalizedId = Number(id);
    const cacheKey = `${type}_${normalizedId}`;
    const cached = this.peekParentalRatingDetails(normalizedId, type);
    if (cached) return ok(cached);

    const existing = this.parentalBatchInFlight.get(cacheKey);
    if (existing) return existing;

    const request = new Promise<Result<any>>(resolve => {
      this.parentalBatchQueue.push({
        id: normalizedId,
        mediaType: type,
        key: `${type}:${normalizedId}`,
        resolve,
      });
      this.scheduleParentalBatchFlush();
    });
    this.parentalBatchInFlight.set(cacheKey, request);
    try {
      return await request;
    } finally {
      if (this.parentalBatchInFlight.get(cacheKey) === request) {
        this.parentalBatchInFlight.delete(cacheKey);
      }
    }
  }

  private scheduleParentalBatchFlush(): void {
    if (this.parentalBatchScheduled) return;
    this.parentalBatchScheduled = true;
    Promise.resolve().then(() => {
      this.parentalBatchScheduled = false;
      void this.flushParentalBatch();
    });
  }

  private rememberParentalBatch(cacheKey: string, details: any): void {
    this.parentalBatchCache.delete(cacheKey);
    this.parentalBatchCache.set(cacheKey, details);
    while (this.parentalBatchCache.size > PARENTAL_RATING_BATCH_CACHE_MAX) {
      this.parentalBatchCache.delete(this.parentalBatchCache.keys().next().value!);
    }
  }

  private async fallbackParentalRequest(pending: PendingParentalRating): Promise<void> {
    const fallback = await super.getParentalRatingDetails(pending.id, pending.mediaType);
    pending.resolve(fallback);
  }

  private async flushParentalBatch(): Promise<void> {
    const batch = this.parentalBatchQueue.splice(0, PARENTAL_RATING_BATCH_MAX_ITEMS);
    if (batch.length === 0) return;
    if (this.parentalBatchQueue.length > 0) this.scheduleParentalBatchFlush();

    const encodedItems = encodeURIComponent(batch.map(item => item.key).join(','));
    const response = await tryCatch(authenticatedFetch(`/api/media/parental-ratings?items=${encodedItems}`));
    if (!response.ok || !response.value.ok) {
      await Promise.all(batch.map(item => this.fallbackParentalRequest(item)));
      return;
    }

    const payload = await tryCatch(response.value.json());
    if (!payload.ok || !Array.isArray(payload.value?.results)) {
      await Promise.all(batch.map(item => this.fallbackParentalRequest(item)));
      return;
    }

    const results = new Map<string, any>();
    for (const item of payload.value.results) {
      if (typeof item?.key === 'string') results.set(item.key, item.details ?? null);
    }

    await Promise.all(batch.map(async pending => {
      const details = results.get(pending.key);
      if (!details) {
        await this.fallbackParentalRequest(pending);
        return;
      }
      this.rememberParentalBatch(`${pending.mediaType}_${pending.id}`, details);
      pending.resolve(ok(details));
    }));
  }
}
