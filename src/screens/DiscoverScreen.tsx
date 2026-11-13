import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { isDownloadFeatureEnabled } from '../features/downloads/downloadFeatureVisibility';
import { tmdb, isMovieAtCinema, EXPLORER_TRENDING_MIN_VOTES, type TMDBMedia } from '../features/shows/tmdb';
import { type Show } from '../types';
import { useShows } from '../hooks/useShows';
import { removeTrackedMedia } from '../features/shows/removeTrackedMedia';
import { useToastStore } from '../store/toastStore';
import { getRecommendations } from '../lib/recommendations';
import { createExplorerHomePrefetch, loadExplorerHomePage, type ExplorerHomeQuery } from '../features/discover/explorerHomePages';
import {
  matchesMovieReleaseAfterYear,
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
import { filterRemoteSearch } from '../features/discover/searchRemoteFilters';
import { resolveParentalRatingBatch } from '../features/discover/progressiveAgeFilter';
import { getParentalRatingOverride } from '../store/parentalRatingStore';
import { useNavigationSearchShortcut } from '../features/navigation/useTabShortcut';
import type { TrailerVideo } from '../features/trailers/trailerPolicy';
import { originalBroadcasterPlatformIds } from '../features/providers/passiveProviderState';

/** Prépare la page suivante quand le fil principal est libre, pour ne jamais gêner le défilement en cours. */
const scheduleExplorerIdle = (task: () => void) => {
  const idle = (globalThis as { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(task, { timeout: 1500 });
  else setTimeout(task, 200);
};

export function DiscoverScreen({ onShowClick, navigationShortcut }: Props) {
  const { showToast } = useToastStore();
  const { shows, addShow, updateShow, deleteShow } = useShows();

  const showsByTmdbId = React.useMemo(() => {
    const map = new Map<number, Show>();
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
  const [delayedQuery] = useDebounce(query, 300);
  const debouncedQuery = query.trim() ? delayedQuery : '';
  const [searchResults, setSearchResults] = useState<TMDBMedia[]>([]);
  const [totalTvCount, setTotalTvCount] = useState<number | null>(null);
  const [totalMovieCount, setTotalMovieCount] = useState<number | null>(null);
  const [trending, setTrending] = useState<TMDBMedia[]>([]);
  const [popular, setPopular] = useState<TMDBMedia[]>([]);
  const [homeNotice, setHomeNotice] = useState<string | null>(null);
  // Revue Codex (#917) : page suivante du Top C411 en échec, rechargée par « Réessayer ».
  const [homePageError, setHomePageError] = useState<string | null>(null);
  const [homeRetry, setHomeRetry] = useState(0);
  // SEENIT-C411-004 (#900) : Top C411 seulement sous le réglage Téléchargements, avec une clé C411.
  const c411Available = useDownloadConfigStore(state => isDownloadFeatureEnabled(state) && Boolean(state.c411ApiKey?.trim()));
  const [popularPersons, setPopularPersons] = useState<TMDBMedia[]>([]);
  const [recommendations, setRecommendations] = useState<TMDBMedia[]>([]);
  const [heroDetails, setHeroDetails] = useState<Record<number, any>>({});
  const [homeLoading, setHomeLoading] = useState(true);
  const [searchLoading, setSearchLoading] = useState(false);
  const loading = debouncedQuery.trim() ? searchLoading : homeLoading;
  const [homeEnrichmentReady, setHomeEnrichmentReady] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  const [activeCategory, setActiveCategoryState] = useState("Tout");

  const displayRecommendations = React.useMemo(() => {
    return recommendations.filter(item => {
      const show = showsByTmdbId.get(Number(item.id));
      return !show?.isArchived;
    });
  }, [recommendations, showsByTmdbId]);
  const [sortBy, setSortBy] = useState<'popular' | 'rating' | 'date' | 'title'>('popular');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedGenreIds, setSelectedGenreIds] = useState<string[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [pegi, setPegi] = useState('Tous');
  const [minRating, setMinRating] = useState('Toutes');
  const [movieReleaseAfterYear, setMovieReleaseAfterYear] = useState('Toutes');
  const setActiveCategory = useCallback((category: string) => {
    setActiveCategoryState(category);
    if (category !== 'Films') setMovieReleaseAfterYear('Toutes');
  }, []);
  useEffect(() => { if (!c411Available && activeCategory === 'Top C411') setActiveCategory('Tout'); }, [c411Available, activeCategory]);
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
      setMovieReleaseAfterYear('Toutes');
      setSortBy('popular');
      setSortOrder('desc');
      setShowGenreMenu(false);
      setSelectedPersonId(null);
      setPreviewMedia(null);
      setTrailerModalVideos(null);
      setIsSearchFocused(false);
      setIsSearchMode(false);

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

  const [isSearchMode, setIsSearchMode] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [searchElapsedMs, setSearchElapsedMs] = useState<number | null>(null);
  const explorerScroll = useRef(0);
  const restoringScroll = useRef(false);
  const enterSearch = useCallback(() => {
    setIsSearchMode(current => {
      if (!current) explorerScroll.current = containerRef.current?.scrollTop ?? 0;
      return true;
    });
  }, []);
  const exitSearch = useCallback(() => {
    restoringScroll.current = true;
    setIsSearchMode(false);
    setIsSearchFocused(false);
    setQuery('');
  }, []);
  useEffect(() => {
    if (isSearchMode || debouncedQuery || !restoringScroll.current || loading) return;
    const frame = requestAnimationFrame(() => {
      if (containerRef.current) containerRef.current.scrollTop = explorerScroll.current;
      restoringScroll.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [isSearchMode, debouncedQuery, loading]);
  useEffect(() => {
    if (!isSearchMode) return;
    const closeSearch = () => exitSearch();
    const backSearch = (event: Event) => {
      event.preventDefault();
      const input = document.querySelector<HTMLInputElement>('[data-app-tab="discover"] [data-navigation-search]');
      if (input === document.activeElement) { input.blur(); setIsSearchFocused(false); if (!query.trim()) exitSearch(); }
      else exitSearch();
    };
    window.addEventListener('app-close-modals', closeSearch);
    window.addEventListener('discover-back-one-level', backSearch);
    return () => {
      window.removeEventListener('app-close-modals', closeSearch);
      window.removeEventListener('discover-back-one-level', backSearch);
    };
  }, [isSearchMode, query, exitSearch]);
  useNavigationSearchShortcut(navigationShortcut, enterSearch, '[data-app-tab="discover"] [data-navigation-search]');
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
  }, [activeCategory, debouncedQuery, selectedPlatforms, selectedGenres, minRating, movieReleaseAfterYear, pegi, sortBy, sortOrder]);

  const mergeMedia = (prev: TMDBMedia[], next: TMDBMedia[]) => {
    const existingKeys = new Set(prev.map(p => `${p.media_type || (p.first_air_date ? 'tv' : 'movie')}_${p.id}`));
    const newItems = next.filter(n => !existingKeys.has(`${n.media_type || (n.first_air_date ? 'tv' : 'movie')}_${n.id}`));
    return [...prev, ...newItems];
  };

  const handleToggleWatched = useCallback(async (media: TMDBMedia) => {
    const isTv = media.media_type === 'tv' || activeCategory === 'Séries' || media.first_air_date !== undefined;
    const titleToUse = media.name || media.title || media.original_name || media.original_title || '';
    const numId = Number(media.id);
    const existingShow = shows.find(show => Number(show.tmdbId) === numId && show.mediaType === (isTv ? 'tv' : 'movie'));

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
  }, [activeCategory, addShow, deleteShow, showsByTmdbId, shows, showToast, updateShow]);

  const handleAddMedia = useCallback(async (media: TMDBMedia) => {
    const isTv = media.media_type === 'tv' || media.media_type === 'series' || (!media.media_type && Boolean(media.first_air_date));
    const titleToUse = media.name || media.title || media.original_name || media.original_title || '';
    const existing = shows.find(show => Number(show.tmdbId) === Number(media.id) && show.mediaType === (isTv ? 'tv' : 'movie'));
    if (existing) {
      await removeTrackedMedia(existing, deleteShow);
      return;
    }

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
      status: 'plan_to_watch',
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
  }, [activeCategory, addShow, deleteShow, showsByTmdbId, shows, showToast]);

  const hasActiveFilters = selectedPlatforms.length > 0
    || selectedGenres.length > 0
    || pegi !== 'Tous'
    || minRating !== 'Toutes'
    || movieReleaseAfterYear !== 'Toutes'
    || sortBy !== 'popular';
  const activeFilterCount = selectedPlatforms.length
    + selectedGenres.length
    + (pegi !== 'Tous' ? 1 : 0)
    + (minRating !== 'Toutes' ? 1 : 0)
    + (movieReleaseAfterYear !== 'Toutes' ? 1 : 0)
    + (sortBy !== 'popular' ? 1 : 0);


  const [page, setPage] = useState(1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [homeHasMore, setHomeHasMore] = useState(true);
  const hasMore = !debouncedQuery.trim() && homeHasMore && !homePageError;
  const homeRequestGenerationRef = useRef(0);
  const homePrefetchRef = useRef(createExplorerHomePrefetch());
  const searchRequestGenerationRef = useRef(0);

  const [trailerModalVideos, setTrailerModalVideos] = useState<TrailerVideo[] | null>(null);

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

  useEffect(() => {
    setPage(1);
    setHomeHasMore(true);
    setPopular([]);
    setTrending([]);
    setHomeNotice(null);
    setHomePageError(null);
    if (activeCategory === 'Tout') {
      setHomeEnrichmentReady(false);
    }
  }, [activeCategory, selectedPlatforms, selectedGenres, pegi, minRating, movieReleaseAfterYear, sortBy, sortOrder]);

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
    if (isOffline) {
      return () => {
        if (isCurrentRequest()) homeRequestGenerationRef.current += 1;
      };
    }

    async function fetchHome() {
      if (page === 1) setHomeLoading(true);
      // #853 : chargement extrait (explorerHomePages) ; la page préparée à l'avance est reprise telle quelle.
      const query: ExplorerHomeQuery = { activeCategory, selectedPlatforms, selectedGenres, pegi, minRating, movieReleaseAfterYear, sortBy, sortOrder, hasActiveFilters };
      const prefetched = homePrefetchRef.current.take(query, page);
      const result = (prefetched ? await prefetched : null) ?? await loadExplorerHomePage(query, page, {
        isCurrent: isCurrentRequest,
        onEarlyTrending: list => {
          setTrending(prev => page === 1 ? list : mergeMedia(prev, list));
          setPopular(prev => page === 1 ? list : mergeMedia(prev, list));
          if (page === 1) setHomeLoading(false);
        },
      });
      if (!isCurrentRequest() || !result) return;
      const { popular: nextPopular, trending: nextTrending, persons: nextPersons, hasMore: nextHasMore } = result;
      if (page === 1) setHomeNotice(result.notice ?? null);
      setHomePageError(result.pageError ?? null);
      if (page === 1 && activeCategory === 'Tout') setHomeEnrichmentReady(true);
      if (nextPopular !== null) {
        setPopular(prev => page === 1 ? nextPopular! : mergeMedia(prev, nextPopular!));
      }
      if (nextTrending !== null) {
        setTrending(prev => page === 1 ? nextTrending! : mergeMedia(prev, nextTrending!));
      }
      if (nextPersons !== null) {
        setPopularPersons(prev => page === 1 ? nextPersons! : mergeMedia(prev, nextPersons!));
      }
      setHomeHasMore(nextHasMore);
      setHomeLoading(false);
      setIsLoadingMore(false);
      if (nextHasMore) scheduleExplorerIdle(() => { if (isCurrentRequest()) homePrefetchRef.current.prime(query, page); });
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
  }, [isOffline, activeCategory, page, homeRetry, selectedPlatforms, selectedGenres, pegi, minRating, movieReleaseAfterYear, sortBy, sortOrder, hasActiveFilters]);

  const retryHomePage = useCallback(() => {
    setHomePageError(null);
    setIsLoadingMore(true);
    setHomeRetry(count => count + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const requestGeneration = ++searchRequestGenerationRef.current;
    const isCurrentRequest = () => searchRequestGenerationRef.current === requestGeneration;
    if (isOffline || !debouncedQuery.trim()) {
      setSearchResults([]);
      setSearchLoading(false);
      return () => {
        controller.abort();
      if (isCurrentRequest()) searchRequestGenerationRef.current += 1;
      };
    }

    async function search() {
      setSearchLoading(true);
      const searchStarted = performance.now();
      setSearchElapsedMs(null);
      setTotalTvCount(null);
      setTotalMovieCount(null);

      // La page 2 part en parallèle mais n'attend plus pour afficher la page 1.
      const page2 = tmdb.smartSearchMulti(debouncedQuery, 2).catch(() => null);
      const res1 = await tmdb.smartSearchMulti(debouncedQuery, 1);
      if (!isCurrentRequest()) return;

      if (res1?.ok) {
        const filter = (items: TMDBMedia[]) => filterRemoteSearch(items, pegi, selectedPlatforms, {
          ratings: resolveParentalRatingBatch,
          ratingOverride: getParentalRatingOverride,
          providerIds: async item => {
            const response = await tmdb.getWatchProviders(Number(item.id), item.media_type === 'movie' ? 'movie' : 'tv');
            if (!response.ok) return [];
            const fr = response.value?.results?.FR;
            return [...[...(fr?.flatrate || []), ...(fr?.free || []), ...(fr?.ads || [])].map(provider => Number(provider.provider_id)), ...originalBroadcasterPlatformIds(response.value)];
          },
        }, controller.signal);
        const isShortQuery = debouncedQuery.trim().length <= 3;
        const publish = (results: TMDBMedia[]) => {
          setSearchResults(results);
          if (res1.value.total_tv !== undefined) setTotalTvCount(isShortQuery ? results.filter(r => r.media_type === 'tv' || r.media_type === 'series').length : res1.value.total_tv);
          if (res1.value.total_movie !== undefined) setTotalMovieCount(isShortQuery ? results.filter(r => r.media_type === 'movie').length : res1.value.total_movie);
        };
        const firstPage = (res1.value.results || []).slice(0, 30);
        const first = await filter(firstPage);
        if (!isCurrentRequest()) return;
        publish(first);
        setSearchLoading(false);

        const res2 = firstPage.length < 30 ? await page2 : null;
        if (!isCurrentRequest()) return;
        if (res2?.ok) {
          const seen = new Set(firstPage.map(item => `${item.media_type}:${item.id}`));
          const rest = (res2.value.results || []).filter(item => !seen.has(`${item.media_type}:${item.id}`)).slice(0, 30 - firstPage.length);
          if (rest.length) {
            const extra = await filter(rest);
            if (!isCurrentRequest()) return;
            if (extra.length) publish([...first, ...extra]);
          }
        }
      } else {
        setSearchResults([]);
      }
      setSearchElapsedMs(performance.now() - searchStarted);

      setSearchLoading(false);
    }

    void search().catch(() => {
      if (!isCurrentRequest()) return;
      setSearchResults([]); setSearchLoading(false);
    });
    return () => {
      controller.abort();
      if (isCurrentRequest()) searchRequestGenerationRef.current += 1;
    };
  }, [debouncedQuery, isOffline, pegi, selectedPlatforms]);

  const rawList = useMemo(() => {
    if (debouncedQuery.trim()) return searchResults;
    if (activeCategory === 'Personnes') return popularPersons;
    return popular.length > 0 ? popular : trending;
  }, [debouncedQuery, searchResults, popular, trending, popularPersons, activeCategory, shows]);

  const processRawResults = useCallback((sourceList: TMDBMedia[]) => {
    let list = [...sourceList];
    const qClean = debouncedQuery.trim().toLowerCase();

    list = list.filter((item: TMDBMedia) => {
      if (qClean) return true;
      if (activeCategory === 'Personnes' || item.media_type === 'person') return true;
      // SEENIT-C411-004 : le classement C411 fait foi, sans les seuils de popularité ni de date d'Explorer.
      if (activeCategory === 'Top C411') return true;

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
      // #853 : une sortie récente a rarement 50 votes ; même seuil que les sources de tendance.
      return count >= EXPLORER_TRENDING_MIN_VOTES;
    });

    if (selectedGenreIds.length > 0 && !qClean && activeCategory !== 'Personnes') {
      const allowedTmdbIds = selectedGenreIds.flatMap(id => GENRE_OPTIONS.find(g => g.id === id)?.tmdbIds || []);
      list = list.filter((item: TMDBMedia & { genres?: Array<{ id: number }> }) => {
        const itemG = item.genre_ids || (item.genres ? item.genres.map(genre => genre.id) : []);
        return allowedTmdbIds.some(gId => itemG.includes(gId));
      });
    }

    if (selectedGenres.length > 0 && qClean && activeCategory !== 'Personnes') {
      list = list.filter(item => matchesSelectedGenres(item, selectedGenres));
    }

    if (minRating !== 'Toutes' && qClean && activeCategory !== 'Personnes') {
      const minimum = parseMinimumRating(minRating);
      if (minimum !== null) {
        list = list.filter(item => (item.vote_average || 0) >= minimum);
      }
    }

    if (movieReleaseAfterYear !== 'Toutes') {
      list = list.filter(item => matchesMovieReleaseAfterYear(item, movieReleaseAfterYear));
    }

    if (activeCategory === 'Séries') {
      list = list.filter((item: TMDBMedia) => item.media_type === 'tv' || item.media_type === 'series' || !!item.first_air_date);
    } else if (activeCategory === 'Films') {
      list = list.filter((item: TMDBMedia) => item.media_type === 'movie' || !!item.release_date);
    } else if (activeCategory === 'Personnes') {
      list = list.filter(item => item.media_type === 'person');
    }

    if (qClean && sortBy === 'popular') {
      list.sort((a, b) => {
        const titleA = (a.title || a.name || a.original_title || a.original_name || '').toLowerCase();
        const titleB = (b.title || b.name || b.original_title || b.original_name || '').toLowerCase();

        const matchA = titleA === qClean ? 3 : (titleA.startsWith(qClean) ? 2 : (titleA.includes(qClean) ? 1 : 0));
        const matchB = titleB === qClean ? 3 : (titleB.startsWith(qClean) ? 2 : (titleB.includes(qClean) ? 1 : 0));

        if (matchA !== matchB) return matchB - matchA;
        return (b.popularity || 0) - (a.popularity || 0);
      });
    } else if (sortBy !== 'popular') {
      list.sort((a, b) => {
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

    // SEENIT-C411-004 : rangs continus parmi les cartes affichées (titres vus masqués, fiches introuvables écartées).
    if (activeCategory === 'Top C411' && !qClean) {
      list = list.map((item, index) => item.seenitC411 ? { ...item, seenitC411: { ...item.seenitC411, rank: index + 1 } } : item);
    }

    return list;
  }, [debouncedQuery, selectedGenreIds, selectedGenres, minRating, movieReleaseAfterYear, sortBy, sortOrder, activeCategory, watchedIdsSnapshot, selectedPlatforms]);

  const processedResults = useMemo(
    () => processRawResults(rawList),
    [processRawResults, rawList],
  );

  const top10 = useMemo(() => {
    if (debouncedQuery.trim() || activeCategory !== 'Tout' || hasActiveFilters || sortBy !== 'popular') return [];
    const seen = new Set<string>();
    const list: TMDBMedia[] = [];
    for (const item of processedResults) {
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
  }, [activeCategory, selectedGenres, selectedPlatforms, pegi, minRating, movieReleaseAfterYear]);

  const uniqueProcessedResults = useMemo(() => {
    const seen = new Set<string>();
    const top10Keys = (!isSearchMode && !debouncedQuery.trim() && top10.length > 0 && activeCategory === 'Tout' && !hasActiveFilters)
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
  }, [processedResults, debouncedQuery, top10, activeCategory, hasActiveFilters, isSearchMode]);

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
    if (isSearchMode || isLoadingMore || loading || criticalHomeSliceActive || !hasMore || debouncedQuery.trim()) return;
    setIsLoadingMore(true);
    setPage(p => p + 1);
  }, [criticalHomeSliceActive, debouncedQuery, hasMore, isLoadingMore, loading, isSearchMode]);

  const [observerTargetNode, setObserverTargetNode] = useState<HTMLDivElement | null>(null);

  const observerTargetRef = useCallback((node: HTMLDivElement | null) => {
    setObserverTargetNode(node);
  }, []);

  useEffect(() => {
    const node = observerTargetNode;
    if (!node || isSearchMode || isLoadingMore || loading || criticalHomeSliceActive || !hasMore || debouncedQuery.trim()) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.at(-1)?.isIntersecting) {
          handleLoadMore();
        }
      },
      // #853 : déclenché ~1,5 écran avant la fin ; la page suivante est en général déjà prête.
      { root: containerRef.current || undefined, rootMargin: '1200px' }
    );
    observer.observe(node);

    return () => observer.disconnect();
  }, [criticalHomeSliceActive, debouncedQuery, handleLoadMore, hasMore, isLoadingMore, loading, isSearchMode, observerTargetNode]);

  const showHeroSurface = !isSearchMode && !debouncedQuery.trim()
    && !hasActiveFilters
    && sortBy === 'popular'
    && activeCategory === 'Tout';

  return <DiscoverView model={{ homeNotice, homePageError, retryHomePage, c411Available, shows, isSearchMode, enterSearch, exitSearch, searchElapsedMs, activeCategory, activeFilterCount, activeHeroIndex, addShow, containerRef, debouncedQuery, deleteShow, handleAddMedia, handleHeroScroll, handleLongPress, handleOpenTrailer, handleToggleWatched, hasActiveFilters, hasMore, heroCarouselRef, heroDetails, isLoadingMore, isOffline, isSearchFocused, loading, minRating, movieReleaseAfterYear, movieResults, observerTargetRef, onShowClick, openPersonModal, pegi, personResults, previewMedia, processRawResults, processedResults, query, selectedGenres, selectedPersonId, selectedPlatforms, seriesResults, setActiveCategory, setActiveHeroIndex, setIsSearchFocused, setMinRating, setMovieReleaseAfterYear, setPegi, setPreviewMedia, setQuery, setSelectedGenres, setSelectedPersonId, setSelectedPlatforms, setShowGenreMenu, setSortBy, setSortOrder, setTrailerModalVideos, showGenreMenu, showHeroSurface, showsByTmdbId, sortBy, top10, trailerModalVideos, uniqueProcessedResults, visibleHeroItems, visibleMovieResults, visiblePersonResults, visibleProcessedResults, visibleSeriesResults }} />;
}
