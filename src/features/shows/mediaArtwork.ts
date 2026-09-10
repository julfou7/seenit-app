export type MediaArtworkType = 'movie' | 'tv';

export interface TrackedMediaArtworkLike {
  id?: string | number | null;
  tmdbId?: string | number | null;
  mediaType?: 'movie' | 'tv' | null;
  posterPath?: string | null;
  backdropPath?: string | null;
}

export interface MediaArtworkUpdates {
  posterPath?: string;
  backdropPath?: string;
}

const cleanArtworkPath = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export function getTmdbArtwork(details: any): MediaArtworkUpdates {
  const posterPath = cleanArtworkPath(details?.poster_path);
  const backdropPath = cleanArtworkPath(details?.backdrop_path);
  return {
    ...(posterPath ? { posterPath } : {}),
    ...(backdropPath ? { backdropPath } : {}),
  };
}

/**
 * Converge uniquement les visuels éditoriaux depuis une identité TMDB exacte.
 * Une absence de visuel frais n'efface jamais le dernier fallback persisté.
 */
export function getTrackedMediaArtworkConvergence(
  shows: TrackedMediaArtworkLike[],
  mediaType: MediaArtworkType,
  tmdbId: string | number,
  details: any,
): { showId: string; updates: MediaArtworkUpdates } | null {
  const normalizedTmdbId = Number(tmdbId);
  if (!Number.isFinite(normalizedTmdbId) || normalizedTmdbId <= 0) return null;

  const tracked = shows.find((show) => {
    const trackedType: MediaArtworkType = show.mediaType === 'movie' ? 'movie' : 'tv';
    return trackedType === mediaType && Number(show.tmdbId) === normalizedTmdbId;
  });
  if (!tracked?.id) return null;

  const fresh = getTmdbArtwork(details);
  const updates: MediaArtworkUpdates = {};
  if (fresh.posterPath && cleanArtworkPath(tracked.posterPath) !== fresh.posterPath) {
    updates.posterPath = fresh.posterPath;
  }
  if (fresh.backdropPath && cleanArtworkPath(tracked.backdropPath) !== fresh.backdropPath) {
    updates.backdropPath = fresh.backdropPath;
  }

  return Object.keys(updates).length > 0
    ? { showId: String(tracked.id), updates }
    : null;
}
