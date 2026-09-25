import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, animate, useDragControls } from 'motion/react';
import { type Show } from '../types';
import { X, Check, Star, ChevronLeft, ChevronRight, Clock, ArrowLeft, Sparkles, Download, CheckCircle2, Play } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { cn, computeAutoArchiveStatus, formatAirDateSafe, formatVoteCount, getTodayStr, getCalendarDaysDiff, scrollAllCarouselsToStart, openExternalUrl } from '../lib/utils';
import { useShows } from '../hooks/useShows';
import { useToastStore } from '../store/toastStore';
import { tmdb } from '../features/shows/tmdb';
import { syncSingleItem } from "../hooks/useDetailsSyncWorker";
import { RedditSection } from '../components/community/RedditSection';
import { buildRedditEpisodeSearchQuery } from '../components/community/redditEpisodeSearch';
import { DownloadModal, type SeasonInfo } from '../components/DownloadModal';
import { useLiveDownloadStore } from '../store/liveDownloadStore';
import { LiveDownloadBanner } from '../components/LiveDownloadBanner';
import { useMediaPresence } from '../hooks/useMediaPresence';
import { openPlexWatchUrl } from '../features/plex/syncPlex';
import { type EpisodeDetailData } from './episodeDetailTypes';
import {
  canStartEpisodeSwipeFromTarget,
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
  const [currentSeason, setCurrentSeason] = useState(initialSeason);
  const [currentEpisode, setCurrentEpisode] = useState(initialEpisode);
  const [isSynopsisExpanded, setIsSynopsisExpanded] = useState(false);
  const [isLoadingEpisode, setIsLoadingEpisode] = useState(false);

  const [showFutureConfirm, setShowFutureConfirm] = useState(false);
  const [isDownloadOpen, setIsDownloadOpen] = useState(false);

  const { shows, addShow, updateShow } = useShows();
  const { showToast } = useToastStore();

  const { getEpisodeDownload } = useLiveDownloadStore();

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
      if (isHydrating || isDownloadOpen || showFutureConfirm || isLoadingEpisode) return;
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
    isDownloadOpen,
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
        episodeTitle: currentEpisode?.name || null
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
        let nextEpDetails: any = null;
        if (effectiveTmdb) {
          try {
            const seasonRes = await tmdb.getSeasonDetails(effectiveTmdb, currentSeason);
            if (seasonRes.ok && seasonRes.value?.episodes) {
              const nextInSeason = seasonRes.value.episodes.find((x: any) => x.episode_number === currentEpisode.episode_number + 1);
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
            console.error('Error fetching next ep in modal:', e);
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
    syncSingleItem(currentShow.id, true).catch(console.error);
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
     if (!newRecords[epKey]) newRecords[epKey] = { watchedAt: Date.now() };

     newRecords[epKey] = { ...newRecords[epKey], ...updates };

     await updateShow(activeShow.id, {
        episodeRecords: newRecords,
        updatedAt: Date.now()
     });
  };

  const formattedAirDate = currentEpisode.air_date ? formatAirDateSafe(currentEpisode.air_date, 'long') : 'Inconnue';

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

  const handleMainButtonClick = () => {
    if (isSeen) {
      toggleSeen();
    } else if (isFutureEpisode) {
      setShowFutureConfirm(true);
    } else {
      toggleSeen();
    }
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

  const activeShowSeasonMeta = activeShow as (Show & {
    numberOfSeasons?: number;
    seasonsCount?: number;
    seasons?: SeasonInfo[];
  }) | undefined;

  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center">
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
              style={{ top: 'calc(env(safe-area-inset-top, 0px) + 68px)' }}
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
            const offset = info.offset.x;
            const velocity = info.velocity.x;

            if (offset > 60 || velocity > 200) {
              if (hasPrevious) {
                animate(dragX, 0, { type: 'spring', damping: 25, stiffness: 300 });
                void handlePreviousEpisode();
                return;
              }
            } else if (offset < -60 || velocity < -200) {
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
                <div className="absolute left-4 right-4 z-30 flex items-center justify-between pointer-events-auto" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 14px)' }}>
                  <button type="button" onClick={(e) => {
                    e.stopPropagation();
                    const targetTmdbId = tmdbShowId || show?.tmdbId;
                    if (onShowClick && targetTmdbId) onShowClick(targetTmdbId, show?.mediaType || 'tv');
                    else onClose();
                  }} className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-zinc-900/85 backdrop-blur-md border border-white/10 text-white active:scale-95 transition-all max-w-[200px] group shadow-lg">
                    <ArrowLeft size={16} className="text-[#E5A93D] shrink-0" />
                    <div className="flex flex-col text-left overflow-hidden leading-tight">
                      <span className="text-[9px] uppercase tracking-wider text-zinc-400 font-bold -mb-0.5">Série</span>
                      <span className="text-xs font-semibold truncate max-w-[140px]">{show?.title || tmdbShowTitle || 'Retour'}</span>
                    </div>
                  </button>
                  <button type="button" onClick={onClose} className="w-9 h-9 rounded-full bg-zinc-900/85 backdrop-blur-md border border-white/10 flex items-center justify-center text-zinc-300 active:scale-95 transition-all shadow-lg" aria-label="Fermer"><X size={18} /></button>
                </div>
                <div className="w-full">
                  <div className="relative w-full h-[280px] sm:h-[340px] bg-zinc-900 overflow-hidden"><div className="absolute inset-0 bg-gradient-to-t from-[#09090B] via-[#09090B]/40 to-transparent" /></div>
                  <div className="px-5 -mt-16 relative z-10 space-y-4 pb-nav">
                    <div className="space-y-3">
                      <span className="inline-block px-3 py-1 rounded-full text-[10px] font-bold bg-zinc-800/80 text-zinc-300 border border-white/10">S{currentSeason.toString().padStart(2, '0')} | E{String(currentEpisode?.episode_number || initialEpisode?.episode_number || 1).padStart(2, '0')}</span>
                      <div className="h-9 w-4/5 max-w-[280px] rounded-lg bg-zinc-800/80" aria-hidden="true" />
                      <div className="text-[#E5A93D] text-sm font-bold uppercase tracking-wider">{show?.title || tmdbShowTitle || 'Série'}</div>
                    </div>
                    <div className="h-14 w-full rounded-2xl bg-zinc-800/80" aria-hidden="true" />
                    <div className="space-y-2 pt-2" aria-hidden="true">
                      <div className="h-3.5 w-full rounded bg-zinc-800/80" />
                      <div className="h-3.5 w-11/12 rounded bg-zinc-800/80" />
                      <div className="h-3.5 w-4/5 rounded bg-zinc-800/80" />
                    </div>
                  </div>
                </div>
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
            {/* 1. FLOATING BUTTONS (Positioned over the banner with safe-area support) */}
            <div
              className="absolute left-4 right-4 z-30 flex items-center justify-between pointer-events-auto"
              style={{ top: 'calc(env(safe-area-inset-top, 0px) + 14px)' }}
            >
              {/* Series Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const targetTmdbId = tmdbShowId || show?.tmdbId;
                  if (onShowClick && targetTmdbId) {
                    onShowClick(targetTmdbId, show?.mediaType || 'tv');
                  } else {
                    onClose();
                  }
                }}
                className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-zinc-900/85 backdrop-blur-md border border-white/10 text-white active:scale-95 transition-all max-w-[200px] group shadow-lg"
              >
                <ArrowLeft size={16} className="text-[#E5A93D] shrink-0 group-hover:-translate-x-0.5 transition-transform" />
                <div className="flex flex-col text-left overflow-hidden leading-tight">
                  <span className="text-[9px] uppercase tracking-wider text-zinc-400 font-bold -mb-0.5">Série</span>
                  <span className="text-xs font-semibold truncate max-w-[140px]">{show?.title || tmdbShowTitle || 'Retour'}</span>
                </div>
              </button>

              {/* Close Button */}
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-full bg-zinc-900/85 backdrop-blur-md border border-white/10 flex items-center justify-center text-zinc-300 hover:text-white active:scale-95 transition-all shadow-lg"
                aria-label="Fermer"
              >
                <X size={18} />
              </button>
            </div>

            {/* 2. FREELY SCROLLING CONTENT */}
            <div className="w-full">
              {/* Banner Section */}
              <div className="relative w-full h-[280px] sm:h-[340px] bg-zinc-900 overflow-hidden">
                {currentEpisode.still_path && (
                  <img loading="lazy" decoding="async"
                    src={`https://image.tmdb.org/t/p/w1280${currentEpisode.still_path}`}
                    className="w-full h-full object-cover"
                    alt=""
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-[#09090B] via-[#09090B]/40 to-transparent" />
              </div>

              {/* Info & Content Section */}
              <div className="px-5 -mt-16 relative z-10 space-y-4 pb-nav">
                {/* Badge + Titre + Nom Série */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-block px-3 py-1 backdrop-blur-md rounded-full text-[10px] font-bold bg-zinc-800/80 text-zinc-300 border border-white/10">
                      S{currentSeason.toString().padStart(2, '0')} | E{currentEpisode.episode_number.toString().padStart(2, '0')}
                    </span>
                    {currentEpisode?.vote_average ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 backdrop-blur-md rounded-full text-[10px] font-bold bg-zinc-800/80 text-blue-400 border border-blue-500/30">
                        <Star size={11} className="fill-[#01b4e4] text-[#01b4e4] shrink-0" />
                        <span className="text-zinc-100 font-extrabold">{Number(currentEpisode.vote_average).toFixed(1)}</span>
                        <span className="bg-blue-500/20 text-blue-300 px-1 py-0.2 rounded font-black text-[9px]">TMDB</span>
                        {currentEpisode.vote_count ? (
                          <span className="text-zinc-500 font-medium">({formatVoteCount(currentEpisode.vote_count)})</span>
                        ) : null}
                      </span>
                    ) : null}
                  </div>
                  <h1 className="text-3xl font-extrabold text-white leading-tight">
                    {currentEpisode.name}
                  </h1>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const targetTmdbId = tmdbShowId || show?.tmdbId;
                      if (onShowClick && targetTmdbId) {
                        onShowClick(targetTmdbId, show?.mediaType || 'tv');
                      } else {
                        onClose();
                      }
                    }}
                    className="text-[#E5A93D] hover:text-[#f0c05a] text-sm font-bold transition-colors flex items-center gap-1.5 group uppercase tracking-wider"
                  >
                    {show?.title || tmdbShowTitle || 'Série'}
                  </button>
                </div>

                <div className="space-y-6">
                  <nav aria-label="Navigation entre épisodes" className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      aria-label="Épisode précédent"
                      disabled={!hasPrevious || isLoadingEpisode}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handlePreviousEpisode();
                      }}
                      className="min-h-[44px] px-3 rounded-xl border border-white/10 bg-zinc-900/85 text-zinc-200 flex items-center justify-center gap-2 text-xs font-bold transition-colors hover:bg-zinc-800 disabled:opacity-35 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft size={18} aria-hidden="true" />
                      <span>Précédent</span>
                    </button>
                    <button
                      type="button"
                      aria-label="Épisode suivant"
                      disabled={!hasNext || isLoadingEpisode}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleNextEpisode();
                      }}
                      className="min-h-[44px] px-3 rounded-xl border border-white/10 bg-zinc-900/85 text-zinc-200 flex items-center justify-center gap-2 text-xs font-bold transition-colors hover:bg-zinc-800 disabled:opacity-35 disabled:cursor-not-allowed"
                    >
                      <span>Suivant</span>
                      <ChevronRight size={18} aria-hidden="true" />
                    </button>
                  </nav>

                  {/* Main Action Button (Pleine largeur) */}
                  <div>
                    {isSeen ? (
                      <button
                        onClick={handleMainButtonClick}
                        className="w-full py-4 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-[0.98] bg-emerald-500 hover:bg-emerald-400 text-black font-bold shadow-lg shadow-emerald-500/20 touch-manipulation select-none cursor-pointer"
                      >
                        <Check size={22} className="stroke-[3]" />
                        Épisode vu
                      </button>
                    ) : isFutureEpisode ? (
                      <button
                        onClick={handleMainButtonClick}
                        className="w-full py-4 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-[0.98] bg-zinc-800 text-zinc-400 border border-zinc-700 font-medium cursor-pointer hover:bg-zinc-700 touch-manipulation select-none"
                      >
                        <Clock size={20} className="text-amber-400" />
                        {relativeAirDateLabel}
                      </button>
                    ) : (
                      <button
                        onClick={handleMainButtonClick}
                        className="w-full py-4 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-[0.98] bg-[#E5A93D] hover:bg-[#d4982f] text-black font-bold shadow-lg shadow-[#E5A93D]/20 touch-manipulation select-none cursor-pointer"
                      >
                        <Check size={22} className="stroke-[3]" />
                        Marquer comme vu
                      </button>
                    )}
                  </div>

                  {/* Bouton Télécharger l'épisode ou Badge de Disponibilité */}
                  {(() => {
                    const isUnreleased = currentEpisode?.air_date ? new Date(currentEpisode.air_date).getTime() > Date.now() : false;
                    if (isUnreleased) {
                      return (
                        <div className="w-full py-3 px-4 rounded-2xl flex items-center justify-center gap-2.5 bg-zinc-800/50 border border-zinc-700 text-zinc-400 font-bold text-xs shadow-sm select-none">
                          <Clock size={16} className="text-zinc-500 shrink-0" />
                          <span>Bientôt disponible</span>
                        </div>
                      );
                    }

                    const epKey = `S${currentSeason}E${currentEpisode?.episode_number}`;
                    const isEpisodeAvailable = presence.episodesHasFile[epKey] || presence.seasonsHasFile[currentSeason] || (presence.hasFile && (presence.plexInfo?.available || presence.sonarrHasFile));

                    if (isEpisodeAvailable) {
            if (presence.plexInfo?.available) {
              return (
                <div className="flex flex-col items-center gap-2.5 w-full">
                  <button
                    type="button"
                    onClick={() => {
                      const targetTmdbId = tmdbShowId || activeShow?.tmdbId;
                      void openPlexWatchUrl(activeShow || {
                        tmdbId: targetTmdbId,
                        imdbId: activeShow?.imdbId,
                        title: activeShow?.title || tmdbShowTitle,
                        mediaType: 'tv'
                      });
                    }}
                    className="w-full py-3.5 px-4 rounded-2xl flex items-center justify-center gap-2.5 transition-all active:scale-[0.98] bg-[#E5A93D] hover:bg-[#d4982f] text-black font-extrabold text-sm cursor-pointer shadow-lg shadow-[#E5A93D]/15 touch-manipulation select-none"
                    aria-label="Regarder cet épisode dans Plex"
                  >
                    <Play size={18} className="fill-black shrink-0" />
                    <span>Regarder dans Plex</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsDownloadOpen(true)}
                    className="inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] font-semibold text-zinc-500 hover:text-blue-400 transition-colors active:scale-95 touch-manipulation select-none"
                  >
                    <Download size={12} className="shrink-0" />
                    <span className="sr-only">Télécharger à nouveau</span>
                  </button>
                </div>
              );
            }

            return (
              <div className="flex flex-col items-center gap-2 w-full">
                <div className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-semibold text-[10px] select-none">
                  <CheckCircle2 size={13} className="shrink-0" />
                  <span>Téléchargé</span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsDownloadOpen(true)}
                  className="inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] font-semibold text-zinc-500 hover:text-blue-400 transition-colors active:scale-95 touch-manipulation select-none"
                >
                  <Download size={12} className="shrink-0" />
                  <span>Télécharger à nouveau</span>
                </button>
              </div>
            );
          }

                    return (
                      <button
                        type="button"
                        onClick={() => setIsDownloadOpen(true)}
                        className="w-full py-3 px-4 rounded-2xl flex items-center justify-center gap-2.5 transition-all active:scale-[0.98] bg-blue-600/15 hover:bg-blue-600/25 border border-blue-500/30 text-blue-400 font-bold text-xs cursor-pointer shadow-sm touch-manipulation select-none"
                      >
                        <Download size={16} className="text-blue-400 shrink-0" />
                        <span>Télécharger S{String(currentSeason).padStart(2, '0')}E{String(currentEpisode.episode_number).padStart(2, '0')}</span>
                      </button>
                    );
                  })()}

                  {/* Single Episode Live Download Banner */}
                  {(() => {
                    const epDownload = getEpisodeDownload(tmdbShowId || activeShow?.tmdbId, activeShow?.tvdbId, currentSeason, currentEpisode?.episode_number);
                    if (!epDownload) return null;
                    return (
                      <div className="mt-2">
                        <LiveDownloadBanner items={[epDownload]} />
                      </div>
                    );
                  })()}

                  {/* Synopsis - Interactif & Déroulable */}
                  {currentEpisode.overview && (
                    <div className="mt-2 mb-2 animate-in fade-in duration-700">
                      <p
                        onClick={() => setIsSynopsisExpanded(!isSynopsisExpanded)}
                        className={cn(
                          "text-[13px] text-zinc-300 leading-relaxed cursor-pointer transition-all duration-300 ease-in-out",
                          !isSynopsisExpanded && "line-clamp-3"
                        )}
                      >
                        {currentEpisode.overview}
                      </p>
                      {!isSynopsisExpanded && currentEpisode.overview.length > 120 && (
                        <button
                          onClick={() => setIsSynopsisExpanded(true)}
                          className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-500 mt-1 hover:text-white transition-colors cursor-pointer"
                        >
                          Suite...
                        </button>
                      )}
                    </div>
                  )}

                  {/* Custom Future Episode Confirmation Dialog */}
                  {showFutureConfirm && (
                    <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-center space-y-3 animate-in fade-in duration-200">
                      <p className="text-xs text-amber-200 font-medium leading-relaxed">
                        Cet épisode n'a pas encore été diffusé. Veux-tu vraiment le marquer comme vu ?
                      </p>
                      <div className="flex gap-2 justify-center">
                        <button
                          onClick={() => setShowFutureConfirm(false)}
                          className="px-4 py-2.5 rounded-xl bg-zinc-800 text-zinc-300 text-xs font-semibold hover:bg-zinc-700 transition-colors touch-manipulation select-none cursor-pointer"
                        >
                          Annuler
                        </button>
                        <button
                          onClick={() => {
                            setShowFutureConfirm(false);
                            toggleSeen();
                          }}
                          className="px-4 py-2.5 rounded-xl bg-[#E5A93D] text-black text-xs font-bold hover:bg-[#d4982f] transition-colors touch-manipulation select-none cursor-pointer"
                        >
                          Marquer comme vu
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Dates */}
                  <div className="grid grid-cols-2 gap-4">
                     <div className="bg-zinc-900 p-3 rounded-xl border border-zinc-800/50">
                       <span className="block text-[10px] uppercase text-zinc-500 font-bold mb-1">Diffusé le</span>
                       <span className="text-sm font-medium text-zinc-200">{formattedAirDate}</span>
                     </div>
                     <div className="bg-zinc-900 p-3 rounded-xl border border-zinc-800/50">
                       <span className="block text-[10px] uppercase text-zinc-500 font-bold mb-1">Vu le</span>
                       <span className="text-sm font-medium text-zinc-200">{isSeen ? (watchedDate || '--') : '--'}</span>
                     </div>
                  </div>

                  <RedditSection
                    query={redditEpisodeQuery}
                    resolveQuery={resolveRedditQuery}
                    isLocked={!isSeen}
                    unlockMessage="Débloquez les discussions de la communauté sur cet épisode en le marquant comme vu."
                  />
                </div>
              </div>
            </div>
          </motion.div>
            )}
        </AnimatePresence>
      </motion.div>
    </motion.div>

    <DownloadModal
      isOpen={isDownloadOpen}
      onClose={() => setIsDownloadOpen(false)}
      title={activeShow?.title || tmdbShowTitle || 'Série'}
      mediaType="tv"
      tmdbId={tmdbShowId || activeShow?.tmdbId}
      tvdbId={activeShow?.tvdbId}
      imdbId={activeShow?.imdbId}
      initialSeason={currentSeason}
      initialEpisode={currentEpisode.episode_number}
      totalSeasons={activeShowSeasonMeta?.numberOfSeasons || activeShowSeasonMeta?.seasonsCount || activeShowSeasonMeta?.seasons?.length || 1}
      seasonsData={activeShowSeasonMeta?.seasons}
      onSuccessToast={showToast}
    />
  </div>
  );
}
