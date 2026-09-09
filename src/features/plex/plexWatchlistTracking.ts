import type { Show, TrackingProvenance } from '../../types.ts';

export interface PlexWatchlistSnapshot {
  mode: 'full' | 'delta';
  complete: boolean;
  unresolvedItemCount: number;
  mediaIdentities: ReadonlySet<string>;
}

const AUTHORITATIVE_WATCHLIST_HOSTS = new Set([
  'discover.provider.plex.tv',
  'metadata.provider.plex.tv'
]);

export function getPlexWatchlistMediaIdentity(
  mediaType: 'movie' | 'tv',
  tmdbId: unknown
): string | null {
  const numericTmdbId = Number(tmdbId);
  if (!Number.isSafeInteger(numericTmdbId) || numericTmdbId <= 0) return null;
  return `${mediaType}:${numericTmdbId}`;
}

export function buildPlexWatchlistTrackingProvenance(
  mediaType: 'movie' | 'tv',
  tmdbId: unknown,
  importedAt = Date.now()
): TrackingProvenance {
  const mediaIdentity = getPlexWatchlistMediaIdentity(mediaType, tmdbId);
  if (!mediaIdentity) throw new Error('Identité TMDB Watchlist invalide');

  return {
    source: 'plex-watchlist',
    mediaIdentity,
    importedAt
  };
}

export function isAuthoritativePlexWatchlistEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:'
      && AUTHORITATIVE_WATCHLIST_HOSTS.has(url.hostname)
      && url.pathname === '/library/sections/watchlist/all';
  } catch {
    return false;
  }
}

export function isRecognizedPlexWatchlistPayload(payload: unknown): boolean {
  if (Array.isArray(payload)) return true;
  if (!payload || typeof payload !== 'object') return false;
  const data = payload as Record<string, any>;
  if (
    Array.isArray(data.activities)
    || Array.isArray(data.Metadata)
    || Array.isArray(data.metadata)
    || Array.isArray(data.items)
  ) return true;

  for (const container of [data.MediaContainer, data.mediaContainer]) {
    if (!container || typeof container !== 'object') continue;
    if (Array.isArray(container.Metadata) || Array.isArray(container.metadata)) return true;
    const declaredSize = Number(container.size ?? container.totalSize ?? container.total_size);
    if (Number.isFinite(declaredSize) && declaredSize === 0) return true;
  }

  return false;
}

function hasIndependentSeenItIntent(show: Show): boolean {
  if (show.status !== 'plan_to_watch') return true;
  if (show.isArchived === true || show.isFavorite === true || show.notificationsEnabled === true) return true;
  if (Number.isFinite(Number(show.userRating)) && Number(show.userRating) > 0) return true;
  if (Number.isFinite(Number(show.lastWatchedAt)) && Number(show.lastWatchedAt) > 0) return true;
  if (Array.isArray(show.seenEpisodes) && show.seenEpisodes.length > 0) return true;
  return Object.keys(show.episodeRecords || {}).length > 0;
}

function isPlexWatchlistOwnedTracking(show: Show): boolean {
  const expectedIdentity = getPlexWatchlistMediaIdentity(show.mediaType, show.tmdbId);
  return Boolean(
    expectedIdentity
    && show.trackingProvenance?.source === 'plex-watchlist'
    && show.trackingProvenance.mediaIdentity === expectedIdentity
  );
}

/**
 * Décide uniquement à partir d'un snapshot Watchlist exhaustif et d'une provenance
 * exacte. Le mode full/delta n'influe pas sur la sémantique métier.
 */
export function selectPlexWatchlistTrackingRemovals(
  shows: readonly Show[],
  snapshot: PlexWatchlistSnapshot
): Show[] {
  if (!snapshot.complete || snapshot.unresolvedItemCount > 0) return [];

  return shows.filter(show => {
    if (!isPlexWatchlistOwnedTracking(show) || hasIndependentSeenItIntent(show)) return false;
    const identity = getPlexWatchlistMediaIdentity(show.mediaType, show.tmdbId);
    return Boolean(identity && !snapshot.mediaIdentities.has(identity));
  });
}
