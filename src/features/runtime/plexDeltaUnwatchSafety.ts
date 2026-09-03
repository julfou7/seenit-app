import {
  buildPlexParentShowIdentityItem,
  getPlexMetadataLookupKey,
  getStrongPlexSourceIdentity,
  unwrapPlexMediaItem
} from '../plex/plexIdentity.ts';
import type { PlexDeltaWatchedLocator } from '../plex/plexDeltaUnwatch.ts';

export interface PlexDeltaUnresolvedWatchedItem {
  serverId: string;
  ratingKey: string;
  mediaType: 'movie' | 'episode';
  relationIdentity?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}

function getRelationIdentity(rawItem: unknown, mediaType: 'movie' | 'episode', serverId: string): string | undefined {
  const item = unwrapPlexMediaItem(rawItem);
  const identityItem = mediaType === 'episode'
    ? buildPlexParentShowIdentityItem({ ...item, serverId, serverIdentifier: serverId })
    : { ...item, serverId, serverIdentifier: serverId };
  const identity = getStrongPlexSourceIdentity(identityItem);
  return identity || undefined;
}

function getLocatorRelationIdentity(locator: PlexDeltaWatchedLocator): string | undefined {
  const resolutionKey = String(locator.resolutionKey || '').replace(/^(?:movie|tv):/, '');
  return resolutionKey || undefined;
}

function hasDemonstratedTechnicalRelation(
  locator: PlexDeltaWatchedLocator,
  unresolved: PlexDeltaUnresolvedWatchedItem
): boolean {
  const locatorIdentity = getLocatorRelationIdentity(locator)?.toLowerCase();
  const unresolvedIdentity = unresolved.relationIdentity?.toLowerCase();
  return Boolean(locatorIdentity && unresolvedIdentity && locatorIdentity === unresolvedIdentity);
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

  const relationIdentity = getRelationIdentity(item, mediaType, normalizedServerId);

  if (mediaType === 'movie') {
    return {
      serverId: normalizedServerId,
      ratingKey,
      mediaType: 'movie',
      ...(relationIdentity ? { relationIdentity } : {})
    };
  }

  const seasonNumber = Number(item?.parentIndex);
  const episodeNumber = Number(item?.index);
  return {
    serverId: normalizedServerId,
    ratingKey,
    mediaType: 'episode',
    ...(relationIdentity ? { relationIdentity } : {}),
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
 * Un vu non résolu ne bloque que le candidat auquel une relation technique est réellement
 * démontrée. Le titre et l'année ne participent jamais à cette décision. Un autre film sans
 * identité commune, ou un épisode d'une autre série, ne peut donc plus désactiver tous les
 * non vus DELTA. Le même ratingKey reste toujours bloquant ; pour une autre copie, une identité
 * provider/parent commune est exigée avant de la considérer concurrente.
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
    if (!hasDemonstratedTechnicalRelation(locator, unresolved)) continue;

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
