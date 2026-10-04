import { hasExplicitDownloadError, isDownloadCompleted, type DownloadStateLike } from './downloadStatePolicy.ts';

interface ActiveDownloadScopeItem extends DownloadStateLike {
  mediaType: 'movie' | 'tv';
  tmdbId?: number;
  seasonNumber?: number;
  episodeNumber?: number;
}

const launches = new Map<string, { promise: Promise<unknown>; expiresAt: number }>();

/** Le même scope ne produit pas deux commandes lors d'appuis/callbacks rapprochés. */
export function shareDownloadSearch<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const now = Date.now();
  for (const [scope, entry] of launches) if (entry.expiresAt <= now) launches.delete(scope);
  const existing = launches.get(key);
  if (existing) return existing.promise as Promise<T>;
  const entry = { promise: Promise.resolve().then(operation), expiresAt: Infinity };
  launches.set(key, entry);
  void entry.promise.then(() => { entry.expiresAt = Date.now() + 10_000; },
    () => { entry.expiresAt = Date.now() + 10_000; });
  return entry.promise;
}

export function hasActiveDownloadInScope(downloads: ActiveDownloadScopeItem[], scope: {
  mediaType: 'movie' | 'tv'; tmdbId?: number; seasonNumber?: number; episodeNumber?: number;
}): boolean {
  return downloads.some(item => item.mediaType === scope.mediaType && Boolean(scope.tmdbId)
    && Number(item.tmdbId) === Number(scope.tmdbId)
    && item.status !== 'cancelled' && item.status !== 'waiting' && !hasExplicitDownloadError(item) && !isDownloadCompleted(item)
    && (scope.mediaType === 'movie' || (
      (item.seasonNumber == null || scope.seasonNumber == null || item.seasonNumber === scope.seasonNumber)
      && (item.episodeNumber == null || scope.episodeNumber == null || item.episodeNumber === scope.episodeNumber)
    )));
}
