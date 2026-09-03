import type { PlexLibraryWatchState } from './plexLibraryWatchState.ts';

export interface PlexDeltaWatchedLocator {
  serverId: string;
  ratingKey: string;
  mediaType: 'movie' | 'episode';
  /**
   * Le TMDB est l'identité canonique SeenIt, mais il n'est pas obligatoire au moment
   * où le PMS rapporte simplement que le ratingKey est vu. Il doit être résolu avant
   * de produire un watched=false destiné au client.
   */
  tmdbId?: number;
  /** Clé purement technique du cache de résolution partagé du même UID. */
  resolutionKey?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}

function positiveInteger(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
}

function sanitizeResolutionKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const key = value.trim();
  if (!key || key.length > 320) return undefined;
  if (/^(?:movie|tv):(?:tmdb:\d+|imdb:tt\d+|tvdb:\d+|plex:[A-Za-z0-9_-]+)$/i.test(key)) {
    return key;
  }
  if (/^(?:movie|tv):server:[A-Za-z0-9_-]+:rating:[A-Za-z0-9_-]+$/i.test(key)) {
    return key;
  }
  return undefined;
}

/**
 * La clé de présence watched est volontairement purement PMS. Le TMDB peut être
 * enrichi entre deux runs (par exemple par Plex Discover côté client) sans que cela
 * transforme artificiellement le même ratingKey en disparition + nouvel élément.
 */
export function getPlexDeltaWatchedLocatorKey(locator: PlexDeltaWatchedLocator): string {
  return `${locator.serverId}:${locator.mediaType}:${locator.ratingKey}`;
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
    if (!serverId || !ratingKey || !mediaType) continue;

    const tmdbId = positiveInteger(item.tmdbId) || undefined;
    const resolutionKey = sanitizeResolutionKey(item.resolutionKey);
    let locator: PlexDeltaWatchedLocator;
    if (mediaType === 'episode') {
      const seasonNumber = nonNegativeInteger(item.seasonNumber);
      const episodeNumber = positiveInteger(item.episodeNumber);
      if (seasonNumber === null || !episodeNumber) continue;
      locator = {
        serverId,
        ratingKey,
        mediaType,
        ...(tmdbId ? { tmdbId } : {}),
        ...(resolutionKey ? { resolutionKey } : {}),
        seasonNumber,
        episodeNumber
      };
    } else {
      locator = {
        serverId,
        ratingKey,
        mediaType,
        ...(tmdbId ? { tmdbId } : {}),
        ...(resolutionKey ? { resolutionKey } : {})
      };
    }

    const key = getPlexDeltaWatchedLocatorKey(locator);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(locator);
  }
  return result;
}

export function hydratePlexDeltaWatchedLocator(
  locator: PlexDeltaWatchedLocator,
  resolutionCache: unknown
): PlexDeltaWatchedLocator {
  if (locator.tmdbId || !locator.resolutionKey) return locator;
  if (!resolutionCache || typeof resolutionCache !== 'object' || Array.isArray(resolutionCache)) return locator;

  const cached = (resolutionCache as Record<string, any>)[locator.resolutionKey];
  const tmdbId = positiveInteger(cached?.id ?? cached?.tmdbId);
  return tmdbId ? { ...locator, tmdbId } : locator;
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
 * déduire un état non vu. On exige la réponse exacte du ratingKey PMS et un viewCount
 * numérique explicite. Une valeur absente, invalide ou un autre ratingKey reste
 * indéterminée et ne produit aucune mutation destructive.
 */
export function buildExplicitPlexDeltaWatchState(
  locator: PlexDeltaWatchedLocator,
  rawMetadata: unknown
): PlexLibraryWatchState | null {
  if (!locator.tmdbId) return null;
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
      // Conserver l'identité canonique/cache déjà enrichie si la requête watched
      // courante retourne une forme plus pauvre du même ratingKey.
      next.push({
        ...locator,
        ...replacement,
        tmdbId: replacement.tmdbId || locator.tmdbId,
        resolutionKey: replacement.resolutionKey || locator.resolutionKey
      });
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
