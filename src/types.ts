export interface ImportTask {
  id?: string;
  rawTitle: string;
  mediaType: 'tv' | 'movie';
  seenEpisodes?: string[];
  status: 'pending' | 'done' | 'failed';
  createdAt: number;
  error?: string;
}

export interface Show {
  id: string; // Document ID from Firestore
  userId: string;
  tmdbId: number;
  title: string;
  originalTitle?: string;
  mediaType: 'tv' | 'movie';
  posterPath: string | null;
  backdropPath: string | null;
  status: 'watching' | 'completed' | 'plan_to_watch' | 'dropped';
  isArchived: boolean;
  isFavorite?: boolean;
  notificationsEnabled?: boolean;
  updatedAt: number;
  createdAt: number;
  seenEpisodes: string[];
  episodeRecords: Record<string, { rating?: number; emotion?: string; watchedAt?: number; [key: string]: any }>;
  detailsSyncedAt?: number;
  isSynced?: boolean;
  lastSyncedAt?: number;
  lastWatchedAt?: number;
  totalEpisodes?: number;
  totalAiredEpisodes?: number;
  firstAirDate?: string;
  seasonsCache?: any[]; // Deprecated, kept only to clean it up from Firestore
  nextEpisodeToAir?: any;
  nextEpisodeToWatch?: any;
  networks?: any[];
  userRating?: number;
  seriesEnded?: boolean;
  tmdbStatus?: string;
}
