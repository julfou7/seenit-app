import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ShowDetailView } from '../../src/screens/ShowDetailView';
import { EpisodeDetailModal } from '../../src/screens/EpisodeDetailModal';
import type { Show } from '../../src/types';
import { recommendationControl, seriesSeason, telemetry, useShowsStore } from './mediaDetailRuntime';

/**
 * Fixture SEENIT-UX-019 : la vraie `ShowDetailView` montée avec un modèle de fiche (série façon
 * Breaking Bad, film avec saga et similaires prouvés). Les handlers modifient réellement l'état.
 */
type Kind = 'series' | 'movie' | 'episode' | 'episodeSkeleton';
const seasonsMeta = [1, 2, 3, 4, 5].map(season => ({ season_number: season, episode_count: season === 5 ? 16 : 13, air_date: `${2007 + season}-01-20`, vote_average: [7.9, 8.2, 8.4, 8.6, 8.8][season - 1] }));
const seriesDetails = {
  id: 1396, name: 'Breaking Bad', overview: 'Un professeur de chimie atteint d’un cancer devient fabricant de méthamphétamine pour assurer l’avenir de sa famille.', first_air_date: '2008-01-20', last_air_date: '2013-09-29', status: 'Ended', number_of_seasons: 5, number_of_episodes: 68, vote_average: 8.9, episode_run_time: [47],
  genres: [{ id: 18, name: 'Drame' }, { id: 80, name: 'Crime' }, { id: 10764, name: 'Reality' }], seasons: [{ season_number: 0, episode_count: 9 }, ...seasonsMeta],
  aggregate_credits: { cast: ([['Walter White', 'Bryan Cranston', 62], ['Jesse Pinkman', 'Aaron Paul', 62], ['Saul Goodman', 'Bob Odenkirk', 43], ['Mike Ehrmantraut', 'Jonathan Banks', 28], ['Self', 'Anna Gunn', 62], ['Hank Schrader', 'Dean Norris', 62], ['Marie Schrader', 'Betsy Brandt', 62]] as Array<[string, string, number]>).map(([character, name, count]: [string, string, number], index) => ({ id: 200 + index, name, gender: index === 4 ? 1 : 2, profile_path: null as string | null, roles: [{ character, episode_count: count }], total_episode_count: count })) },
};
const movieDetails = {
  id: 693134, title: 'Dune : Deuxième partie', overview: 'Paul Atréides s’allie aux Fremen pour venger sa famille, et doit choisir entre l’amour et le destin de l’univers.', release_date: '2024-02-27', runtime: 166, vote_average: 8.1,
  genres: [{ id: 878, name: 'Science-fiction' }, { id: 12, name: 'Aventure' }], belongs_to_collection: { id: 726871, name: 'Saga Dune' },
  credits: { cast: [{ id: 1190668, name: 'Timothée Chalamet', character: 'Paul Atréides', profile_path: null }, { id: 505710, name: 'Zendaya', character: 'Chani', profile_path: null }], crew: [{ id: 1001, name: 'Denis Villeneuve', job: 'Director' }] },
};
const library = (kind: Kind): Show | null => kind === 'series'
  ? { id: 'bb', userId: 'fixture', tmdbId: 1396, title: 'Breaking Bad', mediaType: 'tv', status: 'watching', seenEpisodes: [...[1, 2, 3, 4].flatMap(season => Array.from({ length: 13 }, (_, index) => `${season}x${index + 1}`)), ...Array.from({ length: 13 }, (_, index) => `5x${index + 1}`)], episodeRecords: {}, totalEpisodes: 68, createdAt: 0, updatedAt: 0, isArchived: false } as unknown as Show
  : null;

function Harness({ kind }: { kind: Kind }) {
  const [show, setShow] = useState<Show | null>(library(kind));
  const [expandedSeason, setExpandedSeason] = useState<number | null>(kind === 'series' ? 5 : null);
  const [seasonsCache, setSeasonsCache] = useState<Record<number, unknown>>(kind === 'series' ? { 5: seriesSeason(5) } : {});
  const [showMenu, setShowMenu] = useState(false);
  const [isSynopsisExpanded, setIsSynopsisExpanded] = useState(false);
  const [areThemesExpanded, setAreThemesExpanded] = useState(false);
  const [trailerModalVideos, setTrailerModalVideos] = useState<Array<{ site: string; key: string; name: string }> | null>(null);
  const [selectedEpisode, setSelectedEpisode] = useState<{ season: number; episode: { episode_number: number } } | null>(null);
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);
  const seen = show?.seenEpisodes || [];
  const isSeries = kind === 'series';
  const hasSeenMedia = isSeries ? seen.length > 0 : seen.includes('movie');
  const nextNumber = isSeries ? Array.from({ length: 16 }, (_, index) => index + 1).find(episode => !seen.includes(`5x${episode}`)) : undefined;
  const nextEp = isSeries && nextNumber ? { season_number: 5, episode_number: nextNumber, name: seriesSeason(5).episodes[nextNumber - 1].name, runtime: 47 } : null;
  const toggleKey = (key: string) => setShow(current => current ? { ...current, seenEpisodes: current.seenEpisodes.includes(key) ? current.seenEpisodes.filter(value => value !== key) : [...current.seenEpisodes, key] } : current);
  const model = {
    nextEp, handleShare: async () => { telemetry.opens.push('share'); }, areThemesExpanded, setAreThemesExpanded, backdropUrl: isSeries ? 'https://image.tmdb.org/t/p/w780/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg' : 'https://image.tmdb.org/t/p/w780/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg',
    collectionData: isSeries ? null : { parts: [{ id: 438631, title: 'Dune', release_date: '2021-09-15', poster_path: '/qpyaW4xUPeIiYA5ckg5zAZFHvsb.jpg', media_type: 'movie' }, { id: 693134, title: 'Dune : Deuxième partie', release_date: '2024-02-27', poster_path: '/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg', media_type: 'movie' }, { id: 1170608, title: 'Dune : Troisième partie', release_date: '2099-12-18', poster_path: null, media_type: 'movie' }] },
    universeData: isSeries ? { parts: [{ id: 60059, name: 'Better Call Saul', first_air_date: '2015-02-08', poster_path: '/fC2HDm5t0kHl7mTm7jxMR31b7by.jpg', media_type: 'tv', seenitRelationKind: 'univers' }] } : null,
    collectionLoading: false, downloadTargetEpisode: undefined, downloadTargetSeason: undefined, dropShow: () => telemetry.opens.push('drop'), effectiveTmdbId: isSeries ? 1396 : 693134,
    epStatus: isSeries && nextEp ? { isUpcoming: false, label: `Reprendre • S05 | E${String(nextEp.episode_number).padStart(2, '0')}` } : null, expandedSeason,
    followShow: () => setShow(library('series')), handleAnimatedBack: () => telemetry.opens.push('back'), handleDeleteShow: () => telemetry.opens.push('delete'), handleSyncSingle: () => telemetry.opens.push('sync'), handleWatchNextEpisode: () => telemetry.opens.push('next'),
    hasSeenMedia, hasTrailer: true, isDownloadModalOpen, isExiting: false, isRefreshingPlex: false, isSeries, isSyncingSingle: false, isSynopsisExpanded, isUnreleased: false, keywords: ['chimie', 'cartel', 'nouveau-mexique'],
    loadSeason: async (season: number) => { setExpandedSeason(season); setSeasonsCache(cache => ({ ...cache, [season]: seriesSeason(season) })); },
    mainScrollRef: { current: null }, onShowClick: (id: number, type: string) => telemetry.opens.push(`show:${type}:${id}`), openEpisodeModal: (season: number, episode: { episode_number: number }) => { telemetry.opens.push(`episode:${season}x${episode.episode_number}`); setSelectedEpisode({ season, episode }); },
    openPersonModal: (id: number) => telemetry.opens.push(`person:${id}`), plexMediaInfo: { available: true, serverName: 'Julien-NAS' }, posterPath: null,
    providers: { link: 'https://www.themoviedb.org', flatrate: [] }, ratingInfo: { label: '16+', provenance: 'TV-MA · US', colorClass: '' }, refreshPlexAvailability: async () => telemetry.opens.push('refresh-plex'), releaseYear: isSeries ? '2008' : '2024',
    remainingTimeMinutes: (68 - seen.length) * 47, requestedMediaKey: isSeries ? 'tv:1396' : 'movie:693134', resumeShow: () => telemetry.opens.push('resume'), rewatchShow: () => telemetry.opens.push('rewatch'), seasonsCache, seenCount: isSeries ? seen.length : hasSeenMedia ? 1 : 0,
    selectedEpisode, selectedPersonId: null, setDownloadTargetEpisode: () => {}, setDownloadTargetSeason: () => {}, setIsDownloadModalOpen, setIsSynopsisExpanded, setSeasonsCache, setSelectedEpisode, setSelectedPersonId: () => {}, setShowMenu, setTrailerModalVideos,
    show, showMenu, showToast: (message: string) => telemetry.opens.push(`toast:${message}`),
    presence: { loading: false, hasFile: false, seasonsHasFile: {}, episodesHasFile: {}, lastChecked: 0 }, getEpisodeDownload: () => null,
    sortedProviders: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg' }, { provider_id: 999999, provider_name: 'Plex (Julien-NAS)', isPlex: true, serverName: 'Julien-NAS' }],
    title: isSeries ? 'Breaking Bad' : 'Dune : Deuxième partie', tmdbDetails: isSeries ? seriesDetails : movieDetails,
    toggleEpisodeSeen: (event: { stopPropagation: () => void }, season: number, episode: number) => { event.stopPropagation(); toggleKey(`${season}x${episode}`); },
    toggleFavorite: () => setShow(current => current ? { ...current, isFavorite: !current.isFavorite } : current),
    toggleMovieSeen: () => setShow(current => current?.seenEpisodes?.includes('movie') ? { ...current, seenEpisodes: [], status: 'plan_to_watch' } : { ...(current || { id: 'dune2', userId: 'fixture', tmdbId: 693134, title: 'Dune', mediaType: 'movie', episodeRecords: {}, createdAt: 0, updatedAt: 0 }), seenEpisodes: ['movie'], status: 'completed' } as Show),
    togglePlanToWatchMovie: () => setShow(current => current ? null : { id: 'dune2', userId: 'fixture', tmdbId: 693134, title: 'Dune', mediaType: 'movie', status: 'plan_to_watch', seenEpisodes: [], episodeRecords: {}, createdAt: 0, updatedAt: 0 } as unknown as Show),
    toggleSeasonSeen: (event: { stopPropagation: () => void }, season: number, count: number) => { event.stopPropagation(); setShow(current => { if (!current) return current; const keys = Array.from({ length: count }, (_, index) => `${season}x${index + 1}`); const all = keys.every(key => current.seenEpisodes.includes(key)); return { ...current, seenEpisodes: all ? current.seenEpisodes.filter(key => !keys.includes(key)) : [...new Set([...current.seenEpisodes, ...keys])] }; }); },
    totalEpisodes: isSeries ? 68 : 1, trailerModalVideos, userPlatforms: [8], ytVideos: [{ site: 'YouTube', key: 'trailer', name: 'Bande-annonce' }],
  };
  return <div className="max-w-md mx-auto h-[100dvh] flex flex-col"><ShowDetailView model={model} /></div>;
}

let root: ReturnType<typeof createRoot> | null = null;
const mediaDetail = {
  telemetry,
  mount(kind: Kind) {
    useShowsStore.setState({ shows: [{ id: 'dune1', tmdbId: 438631, mediaType: 'movie', status: 'completed', seenEpisodes: ['movie'] } as unknown as Show] });
    recommendationControl.results = [{ id: 335984, title: 'Blade Runner 2049', poster_path: '/gajva2L0rPYkEWjzgFlBXCAVBE5.jpg', genre_ids: [878] }, { id: 157336, title: 'Interstellar', poster_path: '/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg', genre_ids: [878, 12] }, { id: 872585, title: 'Oppenheimer', poster_path: '/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg', genre_ids: [18] }];
    recommendationControl.directorCredits = { crew: [{ id: 335984, job: 'Director', title: 'Blade Runner 2049', release_date: '2017-10-04', poster_path: '/gajva2L0rPYkEWjzgFlBXCAVBE5.jpg', popularity: 50 }, { id: 329865, job: 'Director', title: 'Premier Contact', release_date: '2016-11-10', poster_path: '/x2FJsf1ElAgr63Y3PNPtJrcmpoe.jpg', popularity: 40 }] };
    recommendationControl.actorCredits = { 1190668: { cast: [{ id: 157336 }] } };
    if (!root) root = createRoot(document.getElementById('root')!);
    if (kind === 'episodeSkeleton') {
      // #857 : fiche épisode pendant son hydratation (squelette au gabarit actuel).
      useShowsStore.setState({ shows: [library('series')!] });
      root.render(<EpisodeDetailModal key="skeleton" isHydrating show={library('series')!} season={5} episode={{ episode_number: 14 }} tmdbShowTitle="Breaking Bad" tmdbShowId={1396} onClose={() => telemetry.opens.push('close')} onShowClick={() => telemetry.opens.push('series')} />);
      return;
    }
    if (kind === 'episode') {
      useShowsStore.setState({ shows: [library('series')!] });
      const season = seriesSeason(5);
      root.render(<EpisodeDetailModal key="episode" show={library('series')!} season={5} episode={season.episodes[13]} tmdbShowTitle="Breaking Bad" tmdbShowId={1396} onClose={() => telemetry.opens.push('close')} onShowClick={() => telemetry.opens.push('series')} onLoadSeason={async (number: number) => number >= 1 && number <= 5 ? seriesSeason(number) : null} />);
      return;
    }
    root.render(<Harness key={kind} kind={kind} />);
  },
};
(window as unknown as { __mediaDetail: typeof mediaDetail }).__mediaDetail = mediaDetail;
