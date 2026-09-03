export interface PlexServerSyncEntry {
  id?: string;
  name: string;
  watchedItems?: number;
  inventoryItems?: number;
  reason?: string;
}

export interface PlexCollectionIntegrity {
  collectionComplete?: boolean;
  libraryInventoryScanSucceeded?: boolean;
  libraryInventoryScanComplete?: boolean;
  incompleteSources?: string[];
  syncedServers?: PlexServerSyncEntry[];
  skippedServers?: PlexServerSyncEntry[];
}

export function evaluatePlexSourceCompletion(params: {
  delta: boolean;
  serverCount: number;
  completeInventoryServers: number;
  completeHistoryServers: number;
  accountHistoryAvailable: boolean;
  cloudCollectionSucceeded: boolean;
}): {
  libraryInventoryScanSucceeded: boolean;
  libraryInventoryScanComplete: boolean;
  historyCollectionComplete: boolean;
} {
  const libraryInventoryScanComplete = !params.delta &&
    params.completeInventoryServers === params.serverCount;
  const libraryInventoryScanSucceeded = !params.delta &&
    (params.completeInventoryServers > 0 || params.serverCount === 0);
  const pmsHistoryFallbackSucceeded = params.completeHistoryServers > 0;
  const historyCollectionComplete = params.delta
    ? params.cloudCollectionSucceeded || pmsHistoryFallbackSucceeded
    : params.accountHistoryAvailable || pmsHistoryFallbackSucceeded;

  return {
    libraryInventoryScanSucceeded,
    libraryInventoryScanComplete,
    historyCollectionComplete
  };
}

export function isPermanentPlexResolutionMiss(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : String((error as any)?.message || error || '');
  return /TMDB Error:\s*404|No media found/i.test(message);
}

export function shouldReplacePlexAvailabilityCache(
  delta: boolean,
  integrity?: PlexCollectionIntegrity | null
): boolean {
  return !delta && integrity?.libraryInventoryScanSucceeded === true;
}

/**
 * Le bilan utilisateur ne liste plus les serveurs ignorés : ils restent disponibles
 * dans `integrity.skippedServers` et dans les logs de diagnostic. Le toast ne montre
 * que le nombre de serveurs effectivement scannés.
 */
export function describePlexServerSync(
  integrity?: PlexCollectionIntegrity | null
): string {
  const syncedServers = Array.isArray(integrity?.syncedServers)
    ? integrity.syncedServers.filter((server) => server?.name)
    : [];

  if (syncedServers.length === 0) return '';
  const serverLabel = syncedServers.length === 1 ? 'serveur scanné' : 'serveurs scannés';
  return `${syncedServers.length} ${serverLabel}`;
}

export function getPlexServerSyncCounts(
  integrity?: PlexCollectionIntegrity | null
): { synced: number; skipped: number } {
  return {
    synced: Array.isArray(integrity?.syncedServers) ? integrity.syncedServers.length : 0,
    skipped: Array.isArray(integrity?.skippedServers) ? integrity.skippedServers.length : 0
  };
}

export function shouldCommitPlexCursor(params: {
  collectionComplete?: boolean;
  retryableUnresolvedCount?: number;
  firestoreCommitted?: boolean;
}): boolean {
  return params.collectionComplete === true &&
    (params.retryableUnresolvedCount || 0) === 0 &&
    params.firestoreCommitted === true;
}

export function describeIncompletePlexSync(
  integrity?: PlexCollectionIntegrity | null,
  retryableUnresolvedCount = 0
): string {
  const reasons: string[] = [];
  const sources = Array.isArray(integrity?.incompleteSources)
    ? integrity!.incompleteSources!.filter(Boolean)
    : [];

  if (integrity?.collectionComplete !== true) {
    reasons.push(sources.length > 0
      ? `sources incomplètes : ${sources.join(', ')}`
      : 'collecte Plex incomplète');
  }
  if (retryableUnresolvedCount > 0) {
    reasons.push(`${retryableUnresolvedCount} identité(s) à retenter`);
  }

  return reasons.join(' ; ') || 'synchronisation complète';
}