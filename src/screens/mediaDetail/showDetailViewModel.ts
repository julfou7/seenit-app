import type React from 'react';
import type { Show } from '../../types';
import type { WhereToWatchProvider } from './detailUi';
import type { TrailerVideo } from '../../features/trailers/trailerPolicy';
import type { MediaPresenceData } from '../../store/mediaPresenceStore';
import type { LiveDownloadItem } from '../../services/sonarrRadarr';

/**
 * Modèle passé par ShowDetailScreenCore à ShowDetailView (SEENIT-UX-019), typé champ par champ pour que
 * la vue ne dépende plus d'un `any`. Les réponses TMDB restent ouvertes : seuls les champs lus sont décrits.
 */
type Season = { season_number: number; episode_count: number; air_date?: string | null; vote_average?: number; name?: string };
type Episode = { id?: number; episode_number: number; name?: string; still_path?: string | null; air_date?: string | null; runtime?: number | null; vote_average?: number; [key: string]: unknown };
type CastMember = { id: number; name: string; gender?: number | null; profile_path?: string | null; character?: string; roles?: Array<{ character?: string; episode_count?: number }>; total_episode_count?: number; episode_count?: number };
type RelationPart = { id: number; title?: string; name?: string; poster_path?: string | null; release_date?: string; first_air_date?: string; media_type?: string; seenitRelationKind?: string };
export type SeasonCacheEntry = { episodes?: Episode[]; videos?: { results?: Video[] } };
type Video = TrailerVideo;

export interface ShowDetailTmdb {
  id: number;
  name?: string; title?: string; original_title?: string; original_name?: string; overview?: string;
  first_air_date?: string; release_date?: string; last_air_date?: string; status?: string;
  number_of_seasons?: number; number_of_episodes?: number; vote_average?: number; runtime?: number; episode_run_time?: number[];
  genres?: Array<{ id: number; name: string }>; seasons?: Season[]; imdb_id?: string; poster_path?: string | null;
  credits?: { cast?: CastMember[]; crew?: Array<{ id: number; name: string; job?: string }> };
  aggregate_credits?: { cast?: CastMember[] };
  external_ids?: { tvdb_id?: number | string; imdb_id?: string };
  belongs_to_collection?: { id?: number; name?: string } | null;
}

export interface ShowDetailViewModel {
  /** Le cœur passe aussi des champs que la vue n'utilise plus (onglets historiques). */
  [key: string]: unknown;
  areThemesExpanded: boolean; setAreThemesExpanded: (update: (expanded: boolean) => boolean) => void;
  backdropUrl?: string; posterPath?: string; title: string; releaseYear?: string | number | null;
  collectionData: { parts: RelationPart[] } | null; universeData: { parts: RelationPart[] } | null; collectionLoading: boolean;
  downloadTargetEpisode?: number; downloadTargetSeason?: number;
  setDownloadTargetEpisode: (value: number | undefined) => void; setDownloadTargetSeason: (value: number | undefined) => void;
  presence: MediaPresenceData;
  getEpisodeDownload: (tmdbId?: number | string, tvdbId?: number | string, season?: number, episode?: number) => LiveDownloadItem | null;
  /** #879 — Garde partagée avec la popup : une demande est-elle déjà active dans ce périmètre ? */
  hasActiveDownloadInScope?: (scope: { mediaType: 'movie' | 'tv'; tmdbId: number; seasonNumber?: number; episodeNumber?: number }) => boolean;
  isDownloadModalOpen: boolean; setIsDownloadModalOpen: (open: boolean) => void;
  dropShow: () => unknown; followShow: () => unknown; resumeShow: () => unknown; rewatchShow: () => unknown;
  handleAnimatedBack: () => void; handleDeleteShow: () => unknown; handleShare: () => Promise<unknown> | unknown; handleSyncSingle: () => unknown; handleWatchNextEpisode: () => void;
  effectiveTmdbId?: number | null; requestedMediaKey: string | null;
  epStatus: { isUpcoming: boolean; label: string } | null;
  nextEp: { season_number: number; episode_number: number; name?: string | null; runtime?: number | null } | null;
  expandedSeason: number | null; loadSeason: (season: number) => unknown;
  seasonsCache: Record<number, SeasonCacheEntry>; setSeasonsCache: (update: (previous: Record<number, SeasonCacheEntry>) => Record<number, SeasonCacheEntry>) => void;
  hasSeenMedia?: boolean; hasTrailer: boolean; ytVideos: Video[];
  isExiting: boolean; isRefreshingPlex: boolean; isSeries: boolean; isSyncingSingle: boolean; isSynopsisExpanded: boolean; isUnreleased: boolean;
  setIsSynopsisExpanded: (expanded: boolean) => void;
  keywords: string[]; mainScrollRef: React.RefObject<HTMLDivElement | null>;
  onShowClick?: (tmdbId: number, mediaType: 'tv' | 'movie') => void;
  openEpisodeModal: (season: number, episode: Episode) => void; openPersonModal: (personId: number) => void;
  plexMediaInfo: unknown; providers: { link?: string } | null; sortedProviders: WhereToWatchProvider[]; userPlatforms: number[];
  ratingInfo: { label: string; provenance: string | null; colorClass: string };
  refreshPlexAvailability: () => unknown;
  remainingTimeMinutes: number; seenCount: number; totalEpisodes: number;
  selectedEpisode: { season: number; episode: Episode } | null; setSelectedEpisode: (value: null) => void;
  selectedPersonId: number | null; setSelectedPersonId: (value: null) => void;
  setShowMenu: (open: boolean) => void; showMenu: boolean;
  setTrailerModalVideos: (videos: Video[] | null) => void; trailerModalVideos: Video[] | null;
  show: Show | null | undefined; showToast: (message: string, tone?: string, show?: Show) => unknown;
  tmdbDetails: ShowDetailTmdb | null;
  toggleEpisodeSeen: (event: React.MouseEvent, season: number, episode: number) => unknown;
  toggleFavorite: () => unknown; toggleMovieSeen: () => unknown; togglePlanToWatchMovie: () => unknown;
  toggleSeasonSeen: (event: React.MouseEvent, season: number, count: number) => unknown;
}
