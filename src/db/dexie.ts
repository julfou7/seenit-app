import Dexie, { type Table } from 'dexie';

export interface OmdbRatingsCacheItem {
  id: string; // `${imdbId}-S${seasonNumber}`
  imdbId: string;
  seasonNumber: number;
  ratings: Record<number, { rating: number; imdbId: string } | number>; // { [episodeNumber]: { rating, imdbId } }
  isOngoing?: boolean;
  updatedAt: number;
}

export interface OmdbEpisodeVotesCacheItem {
  imdbId: string;
  votes: string;
  rating?: number;
  isOngoing?: boolean;
  updatedAt: number;
}

export class AppDatabase extends Dexie {
  omdbRatingsCache!: Table<OmdbRatingsCacheItem, string>;
  omdbEpisodesCache!: Table<OmdbEpisodeVotesCacheItem, string>;

  constructor() {
    super('ShowTrackerDB');
    this.version(2).stores({
      omdbRatingsCache: 'id, imdbId, seasonNumber, updatedAt',
      omdbEpisodesCache: 'imdbId, votes, updatedAt'
    });
  }
}

export const db = new AppDatabase();

/**
 * Purges old cache entries to free up memory (e.g., older than 30 days).
 */
export async function cleanOldCache() {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  try {
    await db.omdbRatingsCache.where('updatedAt').below(thirtyDaysAgo).delete();
    await db.omdbEpisodesCache.where('updatedAt').below(thirtyDaysAgo).delete();
  } catch (err) {
    console.error('Failed to clean old cache:', err);
  }
}
