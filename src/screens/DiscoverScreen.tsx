import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { 
  Search, Plus, Check, WifiOff, Star, X, 
  SlidersHorizontal, ArrowUp, ArrowDown, Film, Tv, Users, User,
  Info, Sparkles, ChevronRight, ChevronDown, CheckCircle, CheckCircle2, Play, Archive, XCircle,
  Ticket, MonitorPlay, Flame, Loader2, Calendar
} from 'lucide-react';
import { tmdb, discoverSeenIt, isMovieAtCinema, isMovieUpcoming, type TMDBMedia } from '../features/shows/tmdb';
import { type Show } from '../types';
import { cn, getNextEpisodeNumber } from '../lib/utils';
import { useShows } from '../hooks/useShows';
import { useToastStore } from '../store/toastStore';
import { PersonCard } from '../components/cards/PersonCard';
import { GridMediaCard, PreviewModal } from '../components/GridMediaCard';
import { PersonDetailModal } from './PersonDetailModal';
import { FilterModal } from '../components/FilterModal';
import { TrailerModal } from '../components/TrailerModal';
import { auth, db } from '../lib/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { useShowsStore } from '../store/showsStore';
import { getRecommendations } from '../lib/recommendations';
import { SeenItGlyph } from '../components/SeenItLogo';
import { useGridVirtualWindow } from '../hooks/useBoundedVirtualWindow';
import { hasMoreTmdbPages } from '../features/discover/discoverPagination';
import { enrichCinemaEvidenceForExplorerLists } from '../features/discover/cinemaSearchEvidence';
import {
  discoverTypeForCategory,
  isSearchCompatibleCategory,
  matchesSelectedGenres,
  parseMinimumRating,
} from '../features/discover/filterPolicy';
import {
  type Props,
  DISCOVER_CRITICAL_GRID_ITEMS,
  GENRE_OPTIONS,
  checkIsUpToDate,
  useDebounce,
} from './discoverPresentation';
import { DiscoverView } from './DiscoverView';

export function DiscoverScreen({ onShowClick }: Props) {
  const { showToast } = useToastStore();
  const { shows, addShow, updateShow, deleteShow } = useShows();
  
  const showsByTmdbId = React.useMemo(() => {
    const map = new Map<number, any>();
    for (const s of shows) {
      if (s.tmdbId != null) {
        const numId = Number(s.tmdbId);
        if (!isNaN(numId)) map.set(numId, s);
      }
    }
    return map;
  }, [shows]);

  const [watchedIdsSnapshot, setWatchedIdsSnapshot] = useState<Set<number>>(() => new Set());

  const [query, setQuery] = useState('');
  const [debouncedQuery] = useDebounce(query, 300);
  const [searchResults, setSearchResults] = useState<TMDBMedia[]>([]);
  const [totalTvCount, setTotalTvCount] = useState<number | null>(null);
  const [totalMovieCount, setTotalMovieCount] = useState<number | null>(null);
  const [trending, setTrending] = useState<TMDBMedia[]>([]);
  const [popular, setPopular] = useState<TMDBMedia[]>([]);
  const [popularPersons, setPopularPersons] = useState<TMDBMedia[]>([]);
  const [recommendations, setRecommendations] = useState<TMDBMedia[]>([]);
  const [heroDetails, setHeroDetails] = useState<Record<number, any>>({});
  const [loading, setLoading] = useState(true);
  const [homeEnrichmentReady, setHomeEnrichmentReady] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  
  const [activeCategory, setActiveCategory] = useState("Tout");

  const displayRecommendations = React.useMemo(() => {
    return recommendations.filter(item => {
      const show = showsByTmdbId.get(Number(item.id));
      return !show?.isArchived;
    });
  }, [recommendations, showsByTmdbId]);
  const [sortBy, setSortBy] = useState<'popular' | 'rating' | 'date' | 'title'>('popular');
  const [isSortPickerOpen, setIsSortPickerOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedGenreIds, setSelectedGenreIds] = useState<string[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [pegi, setPegi] = useState('Tous');
  const [minRating, setMinRating] = useState('Toutes');
  const [showGenreMenu, setShowGenreMenu] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState<number | null>(null);

  const [activeHeroIndex, setActiveHeroIndex] = useState(0);
  const heroCarouselRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const openPersonModal = useCallback((personId: number) => {
    setSelectedPersonId(personId);
    const currentState = window.history.state || {};
    window.history.pushState({ ...currentState, isModal: true, isPersonDetailModal: true, personId }, '');
  }, []);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (event.state && event.state.isPersonDetailModal && event.state.personId) {
        setSelectedPersonId(event.state.personId);
      } else if (!event.state || !event.state.isPersonDetailModal) {
        setSelectedPersonId(null);
      }
    };
    const handleCloseModals = () => {
      setPreviewMedia(null);
      setTrailerModalVideos(null);
      setShowGenreMenu(false);
    };

    const handleResetAll = () => {
      setQuery('');
      setActiveCategory('Tout');
      setSelectedPlatforms([]);
      setSelectedGenres([]);
      setSelectedGenreIds([]);
      setPegi('Tous');
      setMinRating('Toutes');
      setSortBy('popular');
      setSortOrder('desc');
      setShowGenreMenu(false);
      setSelectedPersonId(null);
      setPreviewMedia(null);
      setTrailerModalVideos(null);
      setShowAllPersons(false);
      setExpandedRecs(false);
      setShowAffinityInfo(false);
      setIsSearchFocused(false);
      
      setActiveHeroIndex(0);
      if (heroCarouselRef.current) {
        try {
          heroCarouselRef.current.scrollTo({ left: 0, behavior: 'smooth' });
        } catch {
          heroCarouselRef.current.scrollLeft = 0;
        }
      }

      if (containerRef.current) {
        try {
          containerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        } catch {
          containerRef.current.scrollTop = 0;
        }
      }
      showToast('Explorer réinitialisé : filtres et recherche effacés.', 'info');
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('app-close-modals', handleCloseModals);
    window.addEventListener('discover-reset-all', handleResetAll);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('app-close-modals', handleCloseModals);
      window.removeEventListener('discover-reset-all', handleResetAll);
    };
  }, [showToast]);

  const [previewMedia, setPreviewMedia] = useState<TMDBMedia | null>(null);
  const handleLongPress = useCallback((media: TMDBMedia) => setPreviewMedia(media), []);

  const [isSearchVisible, setIsSearchVisible] = useState(true);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const lastScrollY = useRef(0);
  const pendingScrollY = useRef(0);
  const scrollFrame = useRef<number | null>(null);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const isSearchFocusedRef = useRef(false);
  isSearchFocusedRef.current = isSearchFocused;
  const [cols, setCols] = useState(() => (typeof window !== 'undefined' && window.innerWidth >= 640 ? 4 : 3));

  const handleHeroScroll = () => {
    if (heroCarouselRef.current) {
      const scrollLeft = heroCarouselRef.current.scrollLeft;
      const width = heroCarouselRef.current.clientWidth;
      if (width > 0) {
        const idx = Math.round(scrollLeft / width);
        if (idx !== activeHeroIndex && idx >= 0 && idx < top10.length) {
          setActiveHeroIndex(idx);
        }
      }
    }
  };

  useEffect(() => {
    setActiveHeroIndex(0);
    if (heroCarouselRef.current) {
      try {
        heroCarouselRef.current.scrollTo({ left: 0, behavior: 'auto' });
      } catch {
        heroCarouselRef.current.scrollLeft = 0;
      }
    }
  }, [activeCategory]);

  useEffect(() => {
    const handleResize = () => setCols(window.innerWidth >= 640 ? 4 : 3);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const completed = new Set<number>();
    for (const s of shows) {
      if (s.tmdbId != null) {
        const isSeen = s.status === 'completed' || s.seenEpisodes?.includes('movie') || checkIsUpToDate(s);
        if (isSeen) {
          const num = Number(s.tmdbId);
          if (!isNaN(num)) completed.add(num);
        }
      }
    }
    setWatchedIdsSnapshot(completed);
  }, [activeCategory, debouncedQuery, selectedPlatforms, selectedGenres, minRating, pegi, sortBy, sortOrder]);

  const mergeMedia = (prev: TMDBMedia[], next: TMDBMedia[]) => {
    const existingKeys = new Set(prev.map(p => `${p.media_type || (p.first_air_date ? 'tv' : 'movie')}_${p.id}`));
    const newItems = next.filter(n => !existingKeys.has(`${n.media_type || (n.first_air_date ? 'tv' : 'movie')}_${n.id}`));
    return [...prev, ...newItems];
  };

  const handleToggleWatched = useCallback(async (media: TMDBMedia) => {
    const isTv = media.media_type === 'tv' || activeCategory === 'Séries' || media.first_air_date !== undefined;
    const titleToUse = media.name || media.title || media.original_name || media.original_title || '';
    const numId = Number(media.id);
    const existingShow = showsByTmdbId.get(numId);

    if (existingShow) {
      if (isTv) {
        const isUpToDate = checkIsUpToDate(existingShow);
        const isDropped = existingShow.status === 'dropped';
        const isArchived = existingShow.isArchived;

        const oldStatus = existingShow.status;
        const oldSeenEpisodes = existingShow.seenEpisodes || [];
        const oldIsArchived = existingShow.isArchived;

        if (isUpToDate || isDropped || isArchived || existingShow.status === 'completed') {
          await updateShow(existingShow.id, {
            status: 'plan_to_watch',
            seenEpisodes: [],
            isArchived: false,
            updatedAt: Date.now()
          });
          showToast(
            `« ${titleToUse} » remis dans "À voir"`, 
            'success', 
            existingShow,
            async () => {
              await updateShow(existingShow.id, {
                status: oldStatus,
                seenEpisodes: oldSeenEpisodes,
                isArchived: oldIsArchived,
                updatedAt: Date.now()
              });
            }
          );
        } else {
          await updateShow(existingShow.id, {
            status: 'plan_to_watch',
            seenEpisodes: [],
            updatedAt: Date.now()
          });
          showToast(
            `« ${titleToUse} » remis dans "À voir"`, 
            'success', 
            existingShow,
            async () => {
              await updateShow(existingShow.id, {
                status: oldStatus,
                seenEpisodes: oldSeenEpisodes,
                updatedAt: Date.now()
              });
            }
          );
        }
      } else {
        const isCurrentlySeen = existingShow.status === 'completed' || existingShow.seenEpisodes?.includes('movie');
        const newStatus = isCurrentlySeen ? 'plan_to_watch' : 'completed';
        const newSeenEpisodes = isCurrentlySeen 
          ? (existingShow.seenEpisodes || []).filter((e: string) => e !== 'movie')
          : Array.from(new Set([...(existingShow.seenEpisodes || []), 'movie']));

        const oldStatus = existingShow.status;
        const oldSeenEpisodes = existingShow.seenEpisodes || [];
        const oldLastWatchedAt = existingShow.lastWatchedAt;

        await updateShow(existingShow.id, {
          status: newStatus,
          seenEpisodes: newSeenEpisodes,
          lastWatchedAt: isCurrentlySeen ? existingShow.lastWatchedAt : Date.now(),
          updatedAt: Date.now()
        });

        showToast(
          newStatus === 'completed' 
            ? `« ${titleToUse} » marqué comme vu !` 
            : `« ${titleToUse} » marqué comme à voir.`,
          'success',
          existingShow,
          async () => {
            await updateShow(existingShow.id, {
              status: oldStatus,
              seenEpisodes: oldSeenEpisodes,
              lastWatchedAt: oldLastWatchedAt,
              updatedAt: Date.now()
            });
          }
        );
      }
    } else {
      const newShowData: any = {
        tmdbId: numId,
        title: titleToUse,
        posterPath: media.poster_path,
        backdropPath: media.backdrop_path,
        year: (media.first_air_date || media.release_date || '').substring(0, 4),
        rating: media.vote_average,
        mediaType: isTv ? 'tv' : 'movie',
        seasonRecords: {},
        episodeRecords: {},
        status: 'completed',
        updatedAt: Date.now(),
        createdAt: Date.now(),
        seenEpisodes: isTv ? [] : ['movie'],
        isArchived: false,
      };

      const newId = await addShow(newShowData);
      const savedShow = { ...newShowData, id: newId, userId: '' } as Show;

      showToast(
        `« ${titleToUse} » marqué comme vu !`,
        'success',
        savedShow,
        async () => {
          if (newId) {
            await deleteShow(newId);
          }
        }
      );
    }
  }, [activeCategory, addShow, deleteShow, showsByTmdbId, showToast, updateShow]);

  const handleAddMedia = useCallback(async (media: TMDBMedia) => {
    const isTv = media.media_type === 'tv' || activeCategory === 'Séries';
    const titleToUse = media.name || media.title || media.original_name || media.original_title || '';
    if (showsByTmdbId.has(media.id)) return;

    const newShowData: any = {
      tmdbId: Number(media.id),
      title: titleToUse,
      posterPath: media.poster_path,
      backdropPath: media.backdrop_path,
      year: (media.first_air_date || media.release_date || '').substring(0, 4),
      rating: media.vote_average,
      mediaType: isTv ? 'tv' : 'movie',
      seasonRecords: {},
      episodeRecords: {},
      status: 'watching',
      updatedAt: Date.now(),
      createdAt: Date.now(),
      seenEpisodes: [],
      isArchived: false,
    };

    const newId = await addShow(newShowData);
    const savedShow = { ...newShowData, id: newId, userId: '' } as Show;

    showToast(
      isTv ? `« ${titleToUse} » ajoutée à votre suivi` : `« ${titleToUse} » ajouté à vos films à voir`,
      'follow',
      savedShow,
      async () => {
        if (newId) {
          await deleteShow(newId);
        }
      }
    );
  }, [activeCategory, addShow, deleteShow, showsByTmdbId, showToast]);

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    pendingScrollY.current = event.currentTarget.scrollTop;
    if (scrollFrame.current !== null) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      if (isSearchFocusedRef.current) return;
      const currentScrollY = pendingScrollY.current;

      if (currentScrollY < 300) {
        setIsSearchVisible(current => current ? current : true);
        setShowScrollTop(current => current ? false : current);
      } else if (currentScrollY > lastScrollY.current + 10) {
        setIsSearchVisible(current => current ? false : current);
        setShowScrollTop(current => current ? false : current);
      } else if (currentScrollY < lastScrollY.current - 10) {
        setIsSearchVisible(current => current ? current : true);
        setShowScrollTop(current => current ? current : true);
      }

      lastScrollY.current = currentScrollY;
    });
  }, []);

  useEffect(() => () => {
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
  }, []);

  const hasActiveFilters = selectedPlatforms.length > 0 || selectedGenres.length > 0 || pegi !== 'Tous' || minRating !== 'Toutes';
  const activeFilterCount = selectedPlatforms.length
    + selectedGenres.length
    + (pegi !== 'Tous' ? 1 : 0)
    + (minRating !== 'Toutes' ? 1 : 0);

  const [expandedRecs, setExpandedRecs] = useState(false);
  const [showAffinityInfo, setShowAffinityInfo] = useState(false);

  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    personnes: false,
    series: false,
    films: false,
    documentaires: false
  });
  const [showAllPersons, setShowAllPersons] = useState(false);

  const [page, setPage] = useState(1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const homeRequestGenerationRef = useRef(0);
  const searchRequestGenerationRef = useRef(0);

  const touchStartY = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current !== null) {
      const diff = e.touches[0].clientY - touchStartY.current;
      if (diff > 25 && !isSearchVisible) {
        setIsSearchVisible(true);
        touchStartY.current = null;
      } else if (diff < -25 && isSearchVisible) {
        setIsSearchVisible(false);
        touchStartY.current = null;
      }
    }
  };

  const handleTouchEnd = () => {
    touchStartY.current = null;
  };

  const [trailerModalVideos, setTrailerModalVideos] = useState<any[] | null>(null);

  const handleOpenTrailer = async (mediaId: number, mediaType: 'tv' | 'movie') => {
    const details = heroDetails[mediaId];
    let videos = details?.videos?.results || [];
    if (videos.length > 0) {
      setTrailerModalVideos(videos);
      return;
    }

    try {
      const res = await tmdb.getMediaDetails(mediaId, mediaType);
      if (res.ok && res.value?.videos?.results && res.value.videos.results.length > 0) {
        setTrailerModalVideos(res.value.videos.results);
      } else {
        showToast('Aucune bande-annonce disponible', 'info');
      }
    } catch {
      showToast('Impossible de charger la bande-annonce', 'error');
    }
  };

  const toggleSection = (key: string) => {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  useEffect(() => {
    setPage(1);
    setHasMore(true);
    setPopular([]);
    setTrending([]);
    if (!debouncedQuery.trim() && activeCategory === 'Tout') {
      setHomeEnrichmentReady(false);
    }
  }, [activeCategory, debouncedQuery, selectedPlatforms, selectedGenres, pegi, minRating, sortBy, sortOrder]);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const requestGeneration = ++homeRequestGenerationRef.current;
    const isCurrentRequest = () => homeRequestGenerationRef.current === requestGeneration;
    if (isOffline || debouncedQuery.trim()) {
      return () => {
        if (isCurrentRequest()) homeRequestGenerationRef.current += 1;
      };
    }

    async function fetchHome() {
      if (page === 1) setLoading(true);

      let nextPopular: TMDBMedia[] | null = null;
      let nextTrending: TMDBMedia[] | null = null;
      let nextPersons: TMDBMedia[] | null = null;
      let nextHasMore = false;

      if (activeCategory === 'Personnes') {
        const personRes = await tmdb.getPopularPersons(page);
        if (!isCurrentRequest()) return;
        if (personRes?.ok && personRes.value.results) {
          nextPersons = personRes.value.results.map(p => ({ ...p, media_type: 'person' }));
          nextHasMore = hasMoreTmdbPages(page, personRes);
        }
      } else if (hasActiveFilters || sortBy !== 'popular') {
        const discoverRes = await discoverSeenIt({
          type: discoverTypeForCategory(activeCategory),
          category: activeCategory,
          page,
          watchProviders: selectedPlatforms,
          genres: selectedGenres,
          pegi,
          minRating,
          sortBy,
          sortOrder,
        });
        if (!isCurrentRequest()) return;
        if (discoverRes?.ok && discoverRes.value.results) {
          nextPopular = discoverRes.value.results;
          nextHasMore = activeCategory === 'Top 100'
            ? page < 5 && hasMoreTmdbPages(page, discoverRes)
            : hasMoreTmdbPages(page, discoverRes);
        }
      } else if (activeCategory === 'Pépites') {
        const topRes = await tmdb.getTopRatedRecent('all', page, selectedPlatforms);
        if (!isCurrentRequest()) return;
        if (topRes?.ok && topRes.value.results) {
          nextPopular = topRes.value.results;
          nextTrending = topRes.value.results.slice(0, 10);
          nextHasMore = hasMoreTmdbPages(page, topRes);
        }
      } else if (activeCategory === 'Top 100') {
        const [topMovRes, topTvRes] = await Promise.all([
          tmdb.getTopRated('movie', page),
          tmdb.getTopRated('tv', page)
        ]);
        if (!isCurrentRequest()) return;
        const tops = [
          ...(topMovRes?.ok ? topMovRes.value.results.map((r) => ({ ...r, media_type: 'movie' as const })) : []),
          ...(topTvRes?.ok ? topTvRes.value.results.map((r) => ({ ...r, media_type: 'tv' as const })) : [])
        ];
        tops.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
        nextPopular = tops;
        nextTrending = tops.slice(0, 10);
        nextHasMore = page < 5 && (hasMoreTmdbPages(page, topMovRes) || hasMoreTmdbPages(page, topTvRes));
      } else if (activeCategory === 'Au cinéma') {
        const cinemaRes = await tmdb.getNowPlaying(page);
        if (!isCurrentRequest()) return;
        if (cinemaRes?.ok && cinemaRes.value.results) {
          const movies = cinemaRes.value.results
            .map(r => ({ ...r, media_type: 'movie' as const }))
            .filter(r => isMovieAtCinema(r));
          nextPopular = movies;
          nextTrending = movies.slice(0, 10);
          nextHasMore = hasMoreTmdbPages(page, cinemaRes);
        }
      } else if (activeCategory === 'Documentaires') {
        const [docMovRes, docTvRes] = await Promise.all([
          tmdb.discoverByGenre('movie', 99, page, selectedPlatforms),
          tmdb.discoverByGenre('tv', 99, page, selectedPlatforms)
        ]);
        if (!isCurrentRequest()) return;
        nextPopular = [
          ...(docMovRes?.ok ? docMovRes.value.results.map(r => ({ ...r, media_type: 'movie' as const, genre_ids: Array.from(new Set([...(r.genre_ids || []), 99])) })) : []),
          ...(docTvRes?.ok ? docTvRes.value.results.map(r => ({ ...r, media_type: 'tv' as const, genre_ids: Array.from(new Set([...(r.genre_ids || []), 99])) })) : [])
        ];
        nextHasMore = hasMoreTmdbPages(page, docMovRes, docTvRes);
      } else if (activeCategory === 'Tout') {
        const isRecent = (r: TMDBMedia) => {
          const date = r.first_air_date || r.release_date;
          if (!date) return true;
          const yr = parseInt(date.split('-')[0], 10);
          return !yr || yr >= 2016;
        };

        const trendAllPromise = page <= 5
          ? tmdb.getTrending('all', page, selectedPlatforms)
          : Promise.resolve({ ok: false } as any);
        const popTvPromise = tmdb.getPopular('tv', page, selectedPlatforms);
        const popMovPromise = tmdb.getPopular('movie', page, selectedPlatforms);
        const personPromise = page <= 3
          ? tmdb.getPopularPersons(page)
          : Promise.resolve({ ok: false } as any);

        const trendAllRes = await trendAllPromise;
        if (!isCurrentRequest()) return;
        const trendingList = trendAllRes?.ok ? trendAllRes.value.results.filter(isRecent) : [];
        if (trendingList.length > 0) {
          setTrending(prev => page === 1 ? trendingList : mergeMedia(prev, trendingList));
          setPopular(prev => page === 1 ? trendingList : mergeMedia(prev, trendingList));
          if (page === 1) setLoading(false);
        }

        const [popTvRes, popMovRes, personRes] = await Promise.all([
          popTvPromise,
          popMovPromise,
          personPromise,
        ]);
        if (!isCurrentRequest()) return;
        const popularList = [
          ...(popTvRes?.ok ? popTvRes.value.results.filter(isRecent).map(r => ({ ...r, media_type: 'tv' as const })) : []),
          ...(popMovRes?.ok ? popMovRes.value.results.filter(isRecent).map(r => ({ ...r, media_type: 'movie' as const })) : [])
        ];
        nextPopular = mergeMedia(trendingList, popularList);
        nextTrending = trendingList;
        if (personRes?.ok && personRes.value.results) {
          nextPersons = personRes.value.results.map((p) => ({ ...p, media_type: 'person' as const }));
        }
        nextHasMore = hasMoreTmdbPages(page, popTvRes, popMovRes);
        if (page === 1) setHomeEnrichmentReady(true);
      } else {
        const type = activeCategory === 'Films' ? 'movie' : 'tv';
        const [trendRes, popRes] = await Promise.all([
          page <= 5 ? tmdb.getTrending(type, page, selectedPlatforms) : Promise.resolve({ ok: false } as any),
          tmdb.getPopular(type, page, selectedPlatforms)
        ]);
        if (!isCurrentRequest()) return;

        const isRecent = (r: TMDBMedia) => {
          const date = r.first_air_date || r.release_date;
          if (!date) return true;
          const yr = parseInt(date.split('-')[0], 10);
          return !yr || yr >= 2016;
        };
        const trendList = trendRes?.ok ? trendRes.value.results.filter(isRecent).map((r) => ({ ...r, media_type: type as 'movie' | 'tv' })) : [];
        const popList = popRes?.ok ? popRes.value.results.filter(isRecent).map((r) => ({ ...r, media_type: type as 'movie' | 'tv' })) : [];
        const combined = mergeMedia(trendList, popList);
        nextPopular = combined.length > 0 ? combined : popList;
        nextTrending = nextPopular.slice(0, 10);
        nextHasMore = hasMoreTmdbPages(page, popRes);
      }

      if (!isCurrentRequest()) return;
      if (nextPopular !== null && activeCategory !== 'Au cinéma') [nextPopular, nextTrending] = await enrichCinemaEvidenceForExplorerLists(nextPopular, nextTrending);
      if (!isCurrentRequest()) return;
      if (nextPopular !== null) {
        setPopular(prev => page === 1 ? nextPopular! : mergeMedia(prev, nextPopular!));
      }
      if (nextTrending !== null) {
        setTrending(prev => page === 1 ? nextTrending! : mergeMedia(prev, nextTrending!));
      }
      if (nextPersons !== null) {
        setPopularPersons(prev => page === 1 ? nextPersons! : mergeMedia(prev, nextPersons!));
      }
      setHasMore(nextHasMore);
      setLoading(false);
      setIsLoadingMore(false);
      if (page === 1) {
        void getRecommendations(20)
          .then(recs => {
            if (isCurrentRequest()) setRecommendations(recs);
          })
          .catch(() => {});
      }
    }

    void fetchHome();
    return () => {
      if (isCurrentRequest()) homeRequestGenerationRef.current += 1;
    };
  }, [debouncedQuery, isOffline, activeCategory, page, selectedPlatforms, selectedGenres, pegi, minRating, sortBy, sortOrder, hasActiveFilters]);

  useEffect(() => {
    const requestGeneration = ++searchRequestGenerationRef.current;
    const isCurrentRequest = () => searchRequestGenerationRef.current === requestGeneration;
    if (isOffline || !debouncedQuery.trim()) {
      setSearchResults([]);
      setHasMore(true);
      return () => {
        if (isCurrentRequest()) searchRequestGenerationRef.current += 1;
      };
    }

    async function search() {
      setLoading(true);
      setTotalTvCount(null);
      setTotalMovieCount(null);

      const [res1, res2] = await Promise.all([
        tmdb.smartSearchMulti(debouncedQuery, 1),
        tmdb.smartSearchMulti(debouncedQuery, 2)
      ]);
      if (!isCurrentRequest()) return;

      if (res1?.ok) {
        const combined = [
          ...(res1.value.results || []),
          ...(res2?.ok ? (res2.value.results || []) : [])
        ];
        const results = combined.slice(0, 30);
        setSearchResults(results);
        
        const isShortQuery = debouncedQuery.trim().length <= 3;
        if (res1.value.total_tv !== undefined) setTotalTvCount(isShortQuery ? results.filter(r => r.media_type === 'tv' || r.media_type === 'series').length : res1.value.total_tv);
        if (res1.value.total_movie !== undefined) setTotalMovieCount(isShortQuery ? results.filter(r => r.media_type === 'movie').length : res1.value.total_movie);
      } else {
        setSearchResults([]);
      }
      setHasMore(false);
      setLoading(false);
      setIsLoadingMore(false);
    }

    void search();
    return () => {
      if (isCurrentRequest()) searchRequestGenerationRef.current += 1;
    };
  }, [debouncedQuery, isOffline]);

  const rawList = useMemo(() => {
    if (debouncedQuery.trim()) {
      const qClean = debouncedQuery.trim().toLowerCase();
      const existingIds = new Set(searchResults.map(r => Number(r.id)));
      const matchingLocal = shows
        .filter(s => {
          const t = (s.title || '').toLowerCase();
          const numId = Number(s.tmdbId || s.id);
          return t.includes(qClean) && (!numId || !existingIds.has(numId));
        })
        .map(s => ({
          id: Number(s.tmdbId || s.id),
          title: s.title,
          name: s.title,
          poster_path: s.posterPath,
          backdrop_path: s.backdropPath,
          vote_average: s.userRating || (s as any).rating,
          first_air_date: s.firstAirDate || ((s as any).year ? `${(s as any).year}-01-01` : undefined),
          media_type: (s.mediaType === 'movie' ? 'movie' : 'tv') as 'tv' | 'movie',
        }));
      return [...matchingLocal, ...searchResults].slice(0, 30);
    }
    if (activeCategory === 'Personnes') return popularPersons;
    return popular.length > 0 ? popular : trending;
  }, [debouncedQuery, searchResults, popular, trending, popularPersons, activeCategory, shows]);

  const processRawResults = useCallback((sourceList: TMDBMedia[]) => {
    let list = [...sourceList];
    const qClean = debouncedQuery.trim().toLowerCase();

    list = list.filter((item: any) => {
      if (qClean) return true;
      if (activeCategory === 'Personnes' || item.media_type === 'person') return true;

      const pop = item.popularity || 0;
      const count = item.vote_count || 0;
      const vote = item.vote_average || 0;

      if (activeCategory === 'Pépites') {
        return vote >= 7.5 && count >= 100;
      }
      if (activeCategory === 'Au cinéma') {
        return isMovieAtCinema(item);
      }
      if (activeCategory === 'Documentaires') {
        return count >= 20 || pop >= 5;
      }

      if (selectedPlatforms.length > 0) {
        return true;
      }

      const dateStr = item.first_air_date || item.release_date;
      if (dateStr) {
        const year = parseInt(dateStr.split('-')[0], 10);
        if (year && year < 2016) {
          return false;
        }
      }
      return count >= 50;
    });

    if (selectedGenreIds.length > 0 && !qClean && activeCategory !== 'Personnes') {
      const allowedTmdbIds = selectedGenreIds.flatMap(id => GENRE_OPTIONS.find(g => g.id === id)?.tmdbIds || []);
      list = list.filter((item: any) => {
        const itemG = item.genre_ids || (item.genres ? item.genres.map((g: any) => g.id) : []);
        return allowedTmdbIds.some(gId => itemG.includes(gId));
      });
    }

    if (selectedGenres.length > 0 && qClean && activeCategory !== 'Personnes') {
      list = list.filter((item: any) => matchesSelectedGenres(item, selectedGenres));
    }

    if (minRating !== 'Toutes' && qClean && activeCategory !== 'Personnes') {
      const minimum = parseMinimumRating(minRating);
      if (minimum !== null) {
        list = list.filter((item: any) => (item.vote_average || 0) >= minimum);
      }
    }

    if (activeCategory === 'Séries') {
      list = list.filter((item: any) => item.media_type === 'tv' || item.media_type === 'series' || !!item.first_air_date);
    } else if (activeCategory === 'Films') {
      list = list.filter((item: any) => item.media_type === 'movie' || !!item.release_date);
    } else if (activeCategory === 'Personnes') {
      list = list.filter((item: any) => item.media_type === 'person');
    }

    if (qClean && sortBy === 'popular') {
      list.sort((a: any, b: any) => {
        const titleA = (a.title || a.name || a.original_title || a.original_name || '').toLowerCase();
        const titleB = (b.title || b.name || b.original_title || b.original_name || '').toLowerCase();

        const matchA = titleA === qClean ? 3 : (titleA.startsWith(qClean) ? 2 : (titleA.includes(qClean) ? 1 : 0));
        const matchB = titleB === qClean ? 3 : (titleB.startsWith(qClean) ? 2 : (titleB.includes(qClean) ? 1 : 0));

        if (matchA !== matchB) return matchB - matchA;
        return (b.popularity || 0) - (a.popularity || 0);
      });
    } else if (sortBy !== 'popular') {
      list.sort((a: any, b: any) => {
        let valA = 0;
        let valB = 0;

        if (sortBy === 'rating') {
          valA = a.vote_average || 0;
          valB = b.vote_average || 0;
        } else if (sortBy === 'date') {
          const dateA = a.first_air_date || a.release_date || '';
          const dateB = b.first_air_date || b.release_date || '';
          valA = dateA ? new Date(dateA).getTime() : 0;
          valB = dateB ? new Date(dateB).getTime() : 0;
        } else if (sortBy === 'title') {
          const titleA = a.title || a.name || '';
          const titleB = b.title || b.name || '';
          return sortOrder === 'asc' ? titleA.localeCompare(titleB) : titleB.localeCompare(titleA);
        }

        return sortOrder === 'desc' ? valB - valA : valA - valB;
      });
    }

    if (watchedIdsSnapshot.size > 0 && !qClean) {
      list = list.filter(item => {
        const numId = Number(item.id);
        if (!isNaN(numId) && watchedIdsSnapshot.has(numId)) {
          return false;
        }
        return true;
      });
    }

    return list;
  }, [debouncedQuery, selectedGenreIds, selectedGenres, minRating, sortBy, sortOrder, activeCategory, watchedIdsSnapshot, selectedPlatforms]);

  const processedResults = useMemo(
    () => processRawResults(rawList),
    [processRawResults, rawList],
  );

  const top10 = useMemo(() => {
    if (debouncedQuery.trim() || activeCategory === 'Personnes' || hasActiveFilters || sortBy !== 'popular') return [];
    const seen = new Set<string>();
    const list: TMDBMedia[] = [];
    for (const item of processedResults) {
      if (activeCategory === 'Au cinéma' && !isMovieAtCinema(item)) continue;
      if (activeCategory === 'Top 100' && !item.vote_average) continue;
      if (item.media_type === 'person') continue;
      const type = item.media_type || (item.first_air_date ? 'tv' : 'movie');
      const key = `${type}_${item.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        list.push(item);
      }
      if (list.length >= 10) break;
    }
    return list;
  }, [processedResults, activeCategory, debouncedQuery, hasActiveFilters, sortBy]);

  const criticalHomeSliceActive = !debouncedQuery.trim()
    && activeCategory === 'Tout'
    && !homeEnrichmentReady
    && top10.length > 0;
  const visibleHeroItems = criticalHomeSliceActive ? top10.slice(0, 1) : top10;

  useEffect(() => {
    const heroItemsToHydrate = activeCategory === 'Tout' && !homeEnrichmentReady
      ? top10.slice(0, 1)
      : top10;
    for (const item of heroItemsToHydrate) {
      if (item?.id && !heroDetails[item.id]) {
        const type = item.media_type === 'movie' || item.release_date ? 'movie' : 'tv';
        if (type === 'tv') {
          tmdb.getShowDetails(item.id).then(res => { if (res.ok) setHeroDetails(prev => ({ ...prev, [item.id]: res.value })); });
        } else {
          tmdb.getMovieDetails(item.id).then(res => { if (res.ok) setHeroDetails(prev => ({ ...prev, [item.id]: res.value })); });
        }
      }
    }
  }, [top10, heroDetails, activeCategory, homeEnrichmentReady]);

  useEffect(() => {
    setActiveHeroIndex(0);
  }, [activeCategory, selectedGenres, selectedPlatforms, pegi, minRating]);

  const uniqueProcessedResults = useMemo(() => {
    const seen = new Set<string>();
    const top10Keys = (!debouncedQuery.trim() && top10.length > 0 && (activeCategory === 'Tout' || activeCategory === 'Séries' || activeCategory === 'Films' || activeCategory === 'Pépites' || activeCategory === 'Top 100' || activeCategory === 'Au cinéma'))
      ? new Set(top10.map(item => {
          const type = item.media_type || (item.first_air_date ? 'tv' : 'movie');
          return `${type}_${item.id}`;
        }))
      : new Set<string>();

    const list: TMDBMedia[] = [];
    for (const item of processedResults) {
      const type = item.media_type || (item.first_air_date ? 'tv' : 'movie');
      const key = `${type}_${item.id}`;
      if (!seen.has(key) && !top10Keys.has(key)) {
        seen.add(key);
        list.push(item);
      }
      if (debouncedQuery.trim() && list.length >= 30) break;
    }
    return list;
  }, [processedResults, debouncedQuery, top10, activeCategory]);

  const personResults = useMemo(() => {
    return uniqueProcessedResults.filter(r => r.media_type === 'person');
  }, [uniqueProcessedResults]);

  const seriesResults = useMemo(() => {
    return uniqueProcessedResults.filter(r => r.media_type === 'tv' || r.media_type === 'series' || (r.first_air_date && r.media_type !== 'person' && r.media_type !== 'movie'));
  }, [uniqueProcessedResults]);

  const movieResults = useMemo(() => {
    return uniqueProcessedResults.filter(r => r.media_type === 'movie' || (r.release_date && !r.first_air_date && r.media_type !== 'person' && r.media_type !== 'tv' && r.media_type !== 'series'));
  }, [uniqueProcessedResults]);

  const visiblePersonResults = personResults;
  const visibleSeriesResults = seriesResults;
  const visibleMovieResults = movieResults;
  const visibleProcessedResults = criticalHomeSliceActive
    ? uniqueProcessedResults.slice(0, DISCOVER_CRITICAL_GRID_ITEMS)
    : uniqueProcessedResults;

  const handleLoadMore = useCallback(() => {
    if (isLoadingMore || loading || criticalHomeSliceActive || !hasMore || debouncedQuery.trim()) return;
    setIsLoadingMore(true);
    setPage(p => p + 1);
  }, [criticalHomeSliceActive, debouncedQuery, hasMore, isLoadingMore, loading]);

  const observerTargetNodeRef = useRef<HTMLDivElement | null>(null);

  const observerTargetRef = useCallback((node: HTMLDivElement | null) => {
    observerTargetNodeRef.current = node;
  }, []);

  useEffect(() => {
    const node = observerTargetNodeRef.current;
    if (!node || isLoadingMore || loading || criticalHomeSliceActive || !hasMore || debouncedQuery.trim()) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          handleLoadMore();
        }
      },
      { root: containerRef.current || undefined, rootMargin: '400px' }
    );
    observer.observe(node);

    return () => observer.disconnect();
  }, [criticalHomeSliceActive, debouncedQuery, handleLoadMore, hasMore, isLoadingMore, loading]);

  const searchQuery = query;
  const setSearchQuery = setQuery;
  const showHeroSurface = !debouncedQuery.trim()
    && !hasActiveFilters
    && sortBy === 'popular'
    && (activeCategory === 'Tout' || activeCategory === 'Séries' || activeCategory === 'Films' || activeCategory === 'Pépites' || activeCategory === 'Au cinéma');

  return <DiscoverView model={{ activeCategory, activeFilterCount, activeHeroIndex, addShow, containerRef, debouncedQuery, deleteShow, handleAddMedia, handleHeroScroll, handleLongPress, handleOpenTrailer, handleScroll, handleToggleWatched, handleTouchEnd, handleTouchMove, handleTouchStart, hasActiveFilters, hasMore, heroCarouselRef, heroDetails, isLoadingMore, isOffline, isSearchVisible, isSortPickerOpen, loading, minRating, movieResults, observerTargetRef, onShowClick, openPersonModal, pegi, personResults, previewMedia, processRawResults, processedResults, query, selectedGenres, selectedPersonId, selectedPlatforms, seriesResults, setActiveCategory, setActiveHeroIndex, setIsSearchFocused, setIsSearchVisible, setIsSortPickerOpen, setMinRating, setPegi, setPreviewMedia, setQuery, setSelectedGenres, setSelectedPersonId, setSelectedPlatforms, setShowGenreMenu, setShowScrollTop, setSortBy, setSortOrder, setTrailerModalVideos, showGenreMenu, showHeroSurface, showScrollTop, showsByTmdbId, sortBy, top10, trailerModalVideos, uniqueProcessedResults, visibleHeroItems, visibleMovieResults, visiblePersonResults, visibleProcessedResults, visibleSeriesResults }} />;
}
