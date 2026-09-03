import type { PlexLibraryWatchState } from './plexLibraryWatchState.ts';

export interface PlexDeltaWatchedLocator {
  serverId: string;
  ratingKey: string;
  mediaType: 'movie' | 'episode';
  tmdbId: number;
  seasonNumber?: number;
  episodeNumber?: number;
}

function positiveInteger(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

export function getPlexDeltaWatchedLocatorKey(locator: PlexDeltaWatchedLocator): string {
  if (locator.mediaType === 'movie') {
    return `${locator.serverId}:movie:${locator.tmdbId}:${locator.ratingKey}`;
  }
  return `${locator.serverId}:episode:${locator.tmdbId}:${locator.seasonNumber}:${locator.episodeNumber}:${locator.ratingKey}`;
}

export function sanitizePlexDeltaWatchedLocators(value: unknown): PlexDeltaWatchedLocator[] {
  if (!Array.isArray(value)) return [];

  const result: PlexDeltaWatchedLocator[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const serverId = String(item.serverId || '').trim();
    const ratingKey = String(item.ratingKey || '').trim();
    const mediaType = item.mediaType === 'episode' ? 'episode' : item.mediaType === 'movie' ? 'movie' : null;
    const tmdbId = positiveInteger(item.tmdbId);
    if (!serverId || !ratingKey || !mediaType || !tmdbId) continue;

    let locator: PlexDeltaWatchedLocator;
    if (mediaType === 'episode') {
      const seasonNumber = positiveInteger(item.seasonNumber);
      const episodeNumber = positiveInteger(item.episodeNumber);
      if (!seasonNumber || !episodeNumber) continue;
      locator = { serverId, ratingKey, mediaType, tmdbId, seasonNumber, episodeNumber };
    } else {
      locator = { serverId, ratingKey, mediaType, tmdbId };
    }

    const key = getPlexDeltaWatchedLocatorKey(locator);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(locator);
  }
  return result;
}

export function findMissingPlexDeltaWatchedLocators(
  previous: PlexDeltaWatchedLocator[],
  current: PlexDeltaWatchedLocator[],
  scannedServerIds: Set<string>
): PlexDeltaWatchedLocator[] {
  const currentKeys = new Set(current.map(getPlexDeltaWatchedLocatorKey));
  return previous.filter(locator => (
    scannedServerIds.has(locator.serverId) &&
    !currentKeys.has(getPlexDeltaWatchedLocatorKey(locator))
  ));
}

/**
 * Une disparition du snapshot des seuls éléments vus n'est jamais suffisante pour
 * déduire un dé-vu. On exige la réponse exacte du ratingKey PMS et un viewCount
 * numérique explicite. Une valeur absente, invalide ou un autre ratingKey reste
 * indéterminée et ne produit aucune mutation destructive.
 */
export function buildExplicitPlexDeltaWatchState(
  locator: PlexDeltaWatchedLocator,
  rawMetadata: unknown
): PlexLibraryWatchState | null {
  if (!rawMetadata || typeof rawMetadata !== 'object') return null;
  const metadata = rawMetadata as Record<string, unknown>;
  const responseRatingKey = String(metadata.ratingKey || '').trim();
  if (!responseRatingKey || responseRatingKey !== locator.ratingKey) return null;

  const rawViewCount = metadata.viewCount ?? metadata.view_count;
  if (rawViewCount === null || rawViewCount === undefined || rawViewCount === '') return null;
  const viewCount = Number(rawViewCount);
  if (!Number.isFinite(viewCount) || viewCount < 0) return null;
  const watched = viewCount > 0;

  if (locator.mediaType === 'movie') {
    return {
      mediaType: 'movie',
      tmdbId: locator.tmdbId,
      watched,
      serverId: locator.serverId
    };
  }

  return {
    mediaType: 'episode',
    tmdbId: locator.tmdbId,
    seasonNumber: locator.seasonNumber!,
    episodeNumber: locator.episodeNumber!,
    watched,
    serverId: locator.serverId
  };
}

export function mergePlexDeltaWatchedLocators(params: {
  previous: PlexDeltaWatchedLocator[];
  current: PlexDeltaWatchedLocator[];
  scannedServerIds: Set<string>;
  confirmedUnwatched: Set<string>;
}): PlexDeltaWatchedLocator[] {
  const previous = sanitizePlexDeltaWatchedLocators(params.previous);
  const current = sanitizePlexDeltaWatchedLocators(params.current);
  const currentByKey = new Map(current.map(locator => [getPlexDeltaWatchedLocatorKey(locator), locator]));
  const consumedCurrent = new Set<string>();
  const next: PlexDeltaWatchedLocator[] = [];

  for (const locator of previous) {
    const key = getPlexDeltaWatchedLocatorKey(locator);
    const replacement = currentByKey.get(key);

    if (!params.scannedServerIds.has(locator.serverId)) {
      next.push(locator);
      continue;
    }
    if (params.confirmedUnwatched.has(key)) continue;
    if (replacement) {
      next.push(replacement);
      consumedCurrent.add(key);
    } else {
      // Recontrôle inconnu/échoué : conserver le dernier état vu connu plutôt que
      // transformer une absence ou une panne en suppression.
      next.push(locator);
    }
  }

  for (const locator of current) {
    const key = getPlexDeltaWatchedLocatorKey(locator);
    if (consumedCurrent.has(key)) continue;
    if (!next.some(existing => getPlexDeltaWatchedLocatorKey(existing) === key)) {
      next.push(locator);
    }
  }

  return next;
}
