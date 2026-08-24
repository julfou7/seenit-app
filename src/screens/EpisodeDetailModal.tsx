import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'motion/react';
import { type Show } from '../types';
import { X, Check, Star, ChevronLeft, ChevronRight, Clock, ArrowLeft, Sparkles } from 'lucide-react';
import { cn, computeAutoArchiveStatus, formatAirDateSafe, formatVoteCount, getTodayStr, getCalendarDaysDiff, scrollAllCarouselsToStart } from '../lib/utils';
import { useShows } from '../hooks/useShows';
import { useToastStore } from '../store/toastStore';
import { tmdb } from '../features/shows/tmdb';
import { syncSingleItem } from "../hooks/useDetailsSyncWorker";
import { getSeasonImdbRatings, getEpisodeImdbVotes } from '../features/shows/omdbService';
import { RedditSection } from '../components/community/RedditSection';

interface EpisodeDetailModalProps {
  show?: Show;
  season: number;
  episode: any;
  tmdbShowTitle?: string;
  tmdbShowId?: number;
  onShowClick?: (tmdbId: number, mediaType?: 'tv' | 'movie') => void;
  onClose: () => void;
  onLoadSeason?: (seasonNum: number) => Promise<any>;
}

export function EpisodeDetailModal({ show, season: initialSeason, episode: initialEpisode, tmdbShowTitle, tmdbShowId, onShowClick, onClose, onLoadSeason }: EpisodeDetailModalProps) {
  const [currentSeason, setCurrentSeason] = useState(initialSeason);
  const [currentEpisode, setCurrentEpisode] = useState(initialEpisode);
  const [isSynopsisExpanded, setIsSynopsisExpanded] = useState(false);
  const [isLoadingEpisode, setIsLoadingEpisode] = useState(false);

  const [showFutureConfirm, setShowFutureConfirm] = useState(false);

  const { shows, addShow, updateShow } = useShows();
  const { showToast } = useToastStore();

  // Find live show from Zustand store so updates are instantly reactive
  const liveShow = shows.find(s => 
    (show?.id && s.id === show.id) || 
    (show?.tmdbId && s.tmdbId === show.tmdbId) || 
    (tmdbShowId && s.tmdbId === tmdbShowId)
  );
  const activeShow = liveShow || show;

  const seasonCacheRef = useRef<Record<string, any[]>>({});
  const episodeCacheRef = useRef<Record<string, any>>({});
  const imagePreloadRef = useRef<Record<string, HTMLImageElement>>({});
  const isTransitioningRef = useRef(false);

  const fetchAndCacheSeason = useCallback(async (seasonNum: number) => {
    const effectiveTmdbId = tmdbShowId || activeShow?.tmdbId;
    if (!effectiveTmdbId || seasonNum < 1) return null;
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
        episodes.forEach((ep: any) => {
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
    if (!effectiveTmdbId || season < 1 || epNum < 1) return;
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

  useEffect(() => {
    setCurrentSeason(initialSeason);
    setCurrentEpisode(initialEpisode);
    setShowFutureConfirm(false);
  }, [initialSeason, initialEpisode]);

  const [currentSeasonEpCount, setCurrentSeasonEpCount] = useState<number | null>(null);
  const [nextSeasonEpCount, setNextSeasonEpCount] = useState<number | null>(null);
  const [episodeImdbRating, setEpisodeImdbRating] = useState<number | null>(null);
  const [episodeImdbVotes, setEpisodeImdbVotes] = useState<string | null>(null);

  // Fetch episode IMDb rating when season/episode or show changes
  useEffect(() => {
    let isMounted = true;
    const imdbId = activeShow?.imdbId;
    const epNum = currentEpisode?.episode_number;

    if (imdbId && currentSeason && epNum) {
      getSeasonImdbRatings(imdbId, currentSeason).then(ratings => {
        if (!isMounted) return;
        const epData = ratings[epNum];
        if (epData && epData.rating > 0) {
          setEpisodeImdbRating(epData.rating);
          if (epData.imdbId) {
            getEpisodeImdbVotes(epData.imdbId).then(votes => {
              if (isMounted && votes) setEpisodeImdbVotes(votes);
            });
          }
        } else {
          setEpisodeImdbRating(null);
          setEpisodeImdbVotes(null);
        }
      }).catch(() => {
        if (isMounted) {
          setEpisodeImdbRating(null);
          setEpisodeImdbVotes(null);
        }
      });
    } else {
      setEpisodeImdbRating(null);
      setEpisodeImdbVotes(null);
    }

    return () => { isMounted = false; };
  }, [activeShow?.imdbId, currentSeason, currentEpisode?.episode_number]);

  const [swipeDirection, setSwipeDirection] = useState<'next' | 'prev' | null>(null);
  const isSwipingRef = useRef(false);
  const dragX = useMotionValue(0);

  // Reset gesture state whenever currentSeason or currentEpisode changes
  useEffect(() => {
    dragX.set(0);
    isSwipingRef.current = false;
    isTransitioningRef.current = false;
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
    if (!effectiveTmdbId || !currentSeason || !currentEpisode?.episode_number) return;

    let isMounted = true;

    // Cache current season & update count
    fetchAndCacheSeason(currentSeason).then(episodes => {
      if (isMounted && episodes) {
        setCurrentSeasonEpCount(episodes.length);
        const curEpNum = currentEpisode.episode_number;
        const found = episodes.find((e: any) => e.episode_number === curEpNum);
        if (found && (!currentEpisode.overview || !currentEpisode.still_path)) {
          setCurrentEpisode((prev: any) => ({
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
    if (currentSeason > 1) {
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
        if (curEpNum < cachedCur.length) return true;
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

  const handleNextEpisode = async () => {
    if (isTransitioningRef.current) return;
    isTransitioningRef.current = true;
    isSwipingRef.current = true;
    setShowFutureConfirm(false);
    const effectiveTmdbId = tmdbShowId || activeShow?.tmdbId;
    const curEpNum = currentEpisode?.episode_number || 1;
    const nextEpNum = curEpNum + 1;

    try {
      if (effectiveTmdbId) {
        let curSeasonEps = seasonCacheRef.current[`${effectiveTmdbId}_${currentSeason}`];
        if (!curSeasonEps) {
          setIsLoadingEpisode(true);
          curSeasonEps = await fetchAndCacheSeason(currentSeason);
        }
        
        if (curSeasonEps && curSeasonEps.length > 0) {
          const foundNext = curSeasonEps.find((e: any) => e.episode_number === nextEpNum);
          if (foundNext) {
            setCurrentEpisode(foundNext);
            setIsLoadingEpisode(false);
            return;
          }
          
          if (nextEpNum > curSeasonEps.length) {
            // End of current season -> switch to next season (currentSeason + 1)
            const targetSeason = currentSeason + 1;
            let nextSeasonEps = seasonCacheRef.current[`${effectiveTmdbId}_${targetSeason}`];
            if (!nextSeasonEps) {
              setIsLoadingEpisode(true);
              nextSeasonEps = await fetchAndCacheSeason(targetSeason);
            }
            if (nextSeasonEps && nextSeasonEps.length > 0) {
              setCurrentSeason(targetSeason);
              setCurrentEpisode(nextSeasonEps[0]);
              setIsLoadingEpisode(false);
              return;
            } else {
              // Rebound gently on last episode of last season
              setIsLoadingEpisode(false);
              animate(dragX, 0, { type: 'spring', damping: 25, stiffness: 300 });
              return;
            }
          }
        }
        
        setIsLoadingEpisode(true);
        const res = await tmdb.getEpisodeDetails(effectiveTmdbId, currentSeason, nextEpNum);
        if (res.ok && res.value && !res.value.status_code && typeof res.value.episode_number === 'number') {
          episodeCacheRef.current[`${effectiveTmdbId}_${currentSeason}_${nextEpNum}`] = res.value;
          setCurrentEpisode(res.value);
          setIsLoadingEpisode(false);
          return;
        }
        const nextSeasonRes = await tmdb.getEpisodeDetails(effectiveTmdbId, currentSeason + 1, 1);
        if (nextSeasonRes.ok && nextSeasonRes.value && !nextSeasonRes.value.status_code && typeof nextSeasonRes.value.episode_number === 'number') {
          episodeCacheRef.current[`${effectiveTmdbId}_${currentSeason + 1}_1`] = nextSeasonRes.value;
          setCurrentSeason(currentSeason + 1);
          setCurrentEpisode(nextSeasonRes.value);
          setIsLoadingEpisode(false);
          return;
        }
        setIsLoadingEpisode(false);
        animate(dragX, 0, { type: 'spring', damping: 25, stiffness: 300 });
        return;
      }

      if (activeShow?.totalEpisodes && nextEpNum > activeShow.totalEpisodes) {
        animate(dragX, 0, { type: 'spring', damping: 25, stiffness: 300 });
        return;
      }
      setCurrentEpisode({
        season_number: currentSeason,
        episode_number: nextEpNum,
        name: `Épisode ${nextEpNum}`,
        air_date: null,
        overview: '',
        still_path: null,
      });
    } catch (err) {
      setIsLoadingEpisode(false);
      animate(dragX, 0, { type: 'spring', damping: 25, stiffness: 300 });
    } finally {
      setTimeout(() => {
        isTransitioningRef.current = false;
        isSwipingRef.current = false;
      }, 300);
    }
  };

  const handlePreviousEpisode = async () => {
    if (isTransitioningRef.current) return;
    const curEpNum = currentEpisode?.episode_number || 1;
    if (currentSeason <= minSeason && curEpNum <= 1) {
      animate(dragX, 0, { type: 'spring', damping: 25, stiffness: 300 });
      return;
    }
    isTransitioningRef.current = true;
    isSwipingRef.current = true;
    setShowFutureConfirm(false);
    const effectiveTmdbId = tmdbShowId || activeShow?.tmdbId;

    try {
      if (curEpNum > 1) {
        const prevEpNum = curEpNum - 1;
        if (effectiveTmdbId) {
          let curSeasonEps = seasonCacheRef.current[`${effectiveTmdbId}_${currentSeason}`];
          if (!curSeasonEps) {
            setIsLoadingEpisode(true);
            curSeasonEps = await fetchAndCacheSeason(currentSeason);
          }
          
          if (curSeasonEps && curSeasonEps.length > 0) {
            const foundPrev = curSeasonEps.find((e: any) => e.episode_number === prevEpNum);
            if (foundPrev) {
              setCurrentEpisode(foundPrev);
              setIsLoadingEpisode(false);
              return;
            }
          }
          
          const prevKey = `${effectiveTmdbId}_${currentSeason}_${prevEpNum}`;
          if (episodeCacheRef.current[prevKey]) {
            setCurrentEpisode(episodeCacheRef.current[prevKey]);
            setIsLoadingEpisode(false);
            return;
          }
          
          setIsLoadingEpisode(true);
          const res = await tmdb.getEpisodeDetails(effectiveTmdbId, currentSeason, prevEpNum);
          if (res.ok && res.value && !res.value.status_code && typeof res.value.episode_number === 'number') {
            episodeCacheRef.current[prevKey] = res.value;
            setCurrentEpisode(res.value);
            setIsLoadingEpisode(false);
            return;
          }
          setIsLoadingEpisode(false);
          animate(dragX, 0, { type: 'spring', damping: 25, stiffness: 300 });
          return;
        }
        
        setCurrentEpisode({
          season_number: currentSeason,
          episode_number: prevEpNum,
          name: `Épisode ${prevEpNum}`,
          air_date: null,
          overview: '',
          still_path: null,
        });
        return;
      }

      if (currentSeason > minSeason) {
        const targetSeason = currentSeason - 1;
        if (effectiveTmdbId) {
          let prevSeasonEps = seasonCacheRef.current[`${effectiveTmdbId}_${targetSeason}`];
          if (!prevSeasonEps) {
            setIsLoadingEpisode(true);
            prevSeasonEps = await fetchAndCacheSeason(targetSeason);
          }
          if (prevSeasonEps && prevSeasonEps.length > 0) {
            const lastEp = prevSeasonEps[prevSeasonEps.length - 1];
            setCurrentSeason(targetSeason);
            setCurrentEpisode(lastEp);
            setIsLoadingEpisode(false);
            return;
          }
        }
        setCurrentSeason(targetSeason);
        setCurrentEpisode({
          season_number: targetSeason,
          episode_number: 1,
          name: `Épisode 1`,
          air_date: null,
          overview: '',
          still_path: null,
        });
        setIsLoadingEpisode(false);
      }
    } catch (err) {
      setIsLoadingEpisode(false);
      animate(dragX, 0, { type: 'spring', damping: 25, stiffness: 300 });
    } finally {
      setTimeout(() => {
        isTransitioningRef.current = false;
        isSwipingRef.current = false;
      }, 300);
    }
  };

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

  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300" 
        onClick={onClose}
      />
      
      {/* Modal Content */}
      <motion.div 
        className="relative bg-zinc-950 w-full max-w-md h-full overflow-hidden flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
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
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.3}
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
                setSwipeDirection('prev');
                animate(dragX, 0, { type: 'spring', damping: 25, stiffness: 300 });
                handlePreviousEpisode();
                return;
              }
            } else if (offset < -60 || velocity < -200) {
              if (hasNext) {
                setSwipeDirection('next');
                animate(dragX, 0, { type: 'spring', damping: 25, stiffness: 300 });
                handleNextEpisode();
                return;
              }
            }
            animate(dragX, 0, { type: 'spring', damping: 25, stiffness: 300 });
          }}
        >
          <AnimatePresence mode="wait" initial={false}>
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
                    {episodeImdbRating && episodeImdbRating > 0 ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 backdrop-blur-md rounded-full text-[10px] font-bold bg-zinc-800/80 text-amber-400 border border-amber-500/30">
                        <Star size={11} className="fill-amber-400 text-amber-400 shrink-0" />
                        <span className="text-zinc-100 font-extrabold">{Number(episodeImdbRating).toFixed(1)}</span>
                        <span className="bg-amber-500/20 text-amber-300 px-1 py-0.2 rounded font-black text-[9px]">IMDb</span>
                        {episodeImdbVotes ? (
                          <span className="text-zinc-400 font-medium">({episodeImdbVotes})</span>
                        ) : null}
                      </span>
                    ) : currentEpisode?.vote_average ? (
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
                    query={`${tmdbShowTitle || show?.title || ''} S${String(currentSeason).padStart(2, '0')}E${String(currentEpisode.episode_number).padStart(2, '0')} discussion`} 
                    isLocked={!isSeen} 
                    unlockMessage="Débloquez les discussions de la communauté sur cet épisode en le marquant comme vu."
                  />
                </div>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </motion.div>
  </div>
  );
}
