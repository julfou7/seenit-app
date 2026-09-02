import { extractPlexExternalIds } from './plexIdentity';

export type PlexLibraryWatchState =
  | {
      mediaType: 'movie';
      tmdbId: number;
      watched: boolean;
      serverId?: string;
      serverName?: string;
    }
  | {
      mediaType: 'episode';
      tmdbId: number;
      seasonNumber: number;
      episodeNumber: number;
      watched: boolean;
      serverId?: string;
      serverName?: string;
    };

function positiveInteger(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

export function buildPlexLibraryWatchState(
  rawItem: any,
  options: {
    mediaType: 'movie' | 'episode';
    parentTmdbId?: number | null;
    serverId?: string;
    serverName?: string;
  }
): PlexLibraryWatchState | null {
  const tmdbId = options.mediaType === 'movie'
    ? positiveInteger(extractPlexExternalIds(rawItem).tmdbId)
    : positiveInteger(options.parentTmdbId);
  if (!tmdbId) return null;

  const watched = Number(rawItem?.viewCount ?? rawItem?.view_count ?? 0) > 0;
  if (options.mediaType === 'movie') {
    return {
      mediaType: 'movie',
      tmdbId,
      watched,
      serverId: options.serverId,
      serverName: options.serverName
    };
  }

  const seasonNumber = positiveInteger(rawItem?.parentIndex);
  const episodeNumber = positiveInteger(rawItem?.index);
  if (!seasonNumber || !episodeNumber) return null;

  return {
    mediaType: 'episode',
    tmdbId,
    seasonNumber,
    episodeNumber,
    watched,
    serverId: options.serverId,
    serverName: options.serverName
  };
}

export function getPlexLibraryWatchStateKey(state: PlexLibraryWatchState): string {
  return state.mediaType === 'movie'
    ? `movie:${state.tmdbId}`
    : `tv:${state.tmdbId}:${state.seasonNumber}:${state.episodeNumber}`;
}

/**
 * Plusieurs serveurs peuvent exposer le même média. Une copie vue gagne sur une copie
 * non vue afin de ne pas retirer SeenIt tant qu'au moins une bibliothèque courante
 * rapporte explicitement ce visionnage.
 */
export function mergePlexLibraryWatchStates(
  states: PlexLibraryWatchState[]
): PlexLibraryWatchState[] {
  const merged = new Map<string, PlexLibraryWatchState>();

  for (const state of states) {
    const key = getPlexLibraryWatchStateKey(state);
    const current = merged.get(key);
    if (!current || (!current.watched && state.watched)) {
      merged.set(key, state);
    }
  }

  return [...merged.values()];
}
