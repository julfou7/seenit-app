import React, { useState, useEffect, useRef, useMemo } from 'react';
import { type Show } from '../types';
import { tmdb, isMovieAtCinema, isMovieUpcoming } from '../features/shows/tmdb';
import { ChevronLeft, Star, Heart, CheckCircle2, Circle, Tv, Zap, X, EyeOff, Archive, Trash2, MoreVertical, Plus, Check, Share, Share2, Play, Calendar, ArchiveRestore, Ban, RotateCcw, MonitorPlay, Ticket, Youtube, Clapperboard, ExternalLink, Clock, RefreshCw, Download } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { cn, computeAutoArchiveStatus, formatAirDateSafe, formatVoteCount, getBestLogoPath, getTodayStr, getCalendarDaysDiff, getEpisodeRelativeAirDate, scrollAllCarouselsToStart, openExternalUrl, checkIsUpToDate } from '../lib/utils';
import { EpisodeDetailModal } from './EpisodeDetailModal';
import { MediaDetailColdShell } from './MediaDetailColdShell';
import { PersonDetailModal } from './PersonDetailModal';
import { TimelineMediaCard } from '../components/cards/TimelineMediaCard';
import { EpisodeRatingsChart } from '../components/EpisodeRatingsChart';
import { useShows } from '../hooks/useShows';
import { useToastStore } from '../store/toastStore';
import { syncSingleItem } from '../hooks/useDetailsSyncWorker';
import { auth, db } from '../lib/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { TrailerModal } from '../components/TrailerModal';
import { DownloadModal } from '../components/DownloadModal';
import { useShowsStore } from '../store/showsStore';
import { getFormattedProviderLogo, PLEX_LOGO_SVG } from '../utils/providerLogos';
import { openPlexWatchUrl } from '../features/plex/syncPlex';
import { useMediaPresence } from '../hooks/useMediaPresence';
import { RedditSection } from '../components/community/RedditSection';
import { useLiveDownloadStore } from '../store/liveDownloadStore';
import { LiveDownloadBanner } from '../components/LiveDownloadBanner';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { useMediaPresenceStore } from '../store/mediaPresenceStore';
import { searchAndDownloadInSonarr, searchAndDownloadInRadarr } from '../services/sonarrRadarr';
import { downloadEpisodeWithSeasonPackFallback } from '../features/downloads/episodeSeasonPackFallback';
import { acceptDownloadRequest, beginDownloadRequest, failDownloadRequest, updateDownloadRequest } from '../features/downloads/downloadLifecycle';
import { readUserScopedJson } from '../lib/userIsolation';
import { mediaKeyFrom, toMediaKey } from '../features/shows/mediaRelations';
import { buildMediaShareUrl } from '../features/navigation/mediaShareUrl';
import { getParentalRatingColorClass, resolveParentalRating } from '../features/shows/parentalRating';
import {
  type ShowDetailScreenProps,
  getCleanProviderName,
  getEpisodeAirDateLabel,
  getKeywordsFromDetails,
  getProviderDirectLink,
  getSeasonReleaseDateText,
  getSmartDefaultSeason,
} from './showDetailPresentation';
import { ShowDetailView } from './ShowDetailView';

export function ShowDetailScreen({ showId, tmdbId: externalTmdbId, mediaType: externalMediaType, initialSeason, initialEpisode, onBack, onShowClick }: ShowDetailScreenProps) {
  const { shows, addShow, updateShow, deleteShow } = useShows();
  const { showToast } = useToastStore();
  const show = shows.find(s =>
    (showId && (String(s.id) === String(showId) || String(s.tmdbId) === String(showId))) ||
    (externalTmdbId && String(s.tmdbId) === String(externalTmdbId))
  );

  const lastKnownShowRef = useRef<any>(show);
  if (show) lastKnownShowRef.current = show;

  const persistentTmdbIdRef = useRef<number | undefined>(
    externalTmdbId ? Number(externalTmdbId) : (show?.tmdbId ? Number(show.tmdbId) : (showId && !isNaN(Number(showId)) ? Number(showId) : undefined))
  );
  if (!persistentTmdbIdRef.current) {
    if (externalTmdbId) persistentTmdbIdRef.current = Number(externalTmdbId);
    else if (show?.tmdbId) persistentTmdbIdRef.current = Number(show.tmdbId);
    else if (showId && !isNaN(Number(showId))) persistentTmdbIdRef.current = Number(showId);
  }

  const effectiveTmdbId = show?.tmdbId || (externalTmdbId ? Number(externalTmdbId) : undefined) || persistentTmdbIdRef.current;
  const requestedMediaType: 'tv' | 'movie' = show?.mediaType === 'movie' || externalMediaType === 'movie' ? 'movie' : 'tv';
  const requestedMediaKey = effectiveTmdbId ? toMediaKey(requestedMediaType, Number(effectiveTmdbId)) : null;
  const cachedInitialDetails = effectiveTmdbId ? tmdb.peekRenderableMediaDetails(Number(effectiveTmdbId), requestedMediaType) : null;
  const cachedInitialRelations = effectiveTmdbId
    ? tmdb.peekUniverseAndCollection({ ...(cachedInitialDetails || {}), id: Number(effectiveTmdbId), media_type: requestedMediaType })
    : null;

  const [tmdbDetails, setTmdbDetails] = useState<any>(cachedInitialDetails);
  const title = show?.title || tmdbDetails?.name || tmdbDetails?.title || 'Chargement...';
  const isSeries = requestedMediaType === 'tv';
  const releaseDateStr = isSeries ? (tmdbDetails?.first_air_date || (show as any)?.first_air_date) : (tmdbDetails?.release_date || (show as any)?.release_date);
  const releaseYear = releaseDateStr ? releaseDateStr.slice(0, 4) : undefined;
  const isUnreleased = releaseDateStr ? new Date(releaseDateStr).getTime() > Date.now() : false;

  const [fetchError, setFetchError] = useState<boolean>(false);
  const [collectionData, setCollectionData] = useState<any>(cachedInitialRelations?.collection?.length ? { parts: cachedInitialRelations.collection } : null);
  const [universeData, setUniverseData] = useState<any>(cachedInitialRelations?.universe?.length ? { parts: cachedInitialRelations.universe } : null);
  const [collectionLoading, setCollectionLoading] = useState<boolean>(() =>
    effectiveTmdbId
      ? tmdb.shouldLoadUniverseAndCollection({ ...(cachedInitialDetails || {}), id: Number(effectiveTmdbId), media_type: requestedMediaType })
      : false
  );
  const [providers, setProviders] = useState<any>(() => {
    if (!effectiveTmdbId) return null;
    return tmdb.peekWatchProviders(Number(effectiveTmdbId), requestedMediaType)?.results?.FR || null;
  });
  const [keywords, setKeywords] = useState<string[]>(getKeywordsFromDetails(cachedInitialDetails, requestedMediaType));
  const [activeTab, setActiveTab] = useState<'about' | 'episodes' | 'casting'>('about');
  const [seasonsCache, setSeasonsCache] = useState<Record<number, any>>({});
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null);
  const [selectedEpisode, setSelectedEpisode] = useState<{season: number, episode: any} | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<number | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [isSynopsisExpanded, setIsSynopsisExpanded] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const [posterError, setPosterError] = useState(false);
  const [isSyncingSingle, setIsSyncingSingle] = useState(false);
  const [isRefreshingPlex, setIsRefreshingPlex] = useState(false);
  const [isDownloadMode, setIsDownloadMode] = useState(false);
  const [is1ClickDownloading, setIs1ClickDownloading] = useState<Record<string, boolean>>({});
  const [areThemesExpanded, setAreThemesExpanded] = useState(false);

  const handle1ClickDownloadEpisode = async (e: React.MouseEvent, seasonNumber: number, episodeNumber: number) => {
    e.stopPropagation();
    const config = useDownloadConfigStore.getState();
    if (!config.sonarrUrl || !config.sonarrApiKey) {
      showToast("Configurez Sonarr dans les paramètres pour le téléchargement 1-clic", "error");
      setDownloadTargetSeason(seasonNumber);
      setDownloadTargetEpisode(episodeNumber);
      setIsDownloadModalOpen(true);
      return;
    }
    const epKey = `S${seasonNumber}E${episodeNumber}`;
    setIs1ClickDownloading(prev => ({ ...prev, [epKey]: true }));
    const showTitle = show?.title || tmdbDetails?.name || tmdbDetails?.original_name || 'Série';
    const tvdbId = tmdbDetails?.external_ids?.tvdb_id || (show as any)?.tvdbId;
    const imdbId = tmdbDetails?.external_ids?.imdb_id || (show as any)?.imdbId;
    const posterForDownload = tmdbDetails?.poster_path || show?.posterPath || undefined;
    const backdropForDownload = tmdbDetails?.backdrop_path || show?.backdropPath || undefined;
    const code = `S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`;
    const requestId = beginDownloadRequest({
      title: `${showTitle} (${code})`, seriesTitle: showTitle, mediaType: 'tv', tmdbId: effectiveTmdbId, tvdbId, imdbId,
      seasonNumber, episodeNumber, posterPath: posterForDownload, backdropPath: backdropForDownload,
      downloadClient: 'Sonarr', statusText: 'Préparation du téléchargement…', releaseTitle: `${showTitle} • ${code} • 1080p`
    });
    try {
      const res = await downloadEpisodeWithSeasonPackFallback({
        url: config.sonarrUrl, apiKey: config.sonarrApiKey, title: showTitle, tmdbId: effectiveTmdbId, tvdbId, imdbId,
        season: seasonNumber, episode: episodeNumber, qualityPreference: '1080p', qbittorrentUrl: config.qbittorrentUrl,
        qbittorrentUsername: config.qbittorrentUsername, qbittorrentPassword: config.qbittorrentPassword
      });
      if (res.success) {
        const nextStatus = res.status || 'searching';
        const statusText = res.message || `${code} envoyé à Sonarr`;
        acceptDownloadRequest(requestId, statusText, nextStatus);
        if (res.downloadId) updateDownloadRequest(requestId, { downloadId: res.downloadId, downloadIdAliases: [res.downloadId], statusText });
        showToast(res.fallbackUsed ? statusText : `Téléchargement de ${code} lancé dans Sonarr !`, 'success');
        useLiveDownloadStore.getState().startPolling(1000);
        void useLiveDownloadStore.getState().fetchDownloads();
      } else {
        failDownloadRequest(requestId, res.message);
        showToast(res.message || "Erreur lors du lancement dans Sonarr", "error");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erreur réseau Sonarr";
      failDownloadRequest(requestId, message);
      showToast(message, "error");
    } finally {
      setIs1ClickDownloading(prev => ({ ...prev, [epKey]: false }));
    }
  };

  const handle1ClickDownloadSeason = async (e: React.MouseEvent, seasonNumber: number) => {
    e.stopPropagation();
    const config = useDownloadConfigStore.getState();
    if (!config.sonarrUrl || !config.sonarrApiKey) {
      showToast("Configurez Sonarr dans les paramètres pour le téléchargement 1-clic", "error");
      setDownloadTargetSeason(seasonNumber);
      setDownloadTargetEpisode(undefined);
      setIsDownloadModalOpen(true);
      return;
    }
    const seasonKey = `S${seasonNumber}`;
    setIs1ClickDownloading(prev => ({ ...prev, [seasonKey]: true }));
    const showTitle = show?.title || tmdbDetails?.name || tmdbDetails?.original_name || 'Série';
    const tvdbId = tmdbDetails?.external_ids?.tvdb_id || (show as any)?.tvdbId;
    const posterForDownload = tmdbDetails?.poster_path || show?.posterPath || undefined;
    const backdropForDownload = tmdbDetails?.backdrop_path || show?.backdropPath || undefined;
    useLiveDownloadStore.getState().addOptimisticDownload({
      mediaType: 'tv', title: `${showTitle} (Saison ${seasonNumber})`, seriesTitle: showTitle, tmdbId: effectiveTmdbId, tvdbId,
      seasonNumber, posterPath: posterForDownload, backdropPath: backdropForDownload, downloadClient: 'Sonarr', statusText: 'Préparation du téléchargement…'
    });
    try {
      const res = await searchAndDownloadInSonarr({ url: config.sonarrUrl, apiKey: config.sonarrApiKey, title: showTitle, tmdbId: effectiveTmdbId, tvdbId, season: seasonNumber, qualityPreference: '1080p' });
      if (res.success) {
        showToast(`Téléchargement de la Saison ${seasonNumber} lancé dans Sonarr !`, 'success');
        useLiveDownloadStore.getState().startPolling(1000);
        useLiveDownloadStore.getState().fetchDownloads();
      } else showToast(res.message || "Erreur lors du lancement de la saison", "error");
    } catch (err: any) {
      showToast(err?.message || "Erreur réseau Sonarr", "error");
    } finally {
      setIs1ClickDownloading(prev => ({ ...prev, [seasonKey]: false }));
    }
  };

  const handle1ClickDownloadMovie = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const config = useDownloadConfigStore.getState();
    if (!config.radarrUrl || !config.radarrApiKey) {
      showToast("Configurez Radarr dans les paramètres pour le téléchargement 1-clic", "error");
      setIsDownloadModalOpen(true);
      return;
    }
    const movieTitle = show?.title || tmdbDetails?.title || tmdbDetails?.original_title || 'Film';
    const movieYear = releaseYear ? parseInt(releaseYear, 10) : undefined;
    const imdbId = tmdbDetails?.external_ids?.imdb_id;
    const posterForDownload = tmdbDetails?.poster_path || show?.posterPath || undefined;
    const backdropForDownload = tmdbDetails?.backdrop_path || show?.backdropPath || undefined;
    setIs1ClickDownloading(prev => ({ ...prev, movie: true }));
    useLiveDownloadStore.getState().addOptimisticDownload({
      mediaType: 'movie', title: movieTitle, movieTitle, tmdbId: effectiveTmdbId, posterPath: posterForDownload,
      backdropPath: backdropForDownload, downloadClient: 'Radarr', statusText: 'Préparation du téléchargement…'
    });
    try {
      const res = await searchAndDownloadInRadarr({ url: config.radarrUrl, apiKey: config.radarrApiKey, title: movieTitle, tmdbId: effectiveTmdbId, year: movieYear, imdbId, qualityPreference: '1080p' });
      if (res.success) {
        showToast(`Téléchargement de « ${movieTitle} » lancé dans Radarr !`, 'success');
        useLiveDownloadStore.getState().startPolling(1000);
        useLiveDownloadStore.getState().fetchDownloads();
      } else showToast(res.message || "Erreur lors du lancement dans Radarr", "error");
    } catch (err: any) {
      showToast(err?.message || "Erreur réseau Radarr", "error");
    } finally {
      setIs1ClickDownloading(prev => ({ ...prev, movie: false }));
    }
  };

  const handleSyncSingle = async () => {
    if (!show?.id) {
      showToast("L'élément doit d'abord être ajouté à votre suivi.", "info");
      return;
    }
    setIsSyncingSingle(true);
    showToast(`Synchronisation de ${isSeries ? 'la série' : 'du film'}...`, "info");
    try {
      const res = await syncSingleItem(show.id);
      if (res.success) showToast(`« ${show.title} » a été synchronisé(e) avec succès !`, "success");
      else showToast(`Erreur : ${res.error || 'Échec de la synchronisation'}`, "error");
    } catch (err) {
      console.error(err);
      showToast("Erreur lors de la synchronisation", "error");
    } finally {
      setIsSyncingSingle(false);
    }
  };

  const [visibleSeasons, setVisibleSeasons] = useState(5);
  const [visibleCast, setVisibleCast] = useState(12);
  const [showAllCast, setShowAllCast] = useState(false);
  const [trailerModalVideos, setTrailerModalVideos] = useState<any[] | null>(null);
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);
  const [downloadTargetSeason, setDownloadTargetSeason] = useState<number | undefined>(undefined);
  const [downloadTargetEpisode, setDownloadTargetEpisode] = useState<number | undefined>(undefined);
  const { getShowDownloads, getMovieDownload, getEpisodeDownload } = useLiveDownloadStore();
  const mediaDownloads = isSeries
    ? getShowDownloads(effectiveTmdbId, tmdbDetails?.external_ids?.tvdb_id || (show as any)?.tvdbId, tmdbDetails?.name || show?.title)
    : (getMovieDownload(effectiveTmdbId, tmdbDetails?.title || show?.title) ? [getMovieDownload(effectiveTmdbId, tmdbDetails?.title || show?.title)!] : []);
  const hasActiveDownload = mediaDownloads.some(item => item.status !== 'completed' && item.status !== 'cancelled' && item.status !== 'error' && Number(item.progress || 0) < 100);
  const hasCompletedDownload = mediaDownloads.some(item => item.status === 'completed' || Number(item.progress || 0) >= 100);
  const hasCancelledDownload = !hasActiveDownload && !hasCompletedDownload && mediaDownloads.some(item => item.status === 'cancelled');
  const hasDownloadError = !hasActiveDownload && !hasCompletedDownload && !hasCancelledDownload && mediaDownloads.some(item => item.status === 'error' || Boolean(item.errorMessage));
  const showDownloadSummary = hasActiveDownload || hasCancelledDownload || hasDownloadError || (!isSeries && hasCompletedDownload);

  const presence = useMediaPresence({
    tmdbId: effectiveTmdbId,
    tvdbId: tmdbDetails?.external_ids?.tvdb_id || (show as any)?.tvdbId,
    imdbId: tmdbDetails?.external_ids?.imdb_id || (show as any)?.imdbId,
    title,
    originalTitle: tmdbDetails?.original_title || tmdbDetails?.original_name || (show as any)?.originalTitle,
    year: releaseYear ? parseInt(releaseYear) : undefined,
    mediaType: isSeries ? 'tv' : 'movie'
  });
  const plexMediaInfo = presence.plexInfo || null;

  const refreshPlexAvailability = async () => {
    if (!effectiveTmdbId || isRefreshingPlex) return;
    setIsRefreshingPlex(true);
    try {
      await useMediaPresenceStore.getState().checkPresence({
        tmdbId: effectiveTmdbId,
        tvdbId: tmdbDetails?.external_ids?.tvdb_id || (show as any)?.tvdbId,
        imdbId: tmdbDetails?.external_ids?.imdb_id || tmdbDetails?.imdb_id || (show as any)?.imdbId,
        title,
        originalTitle: tmdbDetails?.original_title || tmdbDetails?.original_name || (show as any)?.originalTitle,
        year: releaseYear ? parseInt(releaseYear, 10) : undefined,
        mediaType: isSeries ? 'tv' : 'movie',
        forceRefresh: true,
        refreshPlexServers: true,
      });
    } finally {
      setIsRefreshingPlex(false);
    }
  };

  useEffect(() => {
    if (!hasCompletedDownload || hasActiveDownload || !effectiveTmdbId || plexMediaInfo?.available) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const refreshPresenceAfterImport = async () => {
      attempts += 1;
      const refreshed = await useMediaPresenceStore.getState().checkPresence({
        tmdbId: effectiveTmdbId,
        tvdbId: tmdbDetails?.external_ids?.tvdb_id || (show as any)?.tvdbId,
        imdbId: tmdbDetails?.external_ids?.imdb_id || (show as any)?.imdbId,
        title,
        originalTitle: tmdbDetails?.original_title || tmdbDetails?.original_name || (show as any)?.originalTitle,
        year: releaseYear ? parseInt(releaseYear) : undefined,
        mediaType: isSeries ? 'tv' : 'movie',
        forceRefresh: true
      });
      if (!cancelled && !refreshed.plexInfo?.available && attempts < 4) retryTimer = setTimeout(() => void refreshPresenceAfterImport(), 4000);
    };
    void refreshPresenceAfterImport();
    return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer); };
  }, [hasCompletedDownload, hasActiveDownload, effectiveTmdbId, isSeries, title, releaseYear, tmdbDetails?.external_ids?.tvdb_id, tmdbDetails?.external_ids?.imdb_id, tmdbDetails?.original_title, tmdbDetails?.original_name, show, plexMediaInfo?.available]);

  const openEpisodeModal = (seasonNum: number, ep: any) => {
    setSelectedEpisode({ season: seasonNum, episode: ep });
    const currentState = window.history.state || {};
    window.history.pushState({ ...currentState, isModal: true, isEpisodeDetailModal: true }, '');
  };
  const openPersonModal = (personId: number) => {
    setSelectedPersonId(personId);
    const currentState = window.history.state || {};
    window.history.pushState({ ...currentState, isModal: true, isPersonDetailModal: true, personId }, '');
  };

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (!event.state || !event.state.isEpisodeDetailModal) setSelectedEpisode(null);
      if (event.state && event.state.isPersonDetailModal && event.state.personId) setSelectedPersonId(event.state.personId);
      else if (!event.state || !event.state.isPersonDetailModal) setSelectedPersonId(null);
    };
    const handleCloseModals = () => setTrailerModalVideos(null);
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('app-close-modals', handleCloseModals);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('app-close-modals', handleCloseModals);
    };
  }, []);

  const mainScrollRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const tabsAnchorRef = useRef<HTMLDivElement>(null);
  const isManualScrollingRef = useRef(false);
  const [isExiting, setIsExiting] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [userPlatforms, setUserPlatforms] = useState<number[]>([]);

  useEffect(() => {
    const handleStorage = () => setUserPlatforms(readUserScopedJson<number[]>(auth.currentUser?.uid, 'platforms', []));
    handleStorage();
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const uniqueProviders = useMemo(() => {
    if (!providers) return [];
    const allList = [...(providers.flatrate || []), ...(providers.ads || []), ...(providers.free || [])];
    const uniqueMap = new Map();
    allList.forEach((p: any) => {
      const cleanName = getCleanProviderName(p);
      const key = cleanName.toLowerCase().trim();
      if (!uniqueMap.has(key)) uniqueMap.set(key, { ...p, provider_name: cleanName });
    });
    return Array.from(uniqueMap.values());
  }, [providers]);

  const sortedProviders = useMemo(() => {
    const list: any[] = [...uniqueProviders];
    if (plexMediaInfo?.available) {
      list.push({ provider_id: 999999, provider_name: plexMediaInfo.serverName ? `Plex (${plexMediaInfo.serverName})` : 'Plex', logo_path: 'PLEX_CUSTOM_SVG', isPlex: true, serverName: plexMediaInfo.serverName, plexUrl: plexMediaInfo.plexUrl, watchUrl: plexMediaInfo.watchUrl });
    }
    return list.sort((a: any, b: any) => {
      if (a.isPlex && !b.isPlex) return 1;
      if (!a.isPlex && b.isPlex) return -1;
      const aHas = userPlatforms.includes(a.provider_id);
      const bHas = userPlatforms.includes(b.provider_id);
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      return 0;
    });
  }, [uniqueProviders, plexMediaInfo, userPlatforms]);

  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);
  const isEdgeSwipeRef = useRef<boolean>(false);
  const isHorizontalSwipeRef = useRef<boolean | null>(null);
  const handleAnimatedBack = () => {
    if (isExiting) return;
    setIsExiting(true);
    setTimeout(() => onBack(), 280);
  };
  const handleTouchStart = (e: React.TouchEvent) => {};
  const handleTouchMove = (e: React.TouchEvent) => {};
  const handleTouchEnd = () => {};

  const handleTabChange = (tab: 'about' | 'episodes' | 'casting') => {
    setActiveTab(tab);
    isManualScrollingRef.current = true;
    setTimeout(() => {
      const el = document.getElementById(`section-${tab}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else if (tabsAnchorRef.current) tabsAnchorRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => { isManualScrollingRef.current = false; }, 800);
    }, 50);
  };

  const lastLoadedMediaKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!effectiveTmdbId || !requestedMediaKey) return;
    if (lastLoadedMediaKeyRef.current === requestedMediaKey) return;
    lastLoadedMediaKeyRef.current = requestedMediaKey;
    const cachedDetails = tmdb.peekRenderableMediaDetails(Number(effectiveTmdbId), requestedMediaType);
    const cachedRelations = tmdb.peekUniverseAndCollection({ ...(cachedDetails || {}), id: Number(effectiveTmdbId), media_type: requestedMediaType });
    const cachedProviders = tmdb.peekWatchProviders(Number(effectiveTmdbId), requestedMediaType);
    setTmdbDetails(cachedDetails);
    setFetchError(false);
    setCollectionData(cachedRelations?.collection?.length ? { parts: cachedRelations.collection } : null);
    setUniverseData(cachedRelations?.universe?.length ? { parts: cachedRelations.universe } : null);
    setCollectionLoading(tmdb.shouldLoadUniverseAndCollection({ ...(cachedDetails || {}), id: Number(effectiveTmdbId), media_type: requestedMediaType }));
    setProviders(cachedProviders?.results?.FR || null);
    setKeywords(getKeywordsFromDetails(cachedDetails, requestedMediaType));
    setSeasonsCache({});
    setExpandedSeason(null);
    setSelectedEpisode(null);
    setShowMenu(false);
    setActiveTab('about');
    setLogoError(false);
    setPosterError(false);
    if (mainScrollRef.current) mainScrollRef.current.scrollTo({ top: 0, behavior: 'instant' });
  }, [effectiveTmdbId, requestedMediaKey, requestedMediaType]);

  useEffect(() => {
    if (!effectiveTmdbId || !requestedMediaKey) return;
    let isMounted = true;
    const targetMediaType = requestedMediaType;
    const requestKey = requestedMediaKey;
    const isCurrentRequest = () => isMounted && lastLoadedMediaKeyRef.current === requestKey;
    const fetchDetails = async () => {
      const res = await tmdb.getMediaDetails(Number(effectiveTmdbId), targetMediaType);
      if (!isCurrentRequest()) return;
      if (res.ok) {
        setTmdbDetails(res.value);
        setFetchError(false);
        setKeywords(getKeywordsFromDetails(res.value, targetMediaType));
        setCollectionLoading(tmdb.shouldLoadUniverseAndCollection(res.value));
        tmdb.getUniverseAndCollection(res.value).then(({ collection, universe }) => {
          if (!isCurrentRequest()) return;
          setCollectionData(collection.length > 0 ? { parts: collection } : null);
          setUniverseData(universe.length > 0 ? { parts: universe } : null);
          setCollectionLoading(false);
        }).catch(() => { if (isCurrentRequest()) setCollectionLoading(false); });
      } else {
        setFetchError(true);
        setCollectionLoading(false);
      }
    };
    fetchDetails();
    tmdb.getWatchProviders(Number(effectiveTmdbId), targetMediaType).then(res => {
      if (res.ok && isCurrentRequest()) setProviders(res.value.results?.FR || []);
    });
    return () => { isMounted = false; };
  }, [effectiveTmdbId, requestedMediaKey, requestedMediaType]);

  const initialAutoOpenRef = useRef<boolean>(false);
  useEffect(() => { initialAutoOpenRef.current = false; }, [effectiveTmdbId]);
  useEffect(() => {
    if (!tmdbDetails || !effectiveTmdbId || initialAutoOpenRef.current) return;
    let targetSeason = initialSeason || getSmartDefaultSeason(show, tmdbDetails);
    if (targetSeason) {
      initialAutoOpenRef.current = true;
      setExpandedSeason(targetSeason);
      if (initialSeason && initialEpisode) {
        setActiveTab('episodes');
        if (!seasonsCache[targetSeason]) {
          tmdb.getSeasonDetails(effectiveTmdbId, targetSeason).then(res => {
            if (res.ok) {
              setSeasonsCache(prev => ({ ...prev, [targetSeason]: res.value }));
              const ep = res.value.episodes?.find((x: any) => x.episode_number === initialEpisode);
              if (ep) { setSelectedEpisode({ season: targetSeason, episode: ep }); window.history.pushState({ isEpisodeDetailModal: true }, ''); }
            }
          });
        } else {
          const ep = seasonsCache[targetSeason].episodes?.find((x: any) => x.episode_number === initialEpisode);
          if (ep) { setSelectedEpisode({ season: targetSeason, episode: ep }); window.history.pushState({ isEpisodeDetailModal: true }, ''); }
        }
      } else if (!seasonsCache[targetSeason]) {
        tmdb.getSeasonDetails(effectiveTmdbId, targetSeason).then(res => {
          if (res.ok) setSeasonsCache(prev => ({ ...prev, [targetSeason]: res.value }));
        });
      }
    }
  }, [tmdbDetails, show, effectiveTmdbId, initialSeason, initialEpisode]);

  useEffect(() => {
    if (initialSeason && initialEpisode && effectiveTmdbId) {
      setActiveTab('episodes');
      setExpandedSeason(initialSeason);
      const tryOpenEpisode = (seasonData: any) => {
        const ep = seasonData?.episodes?.find((x: any) => x.episode_number === initialEpisode);
        if (ep) {
          setSelectedEpisode({ season: initialSeason, episode: ep });
          if (!window.history.state?.isEpisodeDetailModal) window.history.pushState({ isEpisodeDetailModal: true }, '');
        }
      };
      if (!seasonsCache[initialSeason]) {
        tmdb.getSeasonDetails(effectiveTmdbId, initialSeason).then(res => {
          if (res.ok) { setSeasonsCache(prev => ({ ...prev, [initialSeason]: res.value })); tryOpenEpisode(res.value); }
        });
      } else tryOpenEpisode(seasonsCache[initialSeason]);
    }
  }, [initialSeason, initialEpisode, effectiveTmdbId]);

  const seasonObserverRef = useRef<HTMLDivElement>(null);
  const castObserverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => { if (entries[0].isIntersecting) setVisibleSeasons(prev => prev + 5); }, { rootMargin: '100px' });
    if (seasonObserverRef.current) observer.observe(seasonObserverRef.current);
    return () => observer.disconnect();
  }, [activeTab]);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => { if (entries[0].isIntersecting) setVisibleCast(prev => prev + 12); }, { rootMargin: '100px' });
    if (castObserverRef.current) observer.observe(castObserverRef.current);
    return () => observer.disconnect();
  }, [activeTab]);
  useEffect(() => {
    const sections = [
      { id: 'section-about', name: 'about' },
      { id: 'section-episodes', name: 'episodes' },
      { id: 'section-casting', name: 'casting' },
      { id: 'section-community', name: 'community' }
    ];
    const observer = new IntersectionObserver(entries => {
      if (isManualScrollingRef.current) return;
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const sectionName = sections.find(s => s.id === entry.target.id)?.name;
          if (sectionName) setActiveTab(sectionName as any);
        }
      });
    }, { root: mainScrollRef.current, rootMargin: '-20% 0px -60% 0px', threshold: 0 });
    sections.forEach(s => { const el = document.getElementById(s.id); if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, [tmdbDetails, isSeries]);

  const loadSeason = async (seasonNumber: number) => {
    if (expandedSeason === seasonNumber) { setExpandedSeason(null); return; }
    setExpandedSeason(seasonNumber);
    if (!effectiveTmdbId || seasonsCache[seasonNumber]) return;
    const res = await tmdb.getSeasonDetails(effectiveTmdbId, seasonNumber);
    if (res.ok) setSeasonsCache(prev => ({ ...prev, [seasonNumber]: res.value }));
  };

  const handleAddOrRemoveShow = async () => {
    if (show?.id) {
      if (show.status === 'dropped') {
        const savedShow = { ...show };
        await updateShow(show.id, { status: 'watching', updatedAt: Date.now() });
        showToast(`« ${show.title} » ajoutée à votre suivi`, 'follow', savedShow, async () => {
          if (savedShow.id) await updateShow(savedShow.id, { status: 'dropped', updatedAt: Date.now() });
        });
      } else await handleDeleteShow();
    } else {
      if (!effectiveTmdbId) return;
      const titleToUse = tmdbDetails?.name || tmdbDetails?.title || 'Chargement...';
      const posterToUse = tmdbDetails?.poster_path ? `https://image.tmdb.org/t/p/w342${tmdbDetails.poster_path}` : undefined;
      const backdropToUse = tmdbDetails?.backdrop_path ? `https://image.tmdb.org/t/p/w780${tmdbDetails.backdrop_path}` : undefined;
      const mediaType: 'tv' | 'movie' = tmdbDetails?.number_of_seasons ? 'tv' : 'movie';
      const newShowData = { tmdbId: effectiveTmdbId, title: titleToUse, mediaType, status: 'watching' as const, createdAt: Date.now(), updatedAt: Date.now(), posterPath: posterToUse, backdropPath: backdropToUse, firstAirDate: tmdbDetails?.first_air_date || tmdbDetails?.release_date, networks: tmdbDetails?.networks, seenEpisodes: [], episodeRecords: {}, isArchived: false };
      const newId = await addShow(newShowData);
      const savedShow = { ...newShowData, id: newId, userId: '' };
      showToast(`« ${titleToUse} » ajoutée à votre suivi`, 'follow', savedShow, async () => { if (newId) await deleteShow(newId); });
    }
  };

  const toggleEpisodeSeen = async (e: React.MouseEvent, season: number, episode: number) => {
    e.stopPropagation();
    let currentShow = show;
    if (!currentShow || !currentShow.id) {
      if (!effectiveTmdbId) return;
      const titleToUse = tmdbDetails?.name || tmdbDetails?.title || 'Chargement...';
      const posterToUse = tmdbDetails?.poster_path ? `https://image.tmdb.org/t/p/w342${tmdbDetails.poster_path}` : undefined;
      const backdropToUse = tmdbDetails?.backdrop_path ? `https://image.tmdb.org/t/p/w780${tmdbDetails.backdrop_path}` : undefined;
      const mediaType = tmdbDetails?.number_of_seasons ? 'tv' : 'movie';
      const newShowData = { tmdbId: effectiveTmdbId, title: titleToUse, mediaType: mediaType as 'tv' | 'movie', status: 'watching' as const, createdAt: Date.now(), updatedAt: Date.now(), posterPath: posterToUse || null, backdropPath: backdropToUse || null, firstAirDate: tmdbDetails?.first_air_date || tmdbDetails?.release_date, networks: tmdbDetails?.networks, seenEpisodes: [], episodeRecords: {}, isArchived: false };
      const newId = await addShow(newShowData);
      currentShow = { ...newShowData, id: newId, userId: '' };
    }
    if (!currentShow?.id) return;
    const epKey = `${season}x${episode}`;
    const prevSeenEpisodes = currentShow.seenEpisodes || [];
    const prevEpisodeRecords = currentShow.episodeRecords || {};
    const prevLastWatchedAt = currentShow.lastWatchedAt || null;
    const prevNextEpisodeToWatch = currentShow.nextEpisodeToWatch || null;
    const prevIsArchived = currentShow.isArchived || false;
    const newSeen = new Set(prevSeenEpisodes);
    const newRecords = { ...prevEpisodeRecords };
    const wasSeen = newSeen.has(epKey);
    if (wasSeen) { newSeen.delete(epKey); delete newRecords[epKey]; }
    else {
      newSeen.add(epKey);
      const epObj = seasonsCache[season]?.episodes?.find((x: any) => x.episode_number === episode);
      newRecords[epKey] = { watchedAt: Date.now(), episodeTitle: epObj?.name || null };
    }
    const computeOptimisticNextEp = async (seenSet: Set<string>) => {
      const allSeasons = tmdbDetails?.seasons?.filter((s: any) => s.season_number > 0)?.sort((a: any, b: any) => a.season_number - b.season_number) || [];
      for (const s of allSeasons) {
        for (let ep = 1; ep <= (s.episode_count || 0); ep++) {
          if (!seenSet.has(`${s.season_number}x${ep}`)) {
            let seasonData = seasonsCache[s.season_number];
            if ((!seasonData || !seasonData.episodes) && effectiveTmdbId) {
              const res = await tmdb.getSeasonDetails(effectiveTmdbId, s.season_number);
              if (res.ok && res.value) { seasonData = res.value; setSeasonsCache(prev => ({ ...prev, [s.season_number]: res.value })); }
            }
            const cachedEp = seasonData?.episodes?.find((x: any) => x.episode_number === ep);
            return { season_number: s.season_number, episode_number: ep, air_date: cachedEp?.air_date || null, name: cachedEp?.name || null, still_path: cachedEp?.still_path || null };
          }
        }
      }
      return null;
    };
    const optimisticNextEp = await computeOptimisticNextEp(newSeen);
    const isEnded = tmdbDetails?.status === 'Ended' || tmdbDetails?.status === 'Canceled' || currentShow.seriesEnded || currentShow.tmdbStatus === 'Ended' || currentShow.tmdbStatus === 'Canceled';
    const autoArchived = computeAutoArchiveStatus({ ...currentShow, seenEpisodes: Array.from(newSeen as Set<string>), tmdbStatus: tmdbDetails?.status || currentShow.tmdbStatus, seriesEnded: isEnded, nextEpisodeToWatch: optimisticNextEp });
    let calculatedLastWatchedAt = Date.now();
    if (!newSeen.has(epKey)) {
      let maxRemaining = 0;
      for (const ep of newSeen) {
        const t = newRecords[ep]?.watchedAt;
        if (t && typeof t === 'number' && t > maxRemaining) maxRemaining = t;
      }
      calculatedLastWatchedAt = maxRemaining;
    }
    await updateShow(currentShow.id, { seenEpisodes: Array.from(newSeen as Set<string>), episodeRecords: newRecords, lastWatchedAt: calculatedLastWatchedAt, updatedAt: Date.now(), nextEpisodeToWatch: optimisticNextEp, isArchived: autoArchived, status: optimisticNextEp ? 'watching' : 'completed' });
    scrollAllCarouselsToStart();
    const sNumStr = String(season).padStart(2, '0');
    const eNumStr = String(episode).padStart(2, '0');
    const showTitleStr = currentShow.title || tmdbDetails?.name || tmdbDetails?.title || 'Série';
    const undo = async () => {
      if (currentShow?.id) {
        await updateShow(currentShow.id, { seenEpisodes: prevSeenEpisodes, episodeRecords: prevEpisodeRecords, lastWatchedAt: prevLastWatchedAt, nextEpisodeToWatch: prevNextEpisodeToWatch, isArchived: prevIsArchived, updatedAt: Date.now() });
        scrollAllCarouselsToStart();
      }
    };
    showToast(`« ${showTitleStr} » S${sNumStr}E${eNumStr} marqué comme ${wasSeen ? 'non vu' : 'vu !'}`, wasSeen ? 'info' : 'success', currentShow, undo);
  };

  const toggleSeasonSeen = async (e: React.MouseEvent, seasonNumber: number, expectedEpCount: number) => {
    e.stopPropagation();
    if (expectedEpCount <= 0) return;
    let currentShow = show;
    if (!currentShow || !currentShow.id) {
      if (!effectiveTmdbId) return;
      const titleToUse = tmdbDetails?.name || tmdbDetails?.title || 'Chargement...';
      const posterToUse = tmdbDetails?.poster_path ? `https://image.tmdb.org/t/p/w342${tmdbDetails.poster_path}` : undefined;
      const backdropToUse = tmdbDetails?.backdrop_path ? `https://image.tmdb.org/t/p/w780${tmdbDetails.backdrop_path}` : undefined;
      const mediaType = tmdbDetails?.number_of_seasons ? 'tv' : 'movie';
      const newShowData = { tmdbId: effectiveTmdbId, title: titleToUse, mediaType: mediaType as 'tv' | 'movie', status: 'watching' as const, createdAt: Date.now(), updatedAt: Date.now(), posterPath: posterToUse || null, backdropPath: backdropToUse || null, firstAirDate: tmdbDetails?.first_air_date || tmdbDetails?.release_date, networks: tmdbDetails?.networks, seenEpisodes: [], episodeRecords: {}, isArchived: false };
      const newId = await addShow(newShowData);
      currentShow = { ...newShowData, id: newId, userId: '' };
    }
    if (!currentShow?.id) return;
    const prevSeenEpisodes = currentShow.seenEpisodes || [];
    const prevEpisodeRecords = currentShow.episodeRecords || {};
    const prevLastWatchedAt = currentShow.lastWatchedAt || null;
    const prevNextEpisodeToWatch = currentShow.nextEpisodeToWatch || null;
    const prevIsArchived = currentShow.isArchived || false;
    let seasonData = seasonsCache[seasonNumber];
    if (!seasonData && effectiveTmdbId) {
      const res = await tmdb.getSeasonDetails(effectiveTmdbId, seasonNumber);
      if (res.ok) { seasonData = res.value; setSeasonsCache(prev => ({ ...prev, [seasonNumber]: seasonData })); }
    }
    let epKeys: string[] = seasonData?.episodes
      ? seasonData.episodes.filter((ep: any) => !ep.air_date || new Date(ep.air_date).getTime() <= Date.now()).map((ep: any) => `${seasonNumber}x${ep.episode_number}`)
      : Array.from({ length: expectedEpCount }, (_, index) => `${seasonNumber}x${index + 1}`);
    const existingSeen = new Set(prevSeenEpisodes);
    const existingRecords = { ...prevEpisodeRecords };
    const allSeen = epKeys.length > 0 && epKeys.every(k => existingSeen.has(k));
    const now = Date.now();
    if (allSeen) epKeys.forEach(k => { existingSeen.delete(k); delete existingRecords[k]; });
    else epKeys.forEach(k => { existingSeen.add(k); existingRecords[k] = { watchedAt: now }; });
    const computeOptimisticNextEp = async (seenSet: Set<string>) => {
      const allSeasons = tmdbDetails?.seasons?.filter((s: any) => s.season_number > 0)?.sort((a: any, b: any) => a.season_number - b.season_number) || [];
      for (const s of allSeasons) {
        for (let ep = 1; ep <= (s.episode_count || 0); ep++) {
          if (!seenSet.has(`${s.season_number}x${ep}`)) {
            let seasonData = seasonsCache[s.season_number];
            if ((!seasonData || !seasonData.episodes) && effectiveTmdbId) {
              const res = await tmdb.getSeasonDetails(effectiveTmdbId, s.season_number);
              if (res.ok && res.value) { seasonData = res.value; setSeasonsCache(prev => ({ ...prev, [s.season_number]: res.value })); }
            }
            const cachedEp = seasonData?.episodes?.find((x: any) => x.episode_number === ep);
            return { season_number: s.season_number, episode_number: ep, air_date: cachedEp?.air_date || null, name: cachedEp?.name || null, still_path: cachedEp?.still_path || null };
          }
        }
      }
      return null;
    };
    const optimisticNextEp = await computeOptimisticNextEp(existingSeen);
    const isEnded = tmdbDetails?.status === 'Ended' || tmdbDetails?.status === 'Canceled' || currentShow.seriesEnded || currentShow.tmdbStatus === 'Ended' || currentShow.tmdbStatus === 'Canceled';
    const autoArchived = computeAutoArchiveStatus({ ...currentShow, seenEpisodes: Array.from(existingSeen as Set<string>), tmdbStatus: tmdbDetails?.status || currentShow.tmdbStatus, seriesEnded: isEnded, nextEpisodeToWatch: optimisticNextEp });
    await updateShow(currentShow.id, { seenEpisodes: Array.from(existingSeen as Set<string>), episodeRecords: existingRecords, lastWatchedAt: allSeen ? (currentShow.lastWatchedAt || now) : now, updatedAt: now, nextEpisodeToWatch: optimisticNextEp, isArchived: autoArchived, status: optimisticNextEp ? 'watching' : 'completed' });
    const showTitleStr = currentShow.title || tmdbDetails?.name || tmdbDetails?.title || 'Série';
    const undo = async () => {
      if (currentShow?.id) {
        await updateShow(currentShow.id, { seenEpisodes: prevSeenEpisodes, episodeRecords: prevEpisodeRecords, lastWatchedAt: prevLastWatchedAt, nextEpisodeToWatch: prevNextEpisodeToWatch, isArchived: prevIsArchived, updatedAt: Date.now() });
      }
    };
    showToast(`« ${showTitleStr} » Saison ${seasonNumber} marquée comme ${allSeen ? 'non vue' : 'vue !'}`, allSeen ? 'info' : 'success', currentShow, undo);
  };

  const toggleArchive = async () => {
    if (!show?.id) return;
    const now = Date.now();
    const newArchived = !show.isArchived;
    const savedShow = { ...show };
    await updateShow(show.id, { isArchived: newArchived, updatedAt: now });
    if (newArchived) showToast(`« ${show.title} » a été déplacée dans vos archives.`, 'archive', show, async () => { if (savedShow.id) await updateShow(savedShow.id, { isArchived: false, updatedAt: Date.now() }); });
  };
  const followShow = handleAddOrRemoveShow;
  const resumeShow = async () => { if (show?.id) await updateShow(show.id, { status: 'watching', updatedAt: Date.now() }); };
  const rewatchShow = async () => {
    if (!show?.id) return;
    const now = Date.now();
    await updateShow(show.id, { seenEpisodes: [], episodeRecords: {}, status: 'watching', isArchived: false, lastWatchedAt: now, nextEpisodeToWatch: { season_number: 1, episode_number: 1, air_date: null, name: null }, updatedAt: now });
    setExpandedSeason(1);
    showToast(`« ${show.title} » réinitialisée : reprise à la saison 1 !`, 'success');
  };
  const dropShow = async () => {
    if (!show?.id) return;
    const previousStatus = show.status || 'watching';
    const savedShow = { ...show };
    await updateShow(show.id, { status: 'dropped', updatedAt: Date.now() });
    showToast(`« ${show.title} » marquée comme abandonnée.`, 'dropped', show, async () => { if (savedShow.id) await updateShow(savedShow.id, { status: previousStatus, updatedAt: Date.now() }); });
  };
  const toggleDropShow = async () => {
    const targetShow = show || lastKnownShowRef.current;
    if (!targetShow?.id) return;
    const now = Date.now();
    const isUnfollowing = targetShow.status !== 'dropped';
    const previousStatus = targetShow.status || 'watching';
    const savedShow = { ...targetShow };
    if (isUnfollowing && !hasSeenMedia) {
      handleAnimatedBack();
      await deleteShow(targetShow.id);
      showToast(`« ${targetShow.title} » a été supprimée de votre suivi.`, 'unfollow', targetShow, async () => {
        if (auth.currentUser && savedShow.id) {
          const docRef = doc(db, 'users', auth.currentUser.uid, 'shows', savedShow.id);
          useShowsStore.getState().addShowOptimistic(savedShow);
          await setDoc(docRef, savedShow);
        }
      });
      return;
    }
    const newStatus = targetShow.status === 'dropped' ? 'watching' : 'dropped';
    await updateShow(targetShow.id, { status: newStatus, updatedAt: now });
    if (newStatus === 'dropped') showToast(`« ${targetShow.title} » marquée comme abandonnée.`, 'dropped', targetShow, async () => { if (savedShow.id) await updateShow(savedShow.id, { status: previousStatus, updatedAt: Date.now() }); });
  };
  const handleDeleteShow = async () => {
    const targetShow = show || lastKnownShowRef.current;
    if (!targetShow?.id) return;
    const savedShow = { ...targetShow };
    handleAnimatedBack();
    try {
      await deleteShow(targetShow.id);
      showToast(`« ${targetShow.title} » a été supprimée de votre suivi.`, 'unfollow', targetShow, async () => {
        if (auth.currentUser && savedShow.id) {
          const docRef = doc(db, 'users', auth.currentUser.uid, 'shows', savedShow.id);
          useShowsStore.getState().addShowOptimistic(savedShow);
          await setDoc(docRef, savedShow);
        }
      });
    } catch (err) { console.error("Delete error:", err); }
  };
  const rateShow = async (rating: number) => { if (show?.id) await updateShow(show.id, { userRating: rating, updatedAt: Date.now() }); };

  const togglePlanToWatchMovie = async () => {
    let currentShow = show;
    if (!currentShow || !currentShow.id) {
      if (!effectiveTmdbId) return;
      const titleToUse = tmdbDetails?.name || tmdbDetails?.title || 'Chargement...';
      const posterToUse = tmdbDetails?.poster_path ? `https://image.tmdb.org/t/p/w342${tmdbDetails.poster_path}` : undefined;
      const backdropToUse = tmdbDetails?.backdrop_path ? `https://image.tmdb.org/t/p/w780${tmdbDetails.backdrop_path}` : undefined;
      const newShowData = { tmdbId: effectiveTmdbId, title: titleToUse, mediaType: 'movie' as const, status: 'plan_to_watch' as const, createdAt: Date.now(), updatedAt: Date.now(), posterPath: posterToUse || null, backdropPath: backdropToUse || null, firstAirDate: tmdbDetails?.first_air_date || tmdbDetails?.release_date, networks: tmdbDetails?.networks, seenEpisodes: [], episodeRecords: {}, isArchived: false, isFavorite: false };
      const newId = await addShow(newShowData);
      const savedShow = { ...newShowData, id: newId, userId: '' };
      showToast(`« ${titleToUse} » ajouté à vos films à voir`, 'follow', savedShow, async () => { if (newId) await deleteShow(newId); });
      return;
    }
    const isAlreadyPlanToWatch = currentShow.status === 'plan_to_watch' || (!hasSeenMedia && currentShow.status !== 'dropped');
    if (isAlreadyPlanToWatch) {
      const savedShow = { ...currentShow };
      await deleteShow(currentShow.id);
      showToast(`« ${currentShow.title} » retiré de votre suivi.`, 'unfollow', savedShow, async () => {
        if (auth.currentUser && savedShow.id) {
          const docRef = doc(db, 'users', auth.currentUser.uid, 'shows', savedShow.id);
          useShowsStore.getState().addShowOptimistic(savedShow);
          await setDoc(docRef, savedShow);
        }
      });
    } else {
      const savedShow = { ...currentShow };
      await updateShow(currentShow.id, { status: 'plan_to_watch', seenEpisodes: [], isFavorite: false, updatedAt: Date.now(), isSynced: false });
      showToast(`« ${currentShow.title} » ajouté à vos films à voir`, 'follow', savedShow, async () => {
        if (savedShow.id) await updateShow(savedShow.id, { status: savedShow.status, seenEpisodes: savedShow.seenEpisodes, isFavorite: savedShow.isFavorite, updatedAt: Date.now() });
      });
    }
  };

  const toggleMovieSeen = async () => {
    let currentShow = show;
    if (!currentShow || !currentShow.id) {
      if (!effectiveTmdbId) return;
      const titleToUse = tmdbDetails?.name || tmdbDetails?.title || 'Chargement...';
      const posterToUse = tmdbDetails?.poster_path ? `https://image.tmdb.org/t/p/w342${tmdbDetails.poster_path}` : undefined;
      const backdropToUse = tmdbDetails?.backdrop_path ? `https://image.tmdb.org/t/p/w780${tmdbDetails.backdrop_path}` : undefined;
      const newShowData = { tmdbId: effectiveTmdbId, title: titleToUse, mediaType: 'movie' as const, status: 'completed' as const, createdAt: Date.now(), updatedAt: Date.now(), posterPath: posterToUse || null, backdropPath: backdropToUse || null, firstAirDate: tmdbDetails?.first_air_date || tmdbDetails?.release_date, networks: tmdbDetails?.networks, seenEpisodes: ['movie'], episodeRecords: { movie: { watchedAt: Date.now() } }, isArchived: false, isFavorite: false };
      const newId = await addShow(newShowData);
      const savedShow = { ...newShowData, id: newId, userId: '' };
      showToast(`« ${titleToUse} » marqué comme vu !`, 'success', savedShow, async () => { if (newId) await deleteShow(newId); });
      return;
    }
    const savedShow = { ...currentShow };
    const seen = currentShow.seenEpisodes?.includes('movie') || currentShow.status === 'completed';
    const newSeen = seen ? [] : ['movie'];
    const newStatus = seen ? 'plan_to_watch' : 'completed';
    const newRecords = { ...(currentShow.episodeRecords || {}) };
    if (!seen) newRecords['movie'] = { watchedAt: Date.now(), episodeTitle: currentShow.title || 'Film' };
    else delete newRecords['movie'];
    await updateShow(currentShow.id, { seenEpisodes: newSeen, episodeRecords: newRecords, status: newStatus, isFavorite: seen ? false : currentShow.isFavorite, lastWatchedAt: seen ? null : Date.now(), updatedAt: Date.now(), isSynced: false });
    showToast(`« ${currentShow.title} » marqué comme ${seen ? 'non vu' : 'vu !'}`, seen ? 'info' : 'success', savedShow, async () => {
      if (savedShow.id) await updateShow(savedShow.id, { seenEpisodes: savedShow.seenEpisodes || (seen ? ['movie'] : []), status: savedShow.status, isFavorite: savedShow.isFavorite, updatedAt: Date.now() });
    });
  };

  const formatRuntime = (minutes?: number) => {
    if (!minutes) return '';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0) return `${h}h${m > 0 ? m.toString().padStart(2, '0') : ''}`;
    return `${m}min`;
  };
  const formatRemainingTime = (minutes?: number) => {
    if (!minutes) return '';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0) return `${h}h${m.toString().padStart(2, '0')}`;
    return `${m}min`;
  };
  const toggleFavorite = async () => {
    const isFav = Boolean(show?.isFavorite);
    const newFav = !isFav;
    let currentShow = show;
    if (!currentShow) {
      if (!effectiveTmdbId) return;
      const titleToUse = title || tmdbDetails?.name || tmdbDetails?.title || 'Sans titre';
      const posterToUse = tmdbDetails?.poster_path || null;
      const backdropToUse = tmdbDetails?.backdrop_path || null;
      const isSeriesItem = Boolean(tmdbDetails?.number_of_seasons || externalMediaType === 'tv');
      const newShowData: Omit<Show, 'id' | 'userId'> = { tmdbId: effectiveTmdbId, title: titleToUse, mediaType: isSeriesItem ? 'tv' : 'movie', status: 'watching', createdAt: Date.now(), updatedAt: Date.now(), posterPath: posterToUse ? (posterToUse.startsWith('http') ? posterToUse : `https://image.tmdb.org/t/p/w500${posterToUse}`) : null, backdropPath: backdropToUse ? (backdropToUse.startsWith('http') ? backdropToUse : `https://image.tmdb.org/t/p/w1280${backdropToUse}`) : null, firstAirDate: tmdbDetails?.first_air_date || tmdbDetails?.release_date, networks: tmdbDetails?.networks, seenEpisodes: [], episodeRecords: {}, isArchived: false, isFavorite: newFav, notificationsEnabled: newFav ? true : undefined };
      await addShow(newShowData);
      showToast(newFav ? `« ${titleToUse} » ${isSeries ? 'ajoutée' : 'ajouté'} aux favoris • Notifications activées 🔔` : `« ${titleToUse} » ${isSeries ? 'retirée' : 'retiré'} des favoris`, 'favorite', currentShow);
      return;
    }
    if (currentShow.id) {
      await updateShow(currentShow.id, { isFavorite: newFav, ...(newFav ? { notificationsEnabled: true } : {}), updatedAt: Date.now() });
      showToast(newFav ? `« ${currentShow.title} » ${isSeries ? 'ajoutée' : 'ajouté'} aux favoris • Notifications activées 🔔` : `« ${currentShow.title} » ${isSeries ? 'retirée' : 'retiré'} des favoris`, 'favorite', currentShow);
    }
  };
  const handleShare = async () => {
    const titleText = title || tmdbDetails?.name || tmdbDetails?.title || (isSeries ? 'Série' : 'Film');
    const shareUrl = effectiveTmdbId
      ? buildMediaShareUrl({ tmdbId: Number(effectiveTmdbId), mediaType: requestedMediaType })
      : null;

    if (!shareUrl) {
      showToast('Impossible de créer le lien de partage', 'info', show || undefined);
      return;
    }

    const shareData = { title: titleText, text: `Découvre ${titleText} !`, url: shareUrl };
    if (typeof navigator !== 'undefined' && navigator.share) {
      try { await navigator.share(shareData); } catch (e) {}
    } else {
      try { await navigator.clipboard.writeText(shareUrl); showToast('Lien copié dans le presse-papier !', 'info', show || undefined); }
      catch (e) { showToast('Impossible de copier le lien', 'info', show || undefined); }
    }
  };

  if (!show && !tmdbDetails) {
    if (!effectiveTmdbId || fetchError) {
      return (
        <div className="flex-1 bg-black flex flex-col items-center justify-center p-6 text-center">
          <div className="w-12 h-12 bg-red-500/20 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg></div>
          <h2 className="text-xl font-bold text-white mb-2">Média introuvable</h2>
          <p className="text-zinc-400 mb-6">Les détails de ce média n'ont pas pu être chargés.</p>
          <button onClick={onBack} className="px-6 py-2 bg-white/10 hover:bg-white/20 text-white rounded-full font-semibold transition-colors">Retour</button>
        </div>
      );
    }
    return <MediaDetailColdShell onBack={onBack} mediaType={requestedMediaType} />;
  }

  const hasSeenMedia = isSeries ? (show?.seenEpisodes && show.seenEpisodes.length > 0) : (show?.seenEpisodes?.includes('movie') || show?.status === 'completed');
  const isUpToDate = isSeries && show ? checkIsUpToDate(show) : false;
  const fallbackNextEp = isSeries && !hasSeenMedia ? { season_number: 1, episode_number: 1, name: 'Épisode 1' } : null;
  const nextEp = isUpToDate ? (show?.nextEpisodeToAir || tmdbDetails?.next_episode_to_air || null) : (show?.nextEpisodeToWatch || fallbackNextEp || show?.nextEpisodeToAir || tmdbDetails?.next_episode_to_air);
  const handleWatchNextEpisode = () => { if (nextEp) openEpisodeModal(nextEp.season_number, nextEp); };
  const getNextEpisodeStatus = () => {
    if (isUpToDate && !show?.nextEpisodeToAir && !tmdbDetails?.next_episode_to_air) return null;
    if (!nextEp) return null;
    const sNum = nextEp.season_number ?? 1;
    const eNum = nextEp.episode_number ?? 1;
    if (isNaN(Number(sNum)) || isNaN(Number(eNum))) return null;
    const fullEpCode = `S${String(sNum).padStart(2, '0')} | E${String(eNum).padStart(2, '0')}`;
    let airDate = nextEp.air_date;
    if (!airDate && seasonsCache[nextEp.season_number]?.episodes) {
      const cachedEp = seasonsCache[nextEp.season_number].episodes.find((x: any) => x.episode_number === nextEp.episode_number);
      if (cachedEp?.air_date) airDate = cachedEp.air_date;
    }
    const todayStr = getTodayStr();
    if (airDate) {
      const diffDays = getCalendarDaysDiff(airDate);
      if (diffDays > 0) {
        if (diffDays === 1) return { isUpcoming: true, label: `${fullEpCode} demain` };
        if (diffDays <= 7) return { isUpcoming: true, label: `${fullEpCode} dans ${diffDays} jours` };
        return { isUpcoming: true, label: `${fullEpCode} le ${formatAirDateSafe(airDate, 'short')}` };
      }
    } else if (!hasSeenMedia && tmdbDetails?.first_air_date && tmdbDetails.first_air_date > todayStr) return { isUpcoming: true, label: `${fullEpCode} bientôt` };
    return { isUpcoming: false, label: `${hasSeenMedia ? "Reprendre" : "Commencer"} • ${fullEpCode}` };
  };
  const epStatus = getNextEpisodeStatus();
  const logoPath = !logoError ? getBestLogoPath(tmdbDetails?.images) : null;
  const rawPoster = tmdbDetails?.poster_path || show?.posterPath;
  const posterPath = rawPoster ? (rawPoster.startsWith('http') ? rawPoster : `https://image.tmdb.org/t/p/w500${rawPoster.startsWith('/') ? '' : '/'}${rawPoster}`) : undefined;
  const rawBackdrop = tmdbDetails?.backdrop_path || show?.backdropPath;
  const backdropUrl = rawBackdrop ? (rawBackdrop.startsWith('http') ? rawBackdrop : `https://image.tmdb.org/t/p/w780${rawBackdrop.startsWith('/') ? '' : '/'}${rawBackdrop}`) : posterPath;
  const totalEpisodes = show?.totalEpisodes || tmdbDetails?.number_of_episodes || show?.totalAiredEpisodes || 0;
  const seenCount = isSeries ? (show?.seenEpisodes?.length || 0) : (hasSeenMedia ? 1 : 0);
  const progressPercentage = totalEpisodes > 0 ? Math.min(100, Math.round((seenCount / totalEpisodes) * 100)) : 0;
  const episodeRunTime = tmdbDetails?.episode_run_time?.[0] || 45;
  const remainingEpisodes = Math.max(0, totalEpisodes - seenCount);
  const remainingTimeMinutes = remainingEpisodes * episodeRunTime;
  const ytVideos = tmdbDetails?.videos?.results?.filter((v: any) => v.site === 'YouTube') || [];
  const hasTrailer = ytVideos.length > 0;
  const firstSubscribedProvider = sortedProviders.find((p: any) => userPlatforms.includes(p.provider_id));
  const watchLink = providers?.link;
  const mainProvider = firstSubscribedProvider || sortedProviders[0];
  const isMainProviderSubscribed = mainProvider ? (mainProvider.isPlex || userPlatforms.includes(mainProvider.provider_id)) : false;
  const mainProviderName = mainProvider ? mainProvider.provider_name : (tmdbDetails?.networks?.[0]?.name || (show as any)?.network || (show as any)?.platform);
  const mainProviderLogo = mainProvider ? (mainProvider.isPlex ? PLEX_LOGO_SVG : getFormattedProviderLogo(mainProvider.logo_path, mainProvider.provider_name)) : (tmdbDetails?.networks?.[0]?.logo_path ? getFormattedProviderLogo(tmdbDetails.networks[0].logo_path, tmdbDetails.networks[0].name) : null);
  const mainProviderLink = mainProvider ? (mainProvider.isPlex ? (mainProvider.plexUrl || 'https://app.plex.tv/desktop') : getProviderDirectLink(mainProvider.provider_id, title, watchLink)) : (watchLink || `https://www.google.com/search?q=${encodeURIComponent(title + ' ' + (mainProviderName || ''))}`);

  const getRatingInfo = () => {
    if (!tmdbDetails) return { label: 'Non classé', provenance: null, colorClass: 'bg-zinc-800/80 border-white/10 text-zinc-400' };
    const resolved = tmdbDetails.seenitParentalRating
      || resolveParentalRating(requestedMediaType, tmdbDetails);
    const provenance = resolved.source === 'personal'
      ? 'Choix personnel'
      : resolved.original && resolved.country
        ? `${resolved.original} · ${resolved.country}`
        : null;
    return {
      label: resolved.shortLabel || resolved.label,
      provenance,
      colorClass: getParentalRatingColorClass(resolved),
    };
  };
  const ratingInfo = getRatingInfo();
  const mediaTarget = tmdbDetails || show || (effectiveTmdbId ? { id: effectiveTmdbId } : null);

  return <ShowDetailView model={{ activeTab, areThemesExpanded, backdropUrl, collectionData, collectionLoading, downloadTargetEpisode, downloadTargetSeason, dragX, dropShow, effectiveTmdbId, epStatus, expandedSeason, followShow, formatRemainingTime, formatRuntime, getEpisodeDownload, handle1ClickDownloadEpisode, handle1ClickDownloadMovie, handle1ClickDownloadSeason, handleAnimatedBack, handleDeleteShow, handleSyncSingle, handleTabChange, handleTouchEnd, handleTouchMove, handleTouchStart, handleWatchNextEpisode, hasActiveDownload, hasCancelledDownload, hasCompletedDownload, hasDownloadError, hasSeenMedia, hasTrailer, initialEpisode, initialSeason, is1ClickDownloading, isDownloadModalOpen, isDownloadMode, isDragging, isExiting, isRefreshingPlex, isSeries, isSyncingSingle, isSynopsisExpanded, isUnreleased, keywords, loadSeason, logoPath, mainScrollRef, onShowClick, openEpisodeModal, openPersonModal, plexMediaInfo, posterError, posterPath, progressPercentage, providers, ratingInfo, refreshPlexAvailability, releaseYear, remainingTimeMinutes, requestedMediaKey, resumeShow, rewatchShow, seasonObserverRef, seasonsCache, seenCount, selectedEpisode, selectedPersonId, setAreThemesExpanded, setDownloadTargetEpisode, setDownloadTargetSeason, setIsDownloadModalOpen, setIsDownloadMode, setIsSynopsisExpanded, setLogoError, setPosterError, setSeasonsCache, setSelectedEpisode, setSelectedPersonId, setShowAllCast, setShowMenu, setTrailerModalVideos, show, showDownloadSummary, showMenu, showToast, sortedProviders, tabsRef, title, tmdbDetails, toggleEpisodeSeen, toggleFavorite, toggleMovieSeen, togglePlanToWatchMovie, toggleSeasonSeen, totalEpisodes, trailerModalVideos, universeData, userPlatforms, visibleSeasons, ytVideos }} />;
}
