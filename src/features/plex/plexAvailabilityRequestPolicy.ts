export type PlexAvailabilityNetworkMode = 'cache-only' | 'active';

export const PLEX_AVAILABILITY_REQUEST_TIMEOUT_MS = 20_000;
export const PLEX_AVAILABILITY_MAX_CONCURRENT = 2;

export function shouldRunPlexAvailabilityNetwork(mode?: PlexAvailabilityNetworkMode): boolean {
  // Le cache est le comportement sûr par défaut pour les consommateurs passifs
  // (grilles/cartes). Une vérification réseau doit être explicitement demandée.
  return mode === 'active';
}

export function isConfirmedPlexAvailabilityResponse(
  status: number,
  data: unknown
): data is { available: boolean } & Record<string, unknown> {
  return status >= 200
    && status < 300
    && typeof data === 'object'
    && data !== null
    && typeof (data as { available?: unknown }).available === 'boolean';
}

export interface AsyncRequestLimiter {
  run<T>(task: () => Promise<T>): Promise<T>;
  getActiveCount(): number;
  getPendingCount(): number;
}

export function createAsyncRequestLimiter(maxConcurrent: number): AsyncRequestLimiter {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new Error('maxConcurrent doit être un entier supérieur ou égal à 1');
  }

  let activeCount = 0;
  const pending: Array<() => void> = [];

  const drain = () => {
    while (activeCount < maxConcurrent && pending.length > 0) {
      const start = pending.shift();
      if (!start) break;
      activeCount += 1;
      start();
    }
  };

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        pending.push(() => {
          Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => {
              activeCount -= 1;
              drain();
            });
        });
        drain();
      });
    },
    getActiveCount: () => activeCount,
    getPendingCount: () => pending.length
  };
}
