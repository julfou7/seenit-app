import { VIEWING_SOURCE_SEENIT } from '../features/history/viewingSource';
import { DialogLayer, isTopDialogElement } from '../components/ui/DialogLayer';
import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, animate, useDragControls } from 'motion/react';
import { type Show } from '../types';
import { X, ChevronLeft, ChevronRight, Clock, ArrowLeft, Sparkles } from 'lucide-react';
import { EpisodeReminderBell } from '../components/EpisodeReminderBell';
import { EpisodeProgramCard } from '../components/EpisodeProgramCard';
import { computeAutoArchiveStatus, formatAirDateSafe, getTodayStr, getCalendarDaysDiff, scrollAllCarouselsToStart } from '../lib/utils';
import { useShows } from '../hooks/useShows';
import { useToastStore } from '../store/toastStore';
import { tmdb } from '../features/shows/tmdb';
import { syncSingleItem } from "../hooks/useDetailsSyncWorker";
import { RedditSection } from '../components/community/RedditSection';
import { buildRedditEpisodeSearchQuery } from '../components/community/redditEpisodeSearch';
import { auth } from '../lib/firebase';
import { readUserScopedJson } from '../lib/userIsolation';
import { episodeRank, formatClock, formatRating, planEpisodes } from '../features/shows/detailPlanning';
import { useClockMinutes, WhereToWatchCard, type WhereToWatchProvider } from './mediaDetail/detailUi';
import { originalBroadcasterRow } from '../features/providers/passiveProviderState';
import { dedupeProvidersByName } from '../features/providers/providerNames';
import { appLogger } from '../store/logStore';
import { EpisodeDetailSkeleton, EpisodeHeaderBlock, EpisodeNavRow, EpisodePlannerCard, ReactionRow, SeasonCurveCard, SpoilerSynopsis } from './mediaDetail/episodeSections';
import { useMediaPresence } from '../hooks/useMediaPresence';
import { openPlexWatchUrl } from '../features/plex/syncPlex';
import { isPlexEpisodePresent } from '../features/plex/plexAvailability';
import { type EpisodeDetailData } from './episodeDetailTypes';
import {
  canStartEpisodeSwipeFromTarget,
  resolveEpisodeSwipe,
  resolveEpisodeNavigationDirectionFromKey,
  resolveLoadedAdjacentEpisode,
} from '../features/navigation/episodeNavigation';

interface EpisodeDetailModalProps {
  show?: Show;
  season: number;
  episode: EpisodeDetailData;
  isHydrating?: boolean;
  tmdbShowTitle?: string;
  tmdbShowId?: number;
  onShowClick?: (tmdbId: number, mediaType?: 'tv' | 'movie') => void;
  onClose: () => void;
  onLoadSeason?: (seasonNum: number) => Promise<EpisodeDetailData[] | { episodes?: EpisodeDetailData[] } | null | undefined>;
}

export function EpisodeDetailModal({ show, season: initialSeason, episode: initialEpisode, isHydrating = false, tmdbShowTitle, tmdbShowId, onShowClick, onClose, onLoadSeason }: EpisodeDetailModalProps) {
  const dialogRootRef = useRef<HTMLDivElement>(null);
  const [currentSeason, setCurrentSeason] = useState(initialSeason);
  const [currentEpisode, setCurrentEpisode] = useState(initialEpisode);
  const [isSynopsisExpanded, setIsSynopsisExpanded] = useState(false);
  const [isLoadingEpisode, setIsLoadingEpisode] = useState(false);

  const [showFutureConfirm, setShowFutureConfirm] = useState(false);
  const [revealedSynopsis, setRevealedSynopsis] = useState<Record<string, true>>({});
  const [streamingProviders, setStreamingProviders] = useState<WhereToWatchProvider[]>([]);
  const [providersPayload, setProvidersPayload] = useState<unknown>(null); // #965 : même lot que les cartes (diffuseur d'origine)
  const clockMinutes = useClockMinutes();

  const { shows, addShow, updateShow } = useShows();
  const { showToast } = useToastStore();

  // Find live show from Zustand store so updates are instantly reactive
  const liveShow = shows.find(s =>
    (show?.id && s.id === show.id) ||
    (show?.tmdbId && s.tmdbId === show.tmdbId) ||
    (tmdbShowId && s.tmdbId === tmdbShowId)
  );
  const activeShow = liveShow || show;

  // Vérification de la présence locale (Sonarr / Plex)
  const presence = useMediaPresence({
    tmdbId: tmdbShowId || activeShow?.tmdbId,
    tvdbId: activeShow?.tvdbId,
    imdbId: activeShow?.imdbId,
    title: activeShow?.title || tmdbShowTitle,
    mediaType: 'tv'
  });

  const seasonCacheRef = useRef<Record<string, EpisodeDetailData[]>>({});
  const episodeCacheRef = useRef<Record<string, EpisodeDetailData>>({});
  const imagePreloadRef = useRef<Record<string, HTMLImageElement>>({});
  const isTransitioningRef = useRef(false);
  const navigationRequestRef = useRef(0);

  const fetchAndCacheSeason = useCallback(async (seasonNum: number) => {
    const effectiveTmdbId = tmdbShowId || activeShow?.tmdbId;
    if (!effectiveTmdbId || seasonNum < 0) return null;
    const key = `${effectiveTmdbId}_${seasonNum}`;
    if (seasonCacheRef.current[key]) return seasonCacheRef.current[key];

    if (onLoadSeason) {
      try {
        const ext = await onLoadSeason(seasonNum);
        if (Array.isArray(ext)) {
          seasonCacheRef.current[key] = ext;
          return ext;
        } else if (ext?.episodes && Array.isArray(ext.episodes)) {
          seasonCacheRef.current[key] = ext.episodes;
          return ext.episodes;
        }
      } catch (e) {}
    }

    try {
      const res = await tmdb.getSeasonDetails(effectiveTmdbId, seasonNum);
      if (res.ok && res.value?.episodes) {
        const episodes = res.value.episodes;
        seasonCacheRef.current[key] = episodes;
        episodes.forEach((ep: EpisodeDetailData) => {
          if (ep && typeof ep.episode_number === 'number') {
            const epKey = `${effectiveTmdbId}_${seasonNum}_${ep.episode_number}`;
            if (!episodeCacheRef.current[epKey]) {
              episodeCacheRef.current[epKey] = ep;
            }
            if (ep.still_path && !imagePreloadRef.current[epKey]) {
              const img = new Image();
              img.src = `https://image.tmdb.org/t/p/w1280${ep.still_path}`;
              imagePreloadRef.current[epKey] = img;
            }
          }
        });
        return episodes;
      }
    } catch (e) {}
    return null;
  }, [tmdbShowId, activeShow?.tmdbId, onLoadSeason]);

  const preloadEpisodeKey = (season: number, epNum: number) => {
    const effectiveTmdbId = tmdbShowId || activeShow?.tmdbId;
    if (!effectiveTmdbId || season < 0 || epNum < 1) return;
    const key = `${effectiveTmdbId}_${season}_${epNum}`;
    if (episodeCacheRef.current[key]) return;

    tmdb.getEpisodeDetails(effectiveTmdbId, season, epNum).then(res => {
      if (res.ok && res.value && !res.value.status_code && typeof res.value.episode_number === 'number') {
        episodeCacheRef.current[key] = res.value;
        if (res.value.still_path) {
          const img = new Image();
          img.src = `https://image.tmdb.org/t/p/w1280${res.value.still_path}`;
          imagePreloadRef.current[key] = img;
        }
      }
    }).catch(() => {});
  };

  useLayoutEffect(() => {
    navigationRequestRef.current += 1;
    isTransitioningRef.current = false;
    setIsLoadingEpisode(false);
    setCurrentSeason(initialSeason);
    setCurrentEpisode(initialEpisode);
    setShowFutureConfirm(false);
  }, [initialSeason, initialEpisode]);

  useEffect(() => () => {
    navigationRequestRef.current += 1;
  }, []);

  const [currentSeasonEpCount, setCurrentSeasonEpCount] = useState<number | null>(null);
  const [nextSeasonEpCount, setNextSeasonEpCount] = useState<number | null>(null);
  const [swipeDirection, setSwipeDirection] = useState<'next' | 'prev' | null>(null);
  const isSwipingRef = useRef(false);
  const dragX = useMotionValue(0);
  const dragControls = useDragControls();

  // Reset gesture state whenever currentSeason or currentEpisode changes
  useEffect(() => {
    dragX.set(0);
    isSwipingRef.current = false;
    setSwipeDirection(null);
  }, [currentSeason, currentEpisode?.episode_number, dragX]);

  // Synchronize season counts from cache immediately when currentSeason changes
  useEffect(() => {
    const effectiveTmdbId = tmdbShowId || activeShow?.tmdbId;
    if (effectiveTmdbId) {
      const curCached = seasonCacheRef.current[`${effectiveTmdbId}_${currentSeason}`];
      setCurrentSeasonEpCount(curCached ? curCached.length : null);

      const nextCached = seasonCacheRef.current[`${effectiveTmdbId}_${currentSeason + 1}`];
      setNextSeasonEpCount(nextCached ? nextCached.length : null);
    }
  }, [currentSeason, tmdbShowId, activeShow?.tmdbId]);

  // Background preloading of current, next and previous season details
  useEffect(() => {
    const effectiveTmdbId = tmdbShowId || activeShow?.tmdbId;
    if (!effectiveTmdbId || currentSeason < 0 || !currentEpisode?.episode_number) return;

    let isMounted = true;

    // Cache current season & update count
    fetchAndCacheSeason(currentSeason).then(episodes => {
      if (isMounted && episodes) {
        setCurrentSeasonEpCount(episodes.length);
        const curEpNum = currentEpisode.episode_number;
        const found = episodes.find(e => e.episode_number === curEpNum);
        if (found && (!currentEpisode.overview || !currentEpisode.still_path)) {
          setCurrentEpisode(prev => ({
            ...prev,
            ...found,
            overview: found.overview || prev?.overview || '',
            still_path: found.still_path || prev?.still_path || null,
          }));
        }
      }
    });

    // Preload Next Season and Previous Season
    fetchAndCacheSeason(currentSeason + 1).then(episodes => {
      if (isMounted) {
        setNextSeasonEpCount(episodes ? episodes.length : 0);
      }
    });
    if (currentSeason > minSeason) {
      fetchAndCacheSeason(currentSeason - 1);
    }

    return () => {
      isMounted = false;
    };
  }, [currentSeason, currentEpisode?.episode_number, tmdbShowId, activeShow?.tmdbId, fetchAndCacheSeason]);



  const epKey = `${currentSeason}x${currentEpisode?.episode_number || 1}`;
  const isSeen = activeShow?.seenEpisodes?.includes(epKey);
  const record = activeShow?.episodeRecords?.[epKey];

  const opacityPrev = useTransform(dragX, [0, 150], [0, 1]);
  const opacityNext = useTransform(dragX, [0, -150], [0, 1]);
  const scalePrev = useTransform(dragX, [0, 150], [0.8, 1.2]);
  const scaleNext = useTransform(dragX, [0, -150], [0.8, 1.2]);
  const xPrev = useTransform(dragX, [0, 150], [-20, 0]);
  const xNext = useTransform(dragX, [0, -150], [20, 0]);

  // Season transition visual toast banner state
  const [seasonChangeNotice, setSeasonChangeNotice] = useState<{ season: number; type: 'next' | 'prev' } | null>(null);
  const prevSeasonRef = useRef(initialSeason);

  useEffect(() => {
    if (prevSeasonRef.current !== currentSeason) {
      const isNext = currentSeason > prevSeasonRef.current;
      setSeasonChangeNotice({ season: currentSeason, type: isNext ? 'next' : 'prev' });
      prevSeasonRef.current = currentSeason;
      const timer = setTimeout(() => {
        setSeasonChangeNotice(null);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [currentSeason]);

  const minSeason = initialSeason === 0 ? 0 : 1;
  const isPrevSeasonChange = (currentEpisode?.episode_number || 1) === 1 && currentSeason > minSeason;
  const isNextSeasonChange = currentSeasonEpCount && currentEpisode?.episode_number && nextSeasonEpCount !== null && nextSeasonEpCount > 0
    ? currentEpisode.episode_number >= currentSeasonEpCount
    : false;

  const hasPrevious = currentSeason > minSeason || (currentEpisode?.episode_number || 1) > 1;
  const hasNext = useMemo(() => {
    const curEpNum = currentEpisode?.episode_number || 1;
    const effectiveTmdbId = tmdbShowId || activeShow?.tmdbId;

    if (effectiveTmdbId) {
      const cachedCur = seasonCacheRef.current[`${effectiveTmdbId}_${currentSeason}`];
      if (cachedCur && cachedCur.length > 0) {
        const highestEpisode = cachedCur.reduce(
          (highest, episode) => Math.max(highest, episode.episode_number),
          0,
        );
        if (curEpNum < highestEpisode) return true;
        const cachedNext = seasonCacheRef.current[`${effectiveTmdbId}_${currentSeason + 1}`];
        if (cachedNext && cachedNext.length > 0) return true;
      }
    }

    if (currentSeasonEpCount && curEpNum < currentSeasonEpCount) {
      return true;
    }
    if (currentSeasonEpCount && curEpNum >= currentSeasonEpCount) {
      return nextSeasonEpCount === null || nextSeasonEpCount > 0;
    }
    if (activeShow?.totalEpisodes) {
      return curEpNum < activeShow.totalEpisodes;
    }
    return nextSeasonEpCount !== 0;
  }, [currentEpisode?.episode_number, currentSeason, currentSeasonEpCount, nextSeasonEpCount, activeShow?.totalEpisodes, tmdbShowId, activeShow?.tmdbId]);

  const finishNavigationRequest = (requestId: number) => {
    setTimeout(() => {
      if (navigationRequestRef.current !== requestId) return;
      isTransitioningRef.current = false;
      isSwipingRef.current = false;
    }, 300);
  };

  const resetEpisodeDrag = () => {
    animate(dragX, 0, { type: 'spring', damping: 25, stiffness: 300 });
  };

  const reportEpisodeNavigationFailure = (
    direction: 'previous' | 'next',
    reason: 'unavailable' | 'error',
  ) => {
    setIsLoadingEpisode(false);
    resetEpisodeDrag();
    if (reason === 'unavailable') {
      showToast(
        direction === 'next'
          ? 'Aucun épisode suivant disponible.'
          : 'Aucun épisode précédent disponible.',
        'info',
      );
      return;
    }
    showToast(
      direction === 'next'
        ? 'Impossible de charger l’épisode suivant. Réessaie.'
        : 'Impossible de charger l’épisode précédent. Réessaie.',
      'error',
    );
  };

  const applyEpisodeNavigationTarget = (
    requestId: number,
    direction: 'previous' | 'next',
    target: { season: number; episode: EpisodeDetailData },
  ) => {
    if (navigationRequestRef.current !== requestId) return false;
    setSwipeDirection(direction === 'next' ? 'next' : 'prev');
    if (target.season !== currentSeason) setCurrentSeason(target.season);
    setCurrentEpisode(target.episode);
    setIsLoadingEpisode(false);
    return true;
  };

  const handleNextEpisode = async () => {
    if (isTransitioningRef.current || isLoadingEpisode || !hasNext) return;

    const requestId = ++navigationRequestRef.current;
    isTransitioningRef.current = true;
    isSwipingRef.current = true;
    setSwipeDirection('next');
    setShowFutureConfirm(false);

    const effectiveTmdbId = tmdbShowId || activeShow?.tmdbId;
    const curEpNum = currentEpisode?.episode_number || 1;
    const nextEpNum = curEpNum + 1;

    try {
      if (effectiveTmdbId) {
        let currentEpisodes: EpisodeDetailData[] | null | undefined = seasonCacheRef.current[`${effectiveTmdbId}_${currentSeason}`];
        if (!currentEpisodes) {
          setIsLoadingEpisode(true);
          currentEpisodes = await fetchAndCacheSeason(currentSeason);
          if (navigationRequestRef.current !== requestId) return;
        }

        if (currentEpisodes && currentEpisodes.length > 0) {
          const directTarget = resolveLoadedAdjacentEpisode({
            direction: 'next',
            currentSeason,
            currentEpisodeNumber: curEpNum,
            minSeason,
            currentSeasonEpisodes: currentEpisodes,
          });
          if (directTarget) {
            applyEpisodeNavigationTarget(requestId, 'next', directTarget);
            return;
          }

          const highestEpisode = currentEpisodes.reduce(
            (highest, episode) => Math.max(highest, episode.episode_number),
            0,
          );
          if (curEpNum >= highestEpisode) {
            const targetSeason = currentSeason + 1;
            let nextEpisodes: EpisodeDetailData[] | null | undefined = seasonCacheRef.current[`${effectiveTmdbId}_${targetSeason}`];
            if (!nextEpisodes) {
              setIsLoadingEpisode(true);
              nextEpisodes = await fetchAndCacheSeason(targetSeason);
              if (navigationRequestRef.current !== requestId) return;
            }

            const boundaryTarget = resolveLoadedAdjacentEpisode({
              direction: 'next',
              currentSeason,
              currentEpisodeNumber: curEpNum,
              minSeason,
              currentSeasonEpisodes: currentEpisodes,
              adjacentSeasonEpisodes: nextEpisodes,
            });
            if (boundaryTarget) {
              applyEpisodeNavigationTarget(requestId, 'next', boundaryTarget);
              return;
            }

            reportEpisodeNavigationFailure('next', 'unavailable');
            return;
          }
        }

        setIsLoadingEpisode(true);
        const res = await tmdb.getEpisodeDetails(effectiveTmdbId, currentSeason, nextEpNum);
        if (navigationRequestRef.current !== requestId) return;
        if (
          res.ok &&
          res.value &&
          !res.value.status_code &&
          typeof res.value.episode_number === 'number'
        ) {
          const targetEpisode = res.value as EpisodeDetailData;
          episodeCacheRef.current[`${effectiveTmdbId}_${currentSeason}_${nextEpNum}`] = targetEpisode;
          applyEpisodeNavigationTarget(requestId, 'next', {
            season: currentSeason,
            episode: targetEpisode,
          });
          return;
        }

        reportEpisodeNavigationFailure('next', 'error');
        return;
      }

      if (activeShow?.totalEpisodes && nextEpNum > activeShow.totalEpisodes) {
        reportEpisodeNavigationFailure('next', 'unavailable');
        return;
      }

      applyEpisodeNavigationTarget(requestId, 'next', {
        season: currentSeason,
        episode: {
          season_number: currentSeason,
          episode_number: nextEpNum,
          name: `Épisode ${nextEpNum}`,
          air_date: null,
          overview: '',
          still_path: null,
        },
      });
    } catch {
      if (navigationRequestRef.current !== requestId) return;
      reportEpisodeNavigationFailure('next', 'error');
    } finally {
      if (navigationRequestRef.current === requestId) finishNavigationRequest(requestId);
    }
  };

  const handlePreviousEpisode = async () => {
    if (isTransitioningRef.current || isLoadingEpisode || !hasPrevious) return;

    const requestId = ++navigationRequestRef.current;
    isTransitioningRef.current = true;
    isSwipingRef.current = true;
    setSwipeDirection('prev');
    setShowFutureConfirm(false);

    const effectiveTmdbId = tmdbShowId || activeShow?.tmdbId;
    const curEpNum = currentEpisode?.episode_number || 1;

    try {
      if (curEpNum > 1) {
        const prevEpNum = curEpNum - 1;
        if (effectiveTmdbId) {
          let currentEpisodes: EpisodeDetailData[] | null | undefined = seasonCacheRef.current[`${effectiveTmdbId}_${currentSeason}`];
          if (!currentEpisodes) {
            setIsLoadingEpisode(true);
            currentEpisodes = await fetchAndCacheSeason(currentSeason);
            if (navigationRequestRef.current !== requestId) return;
          }

          const loadedTarget = resolveLoadedAdjacentEpisode({
            direction: 'previous',
            currentSeason,
            currentEpisodeNumber: curEpNum,
            minSeason,
            currentSeasonEpisodes: currentEpisodes,
          });
          if (loadedTarget) {
            applyEpisodeNavigationTarget(requestId, 'previous', loadedTarget);
            return;
          }

          const prevKey = `${effectiveTmdbId}_${currentSeason}_${prevEpNum}`;
          const cachedPrevious = episodeCacheRef.current[prevKey];
          if (cachedPrevious) {
            applyEpisodeNavigationTarget(requestId, 'previous', {
              season: currentSeason,
              episode: cachedPrevious,
            });
            return;
          }

          setIsLoadingEpisode(true);
          const res = await tmdb.getEpisodeDetails(effectiveTmdbId, currentSeason, prevEpNum);
          if (navigationRequestRef.current !== requestId) return;
          if (
            res.ok &&
            res.value &&
            !res.value.status_code &&
            typeof res.value.episode_number === 'number'
          ) {
            const targetEpisode = res.value as EpisodeDetailData;
            episodeCacheRef.current[prevKey] = targetEpisode;
            applyEpisodeNavigationTarget(requestId, 'previous', {
              season: currentSeason,
              episode: targetEpisode,
            });
            return;
          }

          reportEpisodeNavigationFailure('previous', 'error');
          return;
        }

        applyEpisodeNavigationTarget(requestId, 'previous', {
          season: currentSeason,
          episode: {
            season_number: currentSeason,
            episode_number: prevEpNum,
            name: `Épisode ${prevEpNum}`,
            air_date: null,
            overview: '',
            still_path: null,
          },
        });
        return;
      }

      if (currentSeason > minSeason) {
        if (!effectiveTmdbId) {
          reportEpisodeNavigationFailure('previous', 'unavailable');
          return;
        }

        const targetSeason = currentSeason - 1;
        let previousEpisodes: EpisodeDetailData[] | null | undefined = seasonCacheRef.current[`${effectiveTmdbId}_${targetSeason}`];
        if (!previousEpisodes) {
          setIsLoadingEpisode(true);
          previousEpisodes = await fetchAndCacheSeason(targetSeason);
          if (navigationRequestRef.current !== requestId) return;
        }

        const boundaryTarget = resolveLoadedAdjacentEpisode({
          direction: 'previous',
          currentSeason,
          currentEpisodeNumber: curEpNum,
          minSeason,
          currentSeasonEpisodes: seasonCacheRef.current[`${effectiveTmdbId}_${currentSeason}`],
          adjacentSeasonEpisodes: previousEpisodes,
        });
        if (boundaryTarget) {
          applyEpisodeNavigationTarget(requestId, 'previous', boundaryTarget);
          return;
        }

        reportEpisodeNavigationFailure('previous', 'unavailable');
      }
    } catch {
      if (navigationRequestRef.current !== requestId) return;
      reportEpisodeNavigationFailure('previous', 'error');
    } finally {
      if (navigationRequestRef.current === requestId) finishNavigationRequest(requestId);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopDialogElement(dialogRootRef.current)) return;
      if (isHydrating || showFutureConfirm || isLoadingEpisode) return;
      const direction = resolveEpisodeNavigationDirectionFromKey(event);
      if (!direction) return;

      if (direction === 'previous' && hasPrevious) {
        event.preventDefault();
        void handlePreviousEpisode();
      } else if (direction === 'next' && hasNext) {
        event.preventDefault();
        void handleNextEpisode();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    hasPrevious,
    hasNext,
    isHydrating,
    showFutureConfirm,
    isLoadingEpisode,
    handlePreviousEpisode,
    handleNextEpisode,
  ]);

  const toggleSeen = async () => {
    let currentShow = activeShow;
    if (!currentShow || !currentShow.id) {
      const effectiveTmdb = tmdbShowId || activeShow?.tmdbId;
      if (!effectiveTmdb) return;
      const titleToUse = tmdbShowTitle || activeShow?.title || 'Série';
      const newShowData = {
        tmdbId: effectiveTmdb,
        title: titleToUse,
        mediaType: 'tv' as const,
        status: 'watching' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        posterPath: activeShow?.posterPath || null,
        backdropPath: activeShow?.backdropPath || null,
        seenEpisodes: [],
        episodeRecords: {},
        isArchived: false,
      };
      const newId = await addShow(newShowData);
      currentShow = { ...newShowData, id: newId, userId: '' };
    }

    if (!currentShow || !currentShow.id) return;

    const prevSeenEpisodes = currentShow.seenEpisodes || [];
    const prevEpisodeRecords = currentShow.episodeRecords || {};
    const prevLastWatchedAt = currentShow.lastWatchedAt || null;
    const prevNextEpisodeToWatch = currentShow.nextEpisodeToWatch || null;
    const prevIsArchived = currentShow.isArchived || false;

    const newSeen = new Set(prevSeenEpisodes);
    const newRecords = { ...prevEpisodeRecords };

    const wasSeen = newSeen.has(epKey);
    if (wasSeen) {
      newSeen.delete(epKey);
      delete newRecords[epKey];
    } else {
      newSeen.add(epKey);
      newRecords[epKey] = {
        watchedAt: Date.now(),
        episodeTitle: currentEpisode?.name || null,
        source: VIEWING_SOURCE_SEENIT
      };
    }

    let optimisticNextEp = currentShow.nextEpisodeToWatch;
    const totalEps = currentShow.totalAiredEpisodes || currentShow.totalEpisodes || 0;
    const newSeenArray = Array.from(newSeen as Set<string>);

    if (wasSeen) {
      if (!optimisticNextEp || currentSeason < optimisticNextEp.season_number || (currentSeason === optimisticNextEp.season_number && currentEpisode.episode_number < optimisticNextEp.episode_number)) {
        optimisticNextEp = {
          season_number: currentSeason,
          episode_number: currentEpisode.episode_number,
          air_date: currentEpisode.air_date || null,
          name: currentEpisode.name || null,
          still_path: currentEpisode.still_path || null
        };
      }
    } else {
      if (totalEps > 0 && newSeenArray.length >= totalEps) {
        optimisticNextEp = null;
      } else if (optimisticNextEp && optimisticNextEp.season_number === currentSeason && optimisticNextEp.episode_number === currentEpisode.episode_number) {
        const effectiveTmdb = tmdbShowId || currentShow.tmdbId;
        let nextEpDetails: EpisodeDetailData | null = null;
        if (effectiveTmdb) {
          try {
            const seasonRes = await tmdb.getSeasonDetails(effectiveTmdb, currentSeason);
            if (seasonRes.ok && seasonRes.value?.episodes) {
              const nextInSeason = seasonRes.value.episodes.find((x: { episode_number: number }) => x.episode_number === currentEpisode.episode_number + 1);
              if (nextInSeason) {
                nextEpDetails = nextInSeason;
              } else {
                const nextSeasonRes = await tmdb.getSeasonDetails(effectiveTmdb, currentSeason + 1);
                if (nextSeasonRes.ok && nextSeasonRes.value?.episodes?.[0]) {
                  nextEpDetails = nextSeasonRes.value.episodes[0];
                }
              }
            }
          } catch (e) {
            appLogger.warn('tmdb', 'Épisode suivant indisponible depuis la fiche épisode', e);
          }
        }

        optimisticNextEp = {
          season_number: nextEpDetails ? nextEpDetails.season_number : currentSeason,
          episode_number: nextEpDetails ? nextEpDetails.episode_number : (currentEpisode.episode_number + 1),
          air_date: nextEpDetails?.air_date || null,
          name: nextEpDetails?.name || null,
          still_path: nextEpDetails?.still_path || null
        };
      }
    }

    const autoArchived = computeAutoArchiveStatus({
      ...currentShow,
      seenEpisodes: newSeenArray,
      nextEpisodeToWatch: optimisticNextEp
    });

    let calculatedLastWatchedAt = Date.now();
    if (!newSeen.has(epKey)) {
      let maxRemaining = 0;
      for (const ep of newSeen) {
        const t = newRecords[ep]?.watchedAt;
        if (t && typeof t === 'number' && t > maxRemaining) {
          maxRemaining = t;
        }
      }
      calculatedLastWatchedAt = maxRemaining;
    }

    await updateShow(currentShow.id, {
       seenEpisodes: Array.from(newSeen as Set<string>),
       episodeRecords: newRecords,
       lastWatchedAt: calculatedLastWatchedAt,
       updatedAt: Date.now(),
       isSynced: false,
       nextEpisodeToWatch: optimisticNextEp,
       isArchived: autoArchived
    });
    syncSingleItem(currentShow.id, true).catch(error => appLogger.warn('plex', 'Synchronisation Plex de la série impossible', error));
    scrollAllCarouselsToStart();

    const sNumStr = String(currentSeason).padStart(2, '0');
    const eNumStr = String(currentEpisode.episode_number).padStart(2, '0');
    const showTitleStr = currentShow.title || tmdbShowTitle || 'Série';

    if (wasSeen) {
      showToast(
        `« ${showTitleStr} » S${sNumStr}E${eNumStr} marqué comme non vu`,
        'info',
        currentShow,
        async () => {
          if (currentShow?.id) {
            await updateShow(currentShow.id, {
              seenEpisodes: prevSeenEpisodes,
              episodeRecords: prevEpisodeRecords,
              lastWatchedAt: prevLastWatchedAt,
              nextEpisodeToWatch: prevNextEpisodeToWatch,
              isArchived: prevIsArchived,
              updatedAt: Date.now(),
              isSynced: false
            });
            syncSingleItem(currentShow.id, true).catch(console.error);
            scrollAllCarouselsToStart();
          }
        }
      );
    } else {
      showToast(
        `« ${showTitleStr} » S${sNumStr}E${eNumStr} marqué comme vu !`,
        'success',
        currentShow,
        async () => {
          if (currentShow?.id) {
            await updateShow(currentShow.id, {
              seenEpisodes: prevSeenEpisodes,
              episodeRecords: prevEpisodeRecords,
              lastWatchedAt: prevLastWatchedAt,
              nextEpisodeToWatch: prevNextEpisodeToWatch,
              isArchived: prevIsArchived,
              updatedAt: Date.now(),
              isSynced: false
            });
            syncSingleItem(currentShow.id, true).catch(console.error);
            scrollAllCarouselsToStart();
          }
        }
      );
    }
  };

  const updateRecord = async (updates: { rating?: number, emotion?: string }) => {
     if (!activeShow?.id || !isSeen) return;
     const newRecords = { ...(activeShow.episodeRecords || {}) };
     if (!newRecords[epKey]) newRecords[epKey] = { watchedAt: Date.now(), source: VIEWING_SOURCE_SEENIT };

     newRecords[epKey] = { ...newRecords[epKey], ...updates };

     await updateShow(activeShow.id, {
        episodeRecords: newRecords,
        updatedAt: Date.now()
     });
  };


  const watchedDate = record?.watchedAt ? new Date(record.watchedAt).toLocaleDateString('fr-FR', {
    year: 'numeric', month: 'long', day: 'numeric'
  }) : null;

  const todayStr = getTodayStr();
  const isFutureEpisode = currentEpisode.air_date
    ? currentEpisode.air_date > todayStr
    : false;

  const getRelativeAirDateLabel = () => {
    if (!currentEpisode.air_date) return 'Prochainement';

    const diffDays = getCalendarDaysDiff(currentEpisode.air_date);

    if (diffDays <= 0) return 'Disponible';
    if (diffDays === 1) return 'Demain';
    if (diffDays <= 7) return `Dans ${diffDays} jours`;
    return `le ${formatAirDateSafe(currentEpisode.air_date, 'short')}`;
  };

  const relativeAirDateLabel = getRelativeAirDateLabel();

  // #858 : la promesse remonte au bouton Vu, qui n'anime le succès qu'une fois le marquage terminé.
  const handleMainButtonClick = () => {
    if (isFutureEpisode && !isSeen) {
      setShowFutureConfirm(true);
      return false;
    }
    return toggleSeen();
  };

  const buildRedditQuery = (communitySeriesTitle?: string | null) =>
    buildRedditEpisodeSearchQuery({
      seriesTitle: tmdbShowTitle || activeShow?.title || show?.title || '',
      communitySeriesTitle,
      originalSeriesTitle: activeShow?.originalTitle || show?.originalTitle,
      seasonNumber: currentSeason,
      episodeNumber: currentEpisode.episode_number,
      episodeTitle: currentEpisode.name,
    });

  const redditEpisodeQuery = buildRedditQuery();

  const resolveRedditQuery = async () => {
    const effectiveTmdbId = tmdbShowId || activeShow?.tmdbId || show?.tmdbId;
    if (!effectiveTmdbId) return redditEpisodeQuery;

    const englishTitleResult = await tmdb.getEnglishMediaTitle(Number(effectiveTmdbId), 'tv');
    return buildRedditQuery(englishTitleResult.ok ? englishTitleResult.value : null);
  };

  // SEENIT-UX-019 — Données de la fiche épisode du prototype : saison, soirée, rang, anti-spoiler.
  const showTmdbId = tmdbShowId || activeShow?.tmdbId;
  const seenKeys = activeShow?.seenEpisodes || [];
  const seasonEpisodes: EpisodeDetailData[] = (showTmdbId && seasonCacheRef.current[`${showTmdbId}_${currentSeason}`]) || [];
  const nextSeasonEpisodes: EpisodeDetailData[] = (showTmdbId && seasonCacheRef.current[`${showTmdbId}_${currentSeason + 1}`]) || [];
  const currentNumber = currentEpisode?.episode_number || 1;
  const episodeCode = (season: number, episode: number) => `S${String(season).padStart(2, '0')} | E${String(episode).padStart(2, '0')}`;
  const jumpToEpisode = (season: number, target: EpisodeDetailData) => {
    if (isTransitioningRef.current || isLoadingEpisode) return;
    if (season === currentSeason && target.episode_number === currentNumber) return;
    navigationRequestRef.current += 1;
    const requestId = navigationRequestRef.current;
    const forward = season > currentSeason || (season === currentSeason && target.episode_number > currentNumber);
    applyEpisodeNavigationTarget(requestId, forward ? 'next' : 'previous', { season, episode: target });
    finishNavigationRequest(requestId);
  };
  const currentIndex = seasonEpisodes.findIndex(episode => episode.episode_number === currentNumber);
  const upcomingQueue = [
    ...seasonEpisodes.slice(Math.max(0, isSeen ? currentIndex + 1 : currentIndex)).map(episode => ({ season: currentSeason, episode })),
    ...nextSeasonEpisodes.map(episode => ({ season: currentSeason + 1, episode })),
  ].filter(entry => Boolean(entry.episode.air_date) && entry.episode.air_date! <= todayStr && !seenKeys.includes(`${entry.season}x${entry.episode.episode_number}`) || (entry.season === currentSeason && entry.episode.episode_number === currentNumber && !isSeen && !isFutureEpisode));
  const evening = planEpisodes(clockMinutes, currentIndex >= 0 ? upcomingQueue : [], entry => entry.episode.runtime || currentEpisode.runtime);
  const remainingToFinish = activeShow?.totalEpisodes ? Math.max(0, activeShow.totalEpisodes - seenKeys.length) : null;
  const plannerText = `Avant minuit : ${evening.beforeMidnight} épisode${evening.beforeMidnight > 1 ? 's' : ''}.${remainingToFinish ? ` Encore ${remainingToFinish} pour finir la série` : ''} · touche un bloc pour l’ouvrir.`;
  const seasonRatings = seasonEpisodes.map(episode => episode.vote_average);
  const rank = episodeRank(seasonRatings, currentEpisode?.vote_average);
  const rankLabel = rank && currentEpisode?.vote_average ? `★ ${formatRating(Number(currentEpisode.vote_average))} · ${rank.rank === 1 ? '▲ Meilleure note de la saison' : `${rank.rank}e note sur ${rank.total}`}` : null;
  const seenInCurrentSeason = seasonEpisodes.filter(episode => seenKeys.includes(`${currentSeason}x${episode.episode_number}`)).length;
  const previousSeasonEpisodes: EpisodeDetailData[] = (showTmdbId && seasonCacheRef.current[`${showTmdbId}_${currentSeason - 1}`]) || [];
  const previousKey = currentNumber > 1 ? { season: currentSeason, episode: currentNumber - 1 } : previousSeasonEpisodes.length ? { season: currentSeason - 1, episode: Math.max(...previousSeasonEpisodes.map(episode => episode.episode_number)) } : null;
  const synopsisHidden = !isSeen && Boolean(previousKey) && !seenKeys.includes(`${previousKey!.season}x${previousKey!.episode}`) && !revealedSynopsis[epKey];
  const nextEntry = upcomingQueue.find(entry => !(entry.season === currentSeason && entry.episode.episode_number === currentNumber)) || (currentIndex >= 0 && seasonEpisodes[currentIndex + 1] ? { season: currentSeason, episode: seasonEpisodes[currentIndex + 1] } : null);
  const shortLabel = (season: number, episode: number) => season === currentSeason ? `E${episode}` : `S${season}·E${episode}`;
  const userPlatforms = readUserScopedJson<number[]>(auth.currentUser?.uid, 'platforms', []);
  useEffect(() => {
    if (!showTmdbId) return;
    let cancelled = false;
    const apply = (payload: { results?: { FR?: { flatrate?: WhereToWatchProvider[]; free?: WhereToWatchProvider[]; ads?: WhereToWatchProvider[] } } } | null) => {
      const fr = payload?.results?.FR;
      // Un seul « Netflix » même si TMDB liste aussi « Netflix Standard with Ads » (dédoublonnage par nom).
      if (!cancelled) { setStreamingProviders(dedupeProvidersByName([...(fr?.flatrate || []), ...(fr?.ads || []), ...(fr?.free || [])]).slice(0, 3)); setProvidersPayload(payload); }
    };
    const cached = tmdb.peekWatchProviders(Number(showTmdbId), 'tv');
    if (cached) apply(cached);
    else void tmdb.getWatchProviders(Number(showTmdbId), 'tv').then(result => apply(result.ok ? result.value : null));
    return () => { cancelled = true; };
  }, [showTmdbId]);
  // #255 : avec la liste exacte des épisodes du serveur, Plex n'est proposé que pour un épisode présent.
  // Liste inconnue (ancien cache, lecture échouée) : comportement antérieur, sans conclusion d'absence.
  const plexEpisodePresence = isPlexEpisodePresent(presence.plexInfo, currentSeason, Number(currentEpisode?.episode_number));
  const plexAvailable = Boolean(presence.plexInfo?.available) && plexEpisodePresence !== false;
  const originRow = originalBroadcasterRow(providersPayload, (tmdb.peekRenderableMediaDetails(Number(showTmdbId), 'tv') as { homepage?: string | null } | null)?.homepage);
  const watchProviders: WhereToWatchProvider[] = [...streamingProviders, ...(plexAvailable ? [{ provider_id: 999999, provider_name: 'Plex', isPlex: true, serverName: presence.plexInfo?.serverName }] : [])];
  const openPlex = () => { void openPlexWatchUrl(activeShow || { tmdbId: showTmdbId, imdbId: activeShow?.imdbId, title: activeShow?.title || tmdbShowTitle, mediaType: 'tv' }); };
  const seenThenNext = async () => { if (!isSeen) await toggleSeen(); void handleNextEpisode(); };

  // Retour terrain du 09/11 (« absence de nav bar sur la fiche épisode ») : comme la fiche média, la fiche épisode
  // garde la barre de navigation (couche non bloquante, `data-media-layer`). Revue Codex #921 : non bloquante, elle
  // garde son z-index déclaré ; z-[155] la place au-dessus de la fiche série (z-150) et sous la barre (z-160), et la
  // réserve de hauteur de la barre est rétablie pour son contenu (index.css).
  return (
    <DialogLayer ref={dialogRootRef} onDismiss={onClose} label="Détail de l’épisode" historyMode="external" role="dialog" blocking={false} data-media-layer="" data-episode-detail="" className="fixed inset-0 z-[155] flex flex-col items-center">
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        onClick={onClose}
      />

      {/* Modal Content */}
      <motion.div
        className="relative bg-zinc-950 w-full max-w-md h-full overflow-hidden flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        initial={{ y: 18, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 18, opacity: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      >

        {/* Season Transition Toast Banner */}
        <AnimatePresence>
          {seasonChangeNotice && (
            <motion.div
              initial={{ opacity: 0, y: -25, scale: 0.85 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -15, scale: 0.9 }}
              transition={{ type: 'spring', damping: 20, stiffness: 350 }}
              style={{ top: '68px' }}
              className="absolute left-1/2 -translate-x-1/2 z-50 bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-500 text-black px-4 py-2 rounded-full font-black text-xs shadow-[0_4px_30px_rgba(245,158,11,0.6)] flex items-center gap-2 border border-amber-300 pointer-events-none uppercase tracking-wider whitespace-nowrap max-w-[92%]"
            >
              <Sparkles size={16} className="text-black shrink-0" />
              <span className="whitespace-nowrap">{seasonChangeNotice.type === 'next' ? '🍿 Passage à la' : '🎬 Retour à la'} Saison {seasonChangeNotice.season}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Swipe Visual Previews (Uniquement lors d'un changement de saison) */}
        <div className="absolute inset-0 pointer-events-none z-50 overflow-hidden">
          {isPrevSeasonChange && (
            <motion.div
              style={{ opacity: opacityPrev, scale: scalePrev, x: xPrev }}
              className="absolute left-6 top-1/2 -translate-y-1/2 flex flex-col items-center gap-2"
            >
              <div className="w-14 h-14 rounded-full bg-zinc-900 border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.25)]">
                <ChevronLeft size={28} />
              </div>
              <div className="bg-zinc-900 px-3 py-1.5 rounded-full border border-amber-500/30 flex flex-col items-center shadow-lg">
                <span className="text-[9px] font-black text-amber-400 uppercase tracking-widest">Saison précédente</span>
                <span className="text-xs font-bold text-white">Saison {currentSeason - 1}</span>
              </div>
            </motion.div>
          )}

          {isNextSeasonChange && (
            <motion.div
              style={{ opacity: opacityNext, scale: scaleNext, x: xNext }}
              className="absolute right-6 top-1/2 -translate-y-1/2 flex flex-col items-center gap-2"
            >
              <div className="w-14 h-14 rounded-full bg-zinc-900 border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.25)]">
                <ChevronRight size={28} />
              </div>
              <div className="bg-zinc-900 px-3 py-1.5 rounded-full border border-amber-500/30 flex flex-col items-center shadow-lg">
                <span className="text-[9px] font-black text-amber-400 uppercase tracking-widest">Saison suivante</span>
                <span className="text-xs font-bold text-white">Saison {currentSeason + 1}</span>
              </div>
            </motion.div>
          )}
        </div>

        <motion.div
          className="flex-1 flex flex-col w-full h-full overflow-hidden relative bg-[#09090B]"
          drag="x"
          // Retour terrain du 09/11 : un geste d'abord vertical reste un défilement, jamais un changement d'épisode.
          dragDirectionLock
          dragControls={dragControls}
          dragListener={false}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.3}
          onPointerDown={(event) => {
            if (isTransitioningRef.current || isLoadingEpisode) return;
            if (canStartEpisodeSwipeFromTarget(event.target)) {
              dragControls.start(event);
            }
          }}
          onDrag={(_, info) => {
            if (isTransitioningRef.current || isLoadingEpisode) return;
            dragX.set(info.offset.x);
          }}
          onDragEnd={(_, info) => {
            if (isTransitioningRef.current || isLoadingEpisode) {
              animate(dragX, 0, { type: 'spring', damping: 25, stiffness: 300 });
              return;
            }
            const swipe = resolveEpisodeSwipe({ offsetX: info.offset.x, offsetY: info.offset.y, velocityX: info.velocity.x, velocityY: info.velocity.y });

            if (swipe === 'previous') {
              if (hasPrevious) {
                animate(dragX, 0, { type: 'spring', damping: 25, stiffness: 300 });
                void handlePreviousEpisode();
                return;
              }
            } else if (swipe === 'next') {
              if (hasNext) {
                animate(dragX, 0, { type: 'spring', damping: 25, stiffness: 300 });
                void handleNextEpisode();
                return;
              }
            }
            animate(dragX, 0, { type: 'spring', damping: 25, stiffness: 300 });
          }}
        >
          <AnimatePresence mode="wait" initial={false}>
            {isHydrating ? (
              <motion.div
                key="episode-hydrating"
                className="w-full h-full flex flex-col overflow-y-auto custom-scrollbar relative touch-pan-y"
                initial={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                aria-busy="true"
              >
                <div className="absolute left-3.5 right-3.5 z-30 flex items-center justify-between pointer-events-auto" style={{ top: '14px' }}>
                  <button type="button" onClick={(e) => { e.stopPropagation(); const targetTmdbId = tmdbShowId || show?.tmdbId; if (onShowClick && targetTmdbId) onShowClick(targetTmdbId, show?.mediaType || 'tv'); else onClose(); }} aria-label="Retour à la série" className="h-11 max-w-[230px] pl-2.5 pr-3.5 rounded-[22px] bg-[rgba(9,9,11,0.88)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14),0_4px_14px_rgba(0,0,0,0.4)] flex items-center gap-2 text-white active:scale-95">
                    <ArrowLeft size={18} className="text-[#E5A93D] shrink-0" />
                    <span className="min-w-0 flex flex-col text-left leading-[1.15]"><span className="text-[9px] font-extrabold tracking-[0.08em] text-zinc-400">SÉRIE</span><span className="seenit-media-title text-[13px] font-bold truncate">{show?.title || tmdbShowTitle || 'Retour'}</span></span>
                  </button>
                  <button type="button" onClick={onClose} aria-label="Fermer" className="w-11 h-11 rounded-full bg-[rgba(9,9,11,0.88)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)] flex items-center justify-center text-white active:scale-95"><X size={18} /></button>
                </div>
                <EpisodeDetailSkeleton code={`S${currentSeason.toString().padStart(2, '0')} | E${String(currentEpisode?.episode_number || initialEpisode?.episode_number || 1).padStart(2, '0')}`} title={currentEpisode?.name || initialEpisode?.name} />
              </motion.div>
            ) : (
            <motion.div
              key={`ep-${currentSeason}-${currentEpisode?.episode_number || 1}`}
              className="w-full h-full flex flex-col overflow-y-auto custom-scrollbar relative will-change-transform transform-gpu touch-pan-y"
              initial={{ opacity: 0, x: swipeDirection === 'next' ? 140 : swipeDirection === 'prev' ? -140 : 0 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: swipeDirection === 'next' ? -140 : swipeDirection === 'prev' ? 140 : 0 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
            >
            {/* Micro-spinner central pendant le chargement au lieu de faire planter l'UI */}
            {isLoadingEpisode && (
              <div className="absolute inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-200 pointer-events-auto">
                <div className="flex flex-col items-center gap-3 p-5 rounded-2xl bg-zinc-900/90 border border-white/10 shadow-2xl">
                  <div className="animate-spin h-7 w-7 border-3 border-[#E5A93D] border-t-transparent rounded-full" />
                  <span className="text-xs font-bold text-zinc-300 tracking-wide">Chargement de l'épisode...</span>
                </div>
              </div>
            )}
            {/* Boutons flottants : retour série et fermer (44 px, prototype) */}
            <div className="absolute left-3.5 right-3.5 z-30 flex items-center justify-between pointer-events-auto" style={{ top: '14px' }}>
              <button type="button" onClick={(e) => { e.stopPropagation(); const targetTmdbId = tmdbShowId || show?.tmdbId; if (onShowClick && targetTmdbId) onShowClick(targetTmdbId, show?.mediaType || 'tv'); else onClose(); }} aria-label="Retour à la série" className="h-11 max-w-[230px] pl-2.5 pr-3.5 rounded-[22px] bg-[rgba(9,9,11,0.88)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14),0_4px_14px_rgba(0,0,0,0.4)] flex items-center gap-2 text-white active:scale-95">
                <ArrowLeft size={18} className="text-[#E5A93D] shrink-0" />
                <span className="min-w-0 flex flex-col text-left leading-[1.15]"><span className="text-[9px] font-extrabold tracking-[0.08em] text-zinc-400">SÉRIE</span><span className="seenit-media-title text-[13px] font-bold truncate">{show?.title || tmdbShowTitle || 'Retour'}</span></span>
              </button>
              {/* Retour terrain du 09/11 : la cloche d'un épisode à venir est ronde, à côté de la croix. */}
              <span className="flex items-center gap-2">
                {isFutureEpisode && activeShow?.id && <EpisodeReminderBell variant="overlay" show={activeShow} episode={{ season_number: currentSeason, episode_number: currentNumber, name: currentEpisode.name, air_date: currentEpisode.air_date }} />}
                <button type="button" onClick={onClose} aria-label="Fermer" className="w-11 h-11 rounded-full bg-[rgba(9,9,11,0.88)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)] flex items-center justify-center text-white active:scale-95"><X size={18} /></button>
              </span>
            </div>

            <div className="w-full">
              <div className="relative w-full h-[250px] bg-zinc-900 overflow-hidden">
                {currentEpisode.still_path && <img loading="eager" decoding="async" src={`https://image.tmdb.org/t/p/w1280${currentEpisode.still_path}`} className="w-full h-full object-cover" style={{ objectPosition: 'center 30%' }} alt="" />}
                <div className="absolute inset-0" style={{ background: 'linear-gradient(0deg,#09090b 0%,rgba(9,9,11,0.35) 50%,rgba(9,9,11,0.3) 100%)' }} />
              </div>
              <div className="px-[18px] -mt-11 relative z-10 flex flex-col gap-3.5 pb-nav">
                <EpisodeHeaderBlock code={episodeCode(currentSeason, currentNumber)} title={currentEpisode.name || `Épisode ${currentNumber}`} airLabel={currentEpisode.air_date ? `${isFutureEpisode ? 'Diffusion le' : 'Diffusé le'} ${new Date(`${currentEpisode.air_date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}` : 'Date de diffusion inconnue'} meta={[currentEpisode.runtime ? `${currentEpisode.runtime} min` : '', isSeen && watchedDate ? `Vu le ${watchedDate}` : ''].filter(Boolean).join(' · ')} isSeen={Boolean(isSeen)} isFuture={isFutureEpisode} futureLabel={relativeAirDateLabel} onToggle={handleMainButtonClick} />

                {showFutureConfirm && (
                  <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-center space-y-3 animate-in fade-in duration-200">
                    <p className="text-xs text-amber-200 font-medium leading-relaxed">Cet épisode n'a pas encore été diffusé. Veux-tu vraiment le marquer comme vu ?</p>
                    <div className="flex gap-2 justify-center">
                      <button onClick={() => setShowFutureConfirm(false)} className="min-h-11 px-4 rounded-xl bg-zinc-800 text-zinc-300 text-xs font-semibold touch-manipulation select-none cursor-pointer">Annuler</button>
                      <button onClick={() => { setShowFutureConfirm(false); toggleSeen(); }} className="min-h-11 px-4 rounded-xl bg-[#E5A93D] text-black text-xs font-bold touch-manipulation select-none cursor-pointer">Marquer comme vu</button>
                    </div>
                  </div>
                )}

                {!isFutureEpisode && <EpisodePlannerCard heading={isSeen ? 'Vu · si tu enchaînes maintenant' : 'Si tu lances maintenant'} end={evening.plan.length ? evening.plan[0].end : ''} text={plannerText}
                  blocks={evening.plan.map(entry => ({ key: `${entry.item.season}x${entry.item.episode.episode_number}`, label: shortLabel(entry.item.season, entry.item.episode.episode_number), runtime: entry.runtime, end: entry.end, onPick: () => jumpToEpisode(entry.item.season, entry.item.episode) }))} />}

                <SeasonCurveCard label={`Saison ${currentSeason} · ${seenInCurrentSeason}/${seasonEpisodes.length} vus`} rankLabel={rankLabel}
                  cells={seasonEpisodes.map(episode => ({ n: episode.episode_number, rating: Number(episode.vote_average) > 0 ? Number(episode.vote_average) : null, seen: seenKeys.includes(`${currentSeason}x${episode.episode_number}`), current: episode.episode_number === currentNumber, onPick: () => jumpToEpisode(currentSeason, episode) }))} />

                <SpoilerSynopsis text={currentEpisode.overview} hidden={synopsisHidden} why={previousKey ? `Tu n’as pas vu ${episodeCode(previousKey.season, previousKey.episode)}` : ''} onReveal={() => setRevealedSynopsis(current => ({ ...current, [epKey]: true }))} expanded={isSynopsisExpanded} onToggle={() => setIsSynopsisExpanded(!isSynopsisExpanded)} />

                {!isSeen && !isFutureEpisode && hasNext && nextEntry && <button type="button" onClick={() => void seenThenNext()} disabled={isLoadingEpisode} className="h-[52px] px-4 rounded-2xl bg-[#18181b] shadow-[inset_0_0_0_1px_#3f3f46] flex items-center justify-center gap-1.5 text-[14px] font-bold text-white active:scale-[0.98]">Vu, puis {shortLabel(nextEntry.season, nextEntry.episode.episode_number)} ›</button>}

                {isSeen && <ReactionRow value={record?.emotion} onPick={emotion => void updateRecord({ emotion: record?.emotion === emotion ? '' : emotion })} />}
                {isSeen && hasNext && nextEntry && <button type="button" onClick={() => void handleNextEpisode()} className="flex items-center gap-3 p-3 rounded-[18px] bg-[rgba(24,24,27,0.7)] shadow-[inset_0_0_0_1px_rgba(229,169,61,0.35)] text-left active:scale-[0.99]">
                  <span className="w-24 aspect-video rounded-[9px] overflow-hidden bg-zinc-800 shrink-0">{nextEntry.episode.still_path && <img src={`https://image.tmdb.org/t/p/w300${nextEntry.episode.still_path}`} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />}</span>
                  <span className="flex-1 min-w-0 flex flex-col gap-0.5"><span className="text-[12px] font-bold text-[#E5A93D]">Ensuite · {shortLabel(nextEntry.season, nextEntry.episode.episode_number)}</span><span className="text-[15px] font-bold text-white truncate">{nextEntry.episode.name}</span>{Number(nextEntry.episode.runtime) > 0 ? <span className="text-[12px] text-zinc-400">{Number(nextEntry.episode.runtime)} min · fin à {formatClock(clockMinutes + Number(nextEntry.episode.runtime))}</span> : null}</span>
                  <span className="text-[18px] text-[#E5A93D]" aria-hidden="true">›</span>
                </button>}

                {/* Retour terrain du 08/11 : un épisode à venir d'une série suivie a sa cloche de rappel (en-tête depuis le 09/11). */}
                {/* Retour terrain du 08/11 : depuis la fiche épisode, on programme aussi son téléchargement. */}
                {isFutureEpisode ? <>{!activeShow?.id && <div className="min-h-11 rounded-2xl flex items-center justify-center gap-2 bg-[rgba(24,24,27,0.7)] text-zinc-400 text-[13px] font-bold"><Clock size={16} className="text-zinc-500" />Bientôt disponible</div>}
                  <EpisodeProgramCard title={tmdbShowTitle || activeShow?.title || ''} tmdbId={tmdbShowId || activeShow?.tmdbId} tvdbId={activeShow?.tvdbId} imdbId={activeShow?.imdbId} season={currentSeason} episode={currentNumber} presence={presence} posterPath={activeShow?.posterPath || null} /></>
                  : (watchProviders.length > 0 || originRow) && <WhereToWatchCard providers={watchProviders} loading={false} userPlatforms={userPlatforms} title={activeShow?.title || tmdbShowTitle || ''} onOpenPlex={openPlex} origin={originRow} emptyLabel="" />}

                <RedditSection
                  query={redditEpisodeQuery}
                  resolveQuery={resolveRedditQuery}
                  isLocked={!isSeen}
                  unlockMessage="Débloquez les discussions de la communauté sur cet épisode en le marquant comme vu."
                />

                <EpisodeNavRow prevLabel={hasPrevious ? (currentNumber > 1 ? `E${currentNumber - 1}` : `S${currentSeason - 1}`) : 'Début'} nextLabel={hasNext ? (nextEntry ? shortLabel(nextEntry.season, nextEntry.episode.episode_number) : 'Suivant') : 'Fin'} hasPrevious={hasPrevious} hasNext={hasNext} disabled={isLoadingEpisode} onPrevious={() => void handlePreviousEpisode()} onNext={() => void handleNextEpisode()} />
              </div>
            </div>
          </motion.div>
            )}
        </AnimatePresence>
      </motion.div>
    </motion.div>

  </DialogLayer>
  );
}
