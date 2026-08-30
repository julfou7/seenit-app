export interface PlexCollectionIntegrity {
  collectionComplete?: boolean;
  libraryInventoryScanComplete?: boolean;
  incompleteSources?: string[];
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
  return !delta && integrity?.libraryInventoryScanComplete === true;
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
