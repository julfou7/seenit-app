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
  strongIdentity?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}

function getComparableStrongIdentity(rawItem: unknown, mediaType: 'movie' | 'episode', serverId: string): string | undefined {
  const item = unwrapPlexMediaItem(rawItem);
  const identityItem = mediaType === 'episode'
    ? buildPlexParentShowIdentityItem({ ...item, serverId, serverIdentifier: serverId })
    : { ...item, serverId, serverIdentifier: serverId };
  const identity = getStrongPlexSourceIdentity(identityItem);

  // serverId + ratingKey est une excellente identité technique pour recontrôler un objet,
  // mais deux copies du même média peuvent avoir des ratingKey différents. Ce fallback ne
  // permet donc jamais, à lui seul, de prouver que deux médias sont différents.
  if (!identity || identity.startsWith('server:')) return undefined;
  return identity;
}

function getLocatorComparableStrongIdentity(locator: PlexDeltaWatchedLocator): string | undefined {
  const resolutionKey = String(locator.resolutionKey || '').replace(/^(?:movie|tv):/, '');
  if (/^(?:tmdb|imdb|tvdb|plex):/i.test(resolutionKey)) return resolutionKey.toLowerCase();
  return undefined;
}

function strongIdentitiesProveDifferent(
  locator: PlexDeltaWatchedLocator,
  unresolved: PlexDeltaUnresolvedWatchedItem
): boolean {
  const locatorIdentity = getLocatorComparableStrongIdentity(locator);
  const unresolvedIdentity = unresolved.strongIdentity?.toLowerCase();
  if (!locatorIdentity || !unresolvedIdentity) return false;

  const locatorScheme = locatorIdentity.split(':', 1)[0];
  const unresolvedScheme = unresolvedIdentity.split(':', 1)[0];
  return locatorScheme === unresolvedScheme && locatorIdentity !== unresolvedIdentity;
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

  const strongIdentity = getComparableStrongIdentity(item, mediaType, normalizedServerId);

  if (mediaType === 'movie') {
    return {
      serverId: normalizedServerId,
      ratingKey,
      mediaType: 'movie',
      ...(strongIdentity ? { strongIdentity } : {})
    };
  }

  const seasonNumber = Number(item?.parentIndex);
  const episodeNumber = Number(item?.index);
  return {
    serverId: normalizedServerId,
    ratingKey,
    mediaType: 'episode',
    ...(strongIdentity ? { strongIdentity } : {}),
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
 * On ne rapproche jamais par titre/année. Deux identités fortes du même fournisseur
 * (TMDB/IMDb/TVDB/Plex GUID) et de valeurs différentes prouvent au contraire qu'il
 * s'agit de médias distincts ; elles ne doivent donc pas bloquer un non vu sans rapport.
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

    if (strongIdentitiesProveDifferent(locator, unresolved)) {
      continue;
    }

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
