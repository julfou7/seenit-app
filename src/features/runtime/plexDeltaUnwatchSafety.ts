import {
  getPlexMetadataLookupKey,
  unwrapPlexMediaItem
} from '../plex/plexIdentity.ts';
import type { PlexDeltaWatchedLocator } from '../plex/plexDeltaUnwatch.ts';

export interface PlexDeltaUnresolvedWatchedItem {
  serverId: string;
  ratingKey: string;
  mediaType: 'movie' | 'episode';
  seasonNumber?: number;
  episodeNumber?: number;
}

export function buildPlexDeltaUnresolvedWatchedItem(
  rawItem: unknown,
  mediaType: 'movie' | 'episode',
  serverId: string
): PlexDeltaUnresolvedWatchedItem | null {
  const item = unwrapPlexMediaItem(rawItem);
  const ratingKey = getPlexMetadataLookupKey(item);
  const normalizedServerId = String(serverId || '').trim();
  if (!normalizedServerId || !ratingKey) return null;

  if (mediaType === 'movie') {
    return { serverId: normalizedServerId, ratingKey, mediaType: 'movie' };
  }

  const seasonNumber = Number(item?.parentIndex);
  const episodeNumber = Number(item?.index);
  return {
    serverId: normalizedServerId,
    ratingKey,
    mediaType: 'episode',
    ...(Number.isInteger(seasonNumber) && seasonNumber >= 0 ? { seasonNumber } : {}),
    ...(Number.isInteger(episodeNumber) && episodeNumber > 0 ? { episodeNumber } : {})
  };
}

/**
 * La collecte watched est techniquement complète dès lors que chaque objet vu retourné
 * possède un ratingKey PMS exact. La résolution TMDB reste obligatoire pour produire un
 * état SeenIt, mais un média vu non résolu ne doit pas invalider tout le serveur.
 */
export function isPlexDeltaWatchedQueryTechnicallyComplete(watchedItems: unknown[]): boolean {
  return watchedItems.every(item => Boolean(getPlexMetadataLookupKey(unwrapPlexMediaItem(item))));
}

/**
 * Un vu non résolu ne bloque que le candidat qu'il pourrait réellement concurrencer.
 * On ne rapproche jamais par titre/année : pour un film sans identité canonique, toute
 * autre copie film reste ambiguë ; pour un épisode, des coordonnées S/E différentes
 * prouvent qu'il ne s'agit pas du même épisode.
 */
export function canRecheckPlexDeltaUnwatchCandidate(
  locator: PlexDeltaWatchedLocator,
  unresolvedWatchedItems: PlexDeltaUnresolvedWatchedItem[]
): boolean {
  for (const unresolved of unresolvedWatchedItems) {
    if (unresolved.serverId === locator.serverId && unresolved.ratingKey === locator.ratingKey) {
      return false;
    }
    if (unresolved.mediaType !== locator.mediaType) continue;

    if (locator.mediaType === 'movie') {
      return false;
    }

    if (
      unresolved.seasonNumber === undefined ||
      unresolved.episodeNumber === undefined ||
      locator.seasonNumber === undefined ||
      locator.episodeNumber === undefined
    ) {
      return false;
    }

    if (
      unresolved.seasonNumber === locator.seasonNumber &&
      unresolved.episodeNumber === locator.episodeNumber
    ) {
      return false;
    }
  }

  return true;
}
