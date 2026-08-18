import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Search, Plus, Check, WifiOff, Star, X, 
  SlidersHorizontal, ArrowUp, ArrowDown, Film, Tv, Users, User,
  Info, Sparkles, ChevronRight, CheckCircle, CheckCircle2, Play, Archive, XCircle,
  Ticket, MonitorPlay, Flame, Loader2, Calendar
} from 'lucide-react';
import { tmdb, isMovieAtCinema, isMovieUpcoming, type TMDBMedia } from '../features/shows/tmdb';
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

function useDebounce<T>(value: T, delay: number): [T] {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return [debouncedValue];
}

interface Props {
  onShowClick: (id: any, mediaType?: 'tv' | 'movie') => void;
}

const CATEGORIES = [
  { id: "Tout", label: "Tout" },
  { id: "Séries", label: "Séries" },
  { id: "Films", label: "Films" },
  { id: "Pépites", label: "Pépites" },
  { id: "Au cinéma", label: "Au cinéma" },
  { id: "Documentaires", label: "Documentaires" },
  { id: "Personnes", label: "Personnes" }
];

const SORT_OPTIONS = [
  { id: 'popular', label: 'Populaires' },
  { id: 'rating', label: 'Mieux notés' },
  { id: 'date', label: 'Plus récents' },
  { id: 'title', label: 'Ordre alphabétique' }
];

interface GenreOption {
  id: string;
  label: string;
  tmdbIds: number[];
}

const GENRE_OPTIONS: GenreOption[] = [
  { id: 'action', label: 'Action & Aventure', tmdbIds: [28, 12, 10759] },
  { id: 'animation', label: 'Animation', tmdbIds: [16] },
  { id: 'comedie', label: 'Comédie', tmdbIds: [35] },
  { id: 'crime', label: 'Crime & Thriller', tmdbIds: [80, 53] },
  { id: 'docu', label: 'Documentaire', tmdbIds: [99] },
  { id: 'drame', label: 'Drame', tmdbIds: [18] },
  { id: 'familial', label: 'Familial', tmdbIds: [10751, 10762] },
  { id: 'fantastique', label: 'Fantastique', tmdbIds: [14, 10765] },
  { id: 'horreur', label: 'Horreur', tmdbIds: [27] },
  { id: 'mystere', label: 'Mystère', tmdbIds: [9648] },
  { id: 'romance', label: 'Romance', tmdbIds: [10749] },
  { id: 'scifi', label: 'Science-Fiction', tmdbIds: [878, 10765] },
  { id: 'western', label: 'Western', tmdbIds: [37] },
  { id: 'guerre', label: 'Guerre & Histoire', tmdbIds: [10752, 36, 10768] }
];

function checkIsUpToDate(show: any): boolean {
  if (!show || show.status === 'dropped') return false;
  if (show.isArchived) return true;
  if (show.mediaType === 'movie') {
    return show.status === 'completed' || show.seenEpisodes?.includes('movie');
  }
  if (show.status === 'up_to_date' || show.status === 'completed') return true;
  
  const watchedCount = show.seenEpisodes ? show.seenEpisodes.length : 0;
  if (watchedCount > 0) {
    if (!show.nextEpisodeToWatch) return true;
    if (show.nextEpisodeToWatch.air_date) {
      const airMs = new Date(show.nextEpisodeToWatch.air_date).getTime();
      if (!isNaN(airMs) && airMs > Date.now()) {
        return true;
      }
    }
    if (show.totalEpisodes && show.totalEpisodes > 0 && watchedCount >= show.totalEpisodes) {
      return true;
    }
  }
  return false;
}

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
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  
  const [activeCategory, setActiveCategory] = useState("Tout");

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
  const [showGenreMenu, setShowGenreMenu] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState<number | null>(null);

  const [activeHeroIndex, setActiveHeroIndex] = useState(0);
  const heroCarouselRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const openPersonModal = (personId: number) => {
    setSelectedPersonId(personId);
    const currentState = window.history.state || {};
    window.history.pushState({ ...currentState, isModal: true, isPersonDetailModal: true }, '');
  };

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (!event.state || !event.state.isPersonDetailModal) {
        setSelectedPersonId(null);
      }
    };
    const handleCloseModals = () => {
      setSelectedPersonId(null);
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
      
      // Remettre le Top 10 à la 1ère position
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
      showToast('Filtres et recherche réinitialisés', 'info');
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

  const [isSearchVisible, setIsSearchVisible] = useState(true);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const lastScrollY = useRef(0);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
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

  // Réinitialiser la position du Top 10 si la catégorie change
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

  // Snapshot des films/séries vus au chargement ou changement de catégorie/recherche/filtre
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

  const handleToggleWatched = async (media: TMDBMedia) => {
    const isTv = media.media_type === 'tv' || activeCategory === 'Séries' || media.first_air_date !== undefined;
    const titleToUse = media.name || media.title || media.original_name || media.original_title || '';
    const numId = Number(media.id);
    const existingShow = showsByTmdbId.get(numId);

    if (existingShow) {
      if (isTv) {
        // TV Show specific logic
        const isUpToDate = checkIsUpToDate(existingShow);
        const isDropped = existingShow.status === 'dropped';
        const isArchived = existingShow.isArchived;

        const oldStatus = existingShow.status;
        const oldSeenEpisodes = existingShow.seenEpisodes || [];
        const oldIsArchived = existingShow.isArchived;

        if (isUpToDate || isDropped || isArchived || existingShow.status === 'completed') {
          // Revert to 'plan_to_watch' (not seen)
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
          // Mark all available episodes as seen?
          // Usually we don't want to auto-complete all episodes on toggle, 
          // but if they click the action button (which is Continuer/Commencer), 
          // it opens the modal, so this is just a fallback.
          await updateShow(existingShow.id, {
            status: 'plan_to_watch',
            seenEpisodes: [], // they shouldn't hit this since GridMediaCard redirects to modal
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
        // Movie logic
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
  };

  const handleAddMedia = async (media: TMDBMedia) => {
    const isTv = media.media_type === 'tv' || activeCategory === 'Séries';
    const titleToUse = media.name || media.title || media.original_name || media.original_title || '';
    
    // Si c'est déjà dans la liste, on ne fait rien (ou on pourrait le retirer, mais l'UI le bloque normalement)
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
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (isSearchFocused) return;
    const currentScrollY = e.currentTarget.scrollTop;
    
    // Si on est proche du haut, on affiche toujours la recherche et on masque la flèche
    if (currentScrollY < 300) {
      setIsSearchVisible(true);
      setShowScrollTop(false);
    } 
    // Si on scrolle vers le BAS de plus de 10px -> On cache la recherche et la flèche
    else if (currentScrollY > lastScrollY.current + 10) {
      setIsSearchVisible(false);
      setShowScrollTop(false);
    } 
    // Si on scrolle vers le HAUT de plus de 10px -> On affiche la recherche et la flèche
    else if (currentScrollY < lastScrollY.current - 10) {
      setIsSearchVisible(true);
      if (currentScrollY > 300) {
        setShowScrollTop(true);
      }
    }
    
    lastScrollY.current = currentScrollY;
  };

  const hasActiveFilters = selectedPlatforms.length > 0 || selectedGenres.length > 0 || pegi !== 'Tous' || minRating !== 'Toutes';

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
  const [prevLoadedCount, setPrevLoadedCount] = useState(0);

  const touchStartY = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current !== null) {
      const diff = e.touches[0].clientY - touchStartY.current;
      // Swipe vers le bas -> Masquer la barre
      if (diff > 25 && isSearchVisible) {
        setIsSearchVisible(false);
        touchStartY.current = null;
      }
      // Swipe vers le haut -> Faire revenir la barre
      else if (diff < -25 && !isSearchVisible) {
        setIsSearchVisible(true);
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
    setPrevLoadedCount(0);
  }, [activeCategory, debouncedQuery, selectedPlatforms, selectedGenres, pegi, minRating]);

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
    if (isOffline || debouncedQuery.trim()) return;
    async function fetchHome() {
      if (page === 1) setLoading(true);
      
      if (page === 1) {
        const recs = await getRecommendations(20);
        setRecommendations(recs);
      }

      if (activeCategory === 'Personnes') {
        const personRes = await tmdb.getPopularPersons(page);
        if (personRes?.ok && personRes.value.results) {
          const persons = personRes.value.results.map(p => ({ ...p, media_type: 'person' }));
          setPopularPersons(prev => {
            const updated = page === 1 ? persons : mergeMedia(prev, persons);
            if (page > 1 && updated.length === prev.length) setHasMore(false);
            return updated;
          });
          if (!personRes.value.results.length || (personRes.value.total_pages && page >= personRes.value.total_pages)) {
            setHasMore(false);
          }
        } else {
          setHasMore(false);
        }
      } else if (selectedGenres.length > 0 || pegi !== 'Tous' || minRating !== 'Toutes') {
        const filterType = (activeCategory === 'Films' || activeCategory === 'Au cinéma') ? 'movie' : (activeCategory === 'Séries' ? 'tv' : 'all');
        const discoverRes = await tmdb.discoverWithFilters({
          type: filterType,
          page,
          watchProviders: selectedPlatforms,
          genres: selectedGenres,
          pegi,
          minRating,
          sortBy
        });

        if (discoverRes?.ok && discoverRes.value.results) {
          const results = discoverRes.value.results;
          setPopular(prev => {
            const updated = page === 1 ? results : mergeMedia(prev, results);
            if (page > 1 && updated.length === prev.length) setHasMore(false);
            return updated;
          });
          if (page === 1) {
            const top10 = results.slice(0, 10);
            setTrending(top10);
            for (const item of top10) {
              if (item.media_type === 'tv' || item.first_air_date) {
                tmdb.getShowDetails(item.id).then(res => { if (res.ok) setHeroDetails(prev => ({ ...prev, [item.id]: res.value })); });
              } else {
                tmdb.getMovieDetails(item.id).then(res => { if (res.ok) setHeroDetails(prev => ({ ...prev, [item.id]: res.value })); });
              }
            }
          }
          if (results.length === 0 || (discoverRes.value.total_pages && page >= discoverRes.value.total_pages)) {
            setHasMore(false);
          }
        } else {
          setHasMore(false);
        }
      } else if (activeCategory === 'Pépites') {
        const topRes = await tmdb.getTopRatedRecent('all', page, selectedPlatforms);
        if (topRes?.ok && topRes.value.results) {
          setPopular(prev => {
            const updated = page === 1 ? topRes.value.results : mergeMedia(prev, topRes.value.results);
            if (page > 1 && updated.length === prev.length) setHasMore(false);
            return updated;
          });
          if (page === 1) {
            const top10 = topRes.value.results.slice(0, 10);
            setTrending(top10);
            for (const item of top10) {
              if (item.media_type === 'tv' || item.first_air_date) {
                tmdb.getShowDetails(item.id).then(res => { if (res.ok) setHeroDetails(prev => ({ ...prev, [item.id]: res.value })); });
              } else {
                tmdb.getMovieDetails(item.id).then(res => { if (res.ok) setHeroDetails(prev => ({ ...prev, [item.id]: res.value })); });
              }
            }
          }
          if (!topRes.value.results.length || (topRes.value.total_pages && page >= topRes.value.total_pages)) {
            setHasMore(false);
          }
        } else {
          setHasMore(false);
        }
      } else if (activeCategory === 'Au cinéma') {
        const cinemaRes = await tmdb.getNowPlaying(page);
        if (cinemaRes?.ok && cinemaRes.value.results) {
          const movies = cinemaRes.value.results
            .map(r => ({ ...r, media_type: 'movie' as const }))
            .filter(r => isMovieAtCinema(r));
          setPopular(prev => {
            const updated = page === 1 ? movies : mergeMedia(prev, movies);
            if (page > 1 && updated.length === prev.length) setHasMore(false);
            return updated;
          });
          if (page === 1) {
            const top10 = movies.slice(0, 10);
            setTrending(top10);
            for (const item of top10) {
              tmdb.getMovieDetails(item.id).then(res => { if (res.ok) setHeroDetails(prev => ({ ...prev, [item.id]: res.value })); });
            }
          }
          if (movies.length === 0 || !cinemaRes.value.results.length || (cinemaRes.value.total_pages && page >= cinemaRes.value.total_pages)) {
            setHasMore(false);
          }
        } else {
          setHasMore(false);
        }
      } else if (activeCategory === 'Documentaires') {
        const [docMovRes, docTvRes] = await Promise.all([
          tmdb.discoverByGenre('movie', 99, page, selectedPlatforms),
          tmdb.discoverByGenre('tv', 99, page, selectedPlatforms)
        ]);
        const docs = [
          ...(docMovRes?.ok ? docMovRes.value.results.map(r => ({ ...r, media_type: 'movie', genre_ids: [...(r.genre_ids || []), 99] })) : []),
          ...(docTvRes?.ok ? docTvRes.value.results.map(r => ({ ...r, media_type: 'tv', genre_ids: [...(r.genre_ids || []), 99] })) : [])
        ];
        setPopular(prev => {
          const updated = page === 1 ? docs : mergeMedia(prev, docs);
          if (page > 1 && updated.length === prev.length) setHasMore(false);
          return updated;
        });
        if (docs.length === 0) setHasMore(false);
      } else if (activeCategory === 'Tout') {
        const [trendAllRes, popTvRes, popMovRes, personRes] = await Promise.all([
          page <= 5 ? tmdb.getTrending('all', page, selectedPlatforms) : Promise.resolve({ ok: false } as any),
          tmdb.getPopular('tv', page, selectedPlatforms),
          tmdb.getPopular('movie', page, selectedPlatforms),
          page <= 3 ? tmdb.getPopularPersons(page) : Promise.resolve({ ok: false } as any)
        ]);
        const isRecent = (r: TMDBMedia) => {
          const date = r.first_air_date || r.release_date;
          if (!date) return true;
          const yr = parseInt(date.split('-')[0], 10);
          return !yr || yr >= 2016;
        };
        const trendingList = trendAllRes?.ok ? trendAllRes.value.results.filter(isRecent) : [];
        const popularList = [
          ...(popTvRes?.ok ? popTvRes.value.results.filter(isRecent).map(r => ({ ...r, media_type: 'tv' as const })) : []),
          ...(popMovRes?.ok ? popMovRes.value.results.filter(isRecent).map(r => ({ ...r, media_type: 'movie' as const })) : [])
        ];
        
        if (personRes?.ok && personRes.value.results) {
          const persons = personRes.value.results.map((p: any) => ({ ...p, media_type: 'person' }));
          setPopularPersons(prev => page === 1 ? persons : mergeMedia(prev, persons));
        }

        if (trendingList.length > 0) {
          setTrending(prev => page === 1 ? trendingList : mergeMedia(prev, trendingList));
        }

        setPopular(prev => {
          const combined = [...trendingList, ...popularList];
          const toAdd = combined.length > 0 ? combined : popularList;
          const updated = page === 1 ? toAdd : mergeMedia(prev, toAdd);
          if (page > 1 && updated.length === prev.length) setHasMore(false);
          return updated;
        });

        if (page === 1) {
          const top10 = (trendingList.length > 0 ? trendingList : popularList).slice(0, 10);
          for (const item of top10) {
            if (item.media_type === 'tv') {
              tmdb.getShowDetails(item.id).then(res => { if (res.ok) setHeroDetails(prev => ({ ...prev, [item.id]: res.value })); });
            } else {
              tmdb.getMovieDetails(item.id).then(res => { if (res.ok) setHeroDetails(prev => ({ ...prev, [item.id]: res.value })); });
            }
          }
        }
        if (popularList.length === 0 && trendingList.length === 0) setHasMore(false);
      } else {
        const type = activeCategory === 'Films' ? 'movie' : 'tv';
        const [trendRes, popRes] = await Promise.all([
          page <= 5 ? tmdb.getTrending(type, page, selectedPlatforms) : Promise.resolve({ ok: false } as any),
          tmdb.getPopular(type, page, selectedPlatforms)
        ]);
        
        const isRecent = (r: TMDBMedia) => {
          const date = r.first_air_date || r.release_date;
          if (!date) return true;
          const yr = parseInt(date.split('-')[0], 10);
          return !yr || yr >= 2016;
        };

        const trendList = trendRes?.ok ? trendRes.value.results.filter(isRecent).map((r: any) => ({ ...r, media_type: type as 'movie' | 'tv' })) : [];
        const popList = popRes?.ok ? popRes.value.results.filter(isRecent).map((r: any) => ({ ...r, media_type: type as 'movie' | 'tv' })) : [];
        const combined = mergeMedia(trendList, popList);
        const toAdd = combined.length > 0 ? combined : popList;

        if (trendList.length > 0) {
          setTrending(prev => page === 1 ? trendList : mergeMedia(prev, trendList));
        }

        setPopular(prev => {
          const updated = page === 1 ? toAdd : mergeMedia(prev, toAdd);
          if (page > 1 && updated.length === prev.length) setHasMore(false);
          return updated;
        });

        if (page === 1) {
          const top10 = toAdd.slice(0, 10);
          setTrending(top10);
          for (const item of top10) {
            if (type === 'tv') {
              tmdb.getShowDetails(item.id).then(res => { if (res.ok) setHeroDetails(prev => ({ ...prev, [item.id]: res.value })); });
            } else {
              tmdb.getMovieDetails(item.id).then(res => { if (res.ok) setHeroDetails(prev => ({ ...prev, [item.id]: res.value })); });
            }
          }
        }
        if (popList.length === 0 && trendList.length === 0) setHasMore(false);
      }
      setLoading(false);
      setIsLoadingMore(false);
    }
    if (!debouncedQuery) fetchHome();
  }, [debouncedQuery, isOffline, activeCategory, page, selectedPlatforms, selectedGenres, pegi, minRating, sortBy]);

  useEffect(() => {
    if (isOffline || !debouncedQuery.trim()) {
      setSearchResults([]);
      setHasMore(true);
      return;
    }
    async function search() {
      setLoading(true);
      setTotalTvCount(null);
      setTotalMovieCount(null);

      const [res1, res2] = await Promise.all([
        tmdb.smartSearchMulti(debouncedQuery, 1, selectedPlatforms),
        tmdb.smartSearchMulti(debouncedQuery, 2, selectedPlatforms)
      ]);

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
    search();
  }, [debouncedQuery, isOffline, selectedPlatforms]);

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

  const processedResults = useMemo(() => {
    let list = [...rawList];
    const qClean = debouncedQuery.trim().toLowerCase();

    // Filtre sur le nombre d'avis
    list = list.filter(item => {
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

      if (!qClean) {
        const dateStr = item.first_air_date || item.release_date;
        if (dateStr) {
          const year = parseInt(dateStr.split('-')[0], 10);
          if (year && year < 2016) {
            return false;
          }
        }
        return count >= 50;
      }

      return true;
    });

    if (selectedGenreIds.length > 0 && !qClean && activeCategory !== 'Personnes') {
      const allowedTmdbIds = selectedGenreIds.flatMap(id => GENRE_OPTIONS.find(g => g.id === id)?.tmdbIds || []);
      list = list.filter(item => {
        const itemG = item.genre_ids || (item.genres ? item.genres.map((g: any) => g.id) : []);
        return allowedTmdbIds.some(gId => itemG.includes(gId));
      });
    }

    if (selectedGenres.length > 0 && !qClean && activeCategory !== 'Personnes') {
      const NEW_GENRE_MAPPING: Record<string, number[]> = {
        'Action': [28, 10759],
        'Aventure': [12, 10759],
        'Animation': [16],
        'Biopic': [36, 99],
        'Comédie': [35],
        'Drame': [18],
        'Fantastique': [14, 10765],
        'Horreur': [27],
        'Romance': [10749],
        'Sci-Fi': [878, 10765],
        'Thriller': [53, 80]
      };
      const allowedTmdbIds = selectedGenres.flatMap(g => NEW_GENRE_MAPPING[g] || []);
      list = list.filter(item => {
        const itemG = item.genre_ids || (item.genres ? item.genres.map((g: any) => g.id) : []);
        return allowedTmdbIds.some(gId => itemG.includes(gId));
      });
    }

    if (pegi !== 'Tous' && activeCategory !== 'Personnes') {
      list = list.filter(item => {
        const itemG = item.genre_ids || (item.genres ? item.genres.map((g: any) => g.id) : []);
        const details = heroDetails[item.id];
        
        let ratingStr = '';
        if (details) {
          if (details.content_ratings?.results) {
            const fr = details.content_ratings.results.find((r: any) => r.iso_3166_1 === 'FR');
            const us = details.content_ratings.results.find((r: any) => r.iso_3166_1 === 'US');
            ratingStr = fr?.rating || us?.rating || '';
          }
          if (!ratingStr && details.release_dates?.results) {
            const fr = details.release_dates.results.find((r: any) => r.iso_3166_1 === 'FR');
            const us = details.release_dates.results.find((r: any) => r.iso_3166_1 === 'US');
            const certFr = fr?.release_dates?.find((d: any) => d.certification && d.certification.trim() !== '');
            const certUs = us?.release_dates?.find((d: any) => d.certification && d.certification.trim() !== '');
            ratingStr = certFr?.certification || certUs?.certification || '';
          }
        }

        const r = (ratingStr || '').trim().toUpperCase();
        let tier = '';
        if (item.adult || r === '18' || r === '-18' || r === '16' || r === '-16' || r === 'TV-MA' || r === 'R' || r === 'NC-17') {
          tier = '16';
        } else if (r === '12' || r === '-12' || r === 'TV-14' || r === 'PG-13') {
          tier = '12';
        } else if (r === '10' || r === '-10' || r === 'TV-PG' || r === 'PG') {
          tier = '10';
        } else if (r === 'U' || r === 'G' || r === 'TV-G' || r === 'TV-Y' || r === 'TV-Y7' || r.includes('TOUS')) {
          tier = 'TP';
        } else {
          if (itemG.includes(27)) tier = '16';
          else if (itemG.includes(10762) || itemG.includes(10751)) tier = 'TP';
          else if (itemG.includes(53) || itemG.includes(80) || itemG.includes(10752) || itemG.includes(10768)) tier = '12';
          else if (itemG.includes(28) || itemG.includes(12) || itemG.includes(878)) tier = '12';
          else tier = 'TP';
        }

        if (pegi === '16' || pegi === '-16' || pegi === '16+') {
          return tier === '16';
        } else if (pegi === '12' || pegi === '-12' || pegi === '12+') {
          return tier === '12';
        } else if (pegi === '10' || pegi === '-10' || pegi === '10+') {
          return tier === '10';
        } else if (pegi === 'TP' || pegi === 'Tout Public') {
          return tier === 'TP';
        }
        return true;
      });
    }

    if (minRating !== 'Toutes' && !qClean && activeCategory !== 'Personnes') {
      const min = parseFloat(minRating.replace('+', ''));
      list = list.filter(item => (item.vote_average || 0) >= min);
    }

    if (!qClean) {
      if (activeCategory === 'Séries') {
        list = list.filter(item => item.media_type === 'tv' || item.media_type === 'series' || !!item.first_air_date);
      } else if (activeCategory === 'Films') {
        list = list.filter(item => item.media_type === 'movie' || !!item.release_date);
      } else if (activeCategory === 'Personnes') {
        list = list.filter(item => item.media_type === 'person');
      }
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
    } else if (sortBy !== 'popular' || (!qClean && sortBy === 'popular')) {
      if (sortBy !== 'popular') {
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
    }

    // Exclure les contenus vus au dernier refresh (seulement hors recherche active)
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
  }, [rawList, debouncedQuery, selectedGenreIds, selectedGenres, minRating, pegi, sortBy, sortOrder, activeCategory, watchedIdsSnapshot]);

  const top10 = useMemo(() => {
    if (debouncedQuery.trim() || activeCategory === 'Personnes') return [];
    const seen = new Set<string>();
    const list: TMDBMedia[] = [];
    for (const item of processedResults) {
      if (activeCategory === 'Au cinéma' && !isMovieAtCinema(item)) continue;
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
  }, [processedResults, activeCategory, debouncedQuery]);

  useEffect(() => {
    for (const item of top10) {
      if (item?.id && !heroDetails[item.id]) {
        const type = item.media_type === 'movie' || item.release_date ? 'movie' : 'tv';
        if (type === 'tv') {
          tmdb.getShowDetails(item.id).then(res => { if (res.ok) setHeroDetails(prev => ({ ...prev, [item.id]: res.value })); });
        } else {
          tmdb.getMovieDetails(item.id).then(res => { if (res.ok) setHeroDetails(prev => ({ ...prev, [item.id]: res.value })); });
        }
      }
    }
  }, [top10, heroDetails]);

  useEffect(() => {
    setActiveHeroIndex(0);
  }, [activeCategory, selectedGenres, selectedPlatforms, pegi, minRating]);

  const uniqueProcessedResults = useMemo(() => {
    const seen = new Set<string>();
    const top10Keys = (!debouncedQuery.trim() && top10.length > 0 && (activeCategory === 'Tout' || activeCategory === 'Séries' || activeCategory === 'Films' || activeCategory === 'Pépites' || activeCategory === 'Au cinéma'))
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
  const visibleProcessedResults = uniqueProcessedResults;

  const handleLoadMore = () => {
    if (isLoadingMore || loading || !hasMore || debouncedQuery.trim()) return;
    setPrevLoadedCount(uniqueProcessedResults.length);
    setIsLoadingMore(true);
    setPage(p => p + 1);
  };

  const observerRef = useRef<IntersectionObserver | null>(null);

  const observerTargetRef = React.useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
    }
    if (node && !isLoadingMore && !loading && hasMore) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && !isLoadingMore && !loading && hasMore) {
            handleLoadMore();
          }
        },
        { root: containerRef.current || undefined, rootMargin: '400px' }
      );
      observerRef.current.observe(node);
    }
  }, [isLoadingMore, loading, hasMore, uniqueProcessedResults.length]);

  useEffect(() => {
    return () => {
      if (observerRef.current) observerRef.current.disconnect();
    };
  }, []);

  const searchQuery = query;
  const setSearchQuery = setQuery;

  return (
    <div className="relative flex-1 h-full bg-transparent text-white max-w-2xl mx-auto w-full overflow-hidden flex flex-col">
      {/* Scroll to Top Button */}
      <button
        onClick={() => {
          containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
          setShowScrollTop(false);
        }}
        aria-label="Remonter tout en haut"
        title="Remonter tout en haut"
        className={cn(
          "absolute top-4 left-1/2 -translate-x-1/2 z-40 flex items-center justify-center p-2.5 rounded-full bg-zinc-900/90 text-white border border-white/20 shadow-2xl backdrop-blur-xl transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-zinc-800 hover:scale-110 active:scale-95",
          showScrollTop
            ? "opacity-100 translate-y-0 pointer-events-auto shadow-black/80"
            : "opacity-0 -translate-y-6 pointer-events-none"
        )}
      >
        <ArrowUp size={18} className="text-white stroke-[2.5]" />
      </button>

      {/* Offline Banner */}
      {isOffline && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center gap-2 text-amber-400 text-xs font-medium">
          <WifiOff size={14} />
          <span>Mode hors ligne. Affichage des contenus en cache.</span>
        </div>
      )}

      {/* Main Content */}
      <div 
        ref={containerRef}
        className={cn(
          "flex-1 overflow-y-auto px-0 pb-20 hide-scrollbar space-y-5",
          debouncedQuery.trim() ? "pt-4 sm:pt-6" : "pt-0"
        )}
        onScroll={handleScroll}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Section Top 10 (Full Width Hero Cards Carousel) */}
        {!debouncedQuery.trim() && top10.length > 0 && (activeCategory === 'Tout' || activeCategory === 'Séries' || activeCategory === 'Films' || activeCategory === 'Pépites' || activeCategory === 'Au cinéma') && (
          <div>
            <div className="relative w-full">
              <div 
                ref={heroCarouselRef}
                onScroll={handleHeroScroll}
                className="flex w-full overflow-x-auto snap-x snap-mandatory hide-scrollbar"
              >
                {top10.map((item, index) => (
                  <div key={`top10_${item.media_type || 'media'}_${item.id}_${index}`} className="w-full shrink-0 snap-center">
                    <HeroCard 
                      media={item} 
                      details={heroDetails[item.id]}
                      onShowClick={onShowClick}
                      onOpenTrailer={handleOpenTrailer}
                      rank={index + 1}
                      activeCategory={activeCategory}
                      show={showsByTmdbId.get(Number(item.id))}
                      addShow={addShow}
                      deleteShow={deleteShow}
                    />
                  </div>
                ))}
              </div>

              {/* Carousel Pagination Dots */}
              {top10.length > 1 && (
                <div className="flex justify-center items-center gap-1.5 mt-3 mb-2">
                  {top10.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveHeroIndex(idx);
                        if (heroCarouselRef.current) {
                          const width = heroCarouselRef.current.clientWidth;
                          heroCarouselRef.current.scrollTo({ left: idx * width, behavior: 'smooth' });
                        }
                      }}
                      className={cn(
                        "transition-all duration-300 rounded-full cursor-pointer",
                        activeHeroIndex === idx 
                          ? "w-6 h-1.5 bg-[#E5A93D]" 
                          : "w-1.5 h-1.5 bg-zinc-700 hover:bg-zinc-500"
                      )}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Categories Bar (Explore Mode Only) */}
        {!debouncedQuery.trim() && (
          <div className="px-2.5 sm:px-4">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none px-0.5">
              {CATEGORIES.map(category => (
                <button
                  key={category.id}
                  onClick={() => setActiveCategory(category.id)}
                  className={cn(
                    "px-4 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer",
                    activeCategory === category.id
                      ? "bg-[#E5A93D] text-black shadow-md shadow-[#E5A93D]/20"
                      : "bg-[#1C1C1E] text-zinc-400 hover:text-white hover:bg-zinc-800 border border-white/5"
                  )}
                >
                  {category.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Section Résultats */}
        <div className="px-2.5 sm:px-4 space-y-4">
          <div className="flex items-center justify-between mb-2 px-1">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              {debouncedQuery.trim() ? (
                <>
                  <span className="text-base">🔍</span>
                  <span>Résultats</span>
                </>
              ) : (
                <>
                  <span className="text-base">🧭</span>
                  <span>Explorer</span>
                </>
              )}
            </h2>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'popular' | 'rating' | 'date' | 'title')}
              className="bg-[#1C1C1E] text-xs font-semibold text-zinc-300 py-1.5 px-3 rounded-full border border-white/10 outline-none cursor-pointer hover:bg-zinc-800 transition-colors"
            >
              <option value="popular">Popularité</option>
              <option value="rating">Mieux notés</option>
              <option value="date">Plus récents</option>
              <option value="title">Titre</option>
            </select>
          </div>

          {debouncedQuery.trim() && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1 mb-1 scrollbar-none px-0.5">
              <button
                onClick={() => setActiveCategory('Tout')}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer flex items-center gap-1.5",
                  activeCategory === 'Tout'
                    ? "bg-[#E5A93D] text-black shadow-md shadow-[#E5A93D]/20"
                    : "bg-[#1C1C1E] text-zinc-400 hover:text-white hover:bg-zinc-800 border border-white/5"
                )}
              >
                <span>Tout</span>
                <span className={cn("text-[10px] px-1.5 py-0.2 rounded-full font-extrabold", activeCategory === 'Tout' ? "bg-black/20 text-black" : "bg-white/10 text-zinc-400")}>
                  {uniqueProcessedResults.length}
                </span>
              </button>

              {personResults.length > 0 && (
                <button
                  onClick={() => setActiveCategory('Personnes')}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer flex items-center gap-1.5",
                    activeCategory === 'Personnes'
                      ? "bg-amber-500 text-black shadow-md shadow-amber-500/20"
                      : "bg-[#1C1C1E] text-zinc-400 hover:text-white hover:bg-zinc-800 border border-white/5"
                  )}
                >
                  <User size={13} />
                  <span>Personnes</span>
                  <span className={cn("text-[10px] px-1.5 py-0.2 rounded-full font-extrabold", activeCategory === 'Personnes' ? "bg-black/20 text-black" : "bg-white/10 text-zinc-400")}>
                    {personResults.length}
                  </span>
                </button>
              )}

              {seriesResults.length > 0 && (
                <button
                  onClick={() => setActiveCategory('Séries')}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer flex items-center gap-1.5",
                    activeCategory === 'Séries'
                      ? "bg-indigo-500 text-white shadow-md shadow-indigo-500/20"
                      : "bg-[#1C1C1E] text-zinc-400 hover:text-white hover:bg-zinc-800 border border-white/5"
                  )}
                >
                  <Tv size={13} />
                  <span>Séries</span>
                  <span className={cn("text-[10px] px-1.5 py-0.2 rounded-full font-extrabold", activeCategory === 'Séries' ? "bg-white/20 text-white" : "bg-white/10 text-zinc-400")}>
                    {seriesResults.length}
                  </span>
                </button>
              )}

              {movieResults.length > 0 && (
                <button
                  onClick={() => setActiveCategory('Films')}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer flex items-center gap-1.5",
                    activeCategory === 'Films'
                      ? "bg-rose-500 text-white shadow-md shadow-rose-500/20"
                      : "bg-[#1C1C1E] text-zinc-400 hover:text-white hover:bg-zinc-800 border border-white/5"
                  )}
                >
                  <Film size={13} />
                  <span>Films</span>
                  <span className={cn("text-[10px] px-1.5 py-0.2 rounded-full font-extrabold", activeCategory === 'Films' ? "bg-white/20 text-white" : "bg-white/10 text-zinc-400")}>
                    {movieResults.length}
                  </span>
                </button>
              )}
            </div>
          )}

          {loading ? (
            <GridSkeletons />
          ) : processedResults.length > 0 ? (
            debouncedQuery.trim() && activeCategory === 'Tout' ? (
              <div className="space-y-6">
                {/* Section Personnes */}
                {personResults.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                          <User size={18} className="text-[#E5A93D]" />
                          <span>Personnes</span>
                        </h2>
                        <span className="text-xs font-extrabold text-zinc-400 bg-zinc-900/80 px-2.5 py-0.5 rounded-full border border-white/10 shadow-sm">
                          {personResults.length}
                        </span>
                      </div>
                      {personResults.length > 4 && (
                        <button 
                          onClick={() => setActiveCategory('Personnes')}
                          className="text-xs font-bold text-[#E5A93D] hover:underline cursor-pointer"
                        >
                          Voir tout
                        </button>
                      )}
                    </div>
                    <div className="flex gap-1.5 sm:gap-1.5 overflow-x-auto pb-2 pt-0.5 px-0.5 scrollbar-none snap-x">
                      {personResults.map((item, idx) => (
                        <PersonCard 
                          key={`search_person_${item.id}_${idx}`} 
                          person={item} 
                          onClick={id => openPersonModal(id)} 
                          isRowItem
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Section Séries */}
                {seriesResults.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                          <Tv size={18} className="text-[#E5A93D]" />
                          <span>Séries</span>
                        </h2>
                        <span className="text-xs font-extrabold text-zinc-400 bg-zinc-900/80 px-2.5 py-0.5 rounded-full border border-white/10 shadow-sm">
                          {seriesResults.length}
                        </span>
                      </div>
                      {seriesResults.length > 4 && (
                        <button 
                          onClick={() => setActiveCategory('Séries')}
                          className="text-xs font-bold text-[#E5A93D] hover:underline cursor-pointer"
                        >
                          Voir tout
                        </button>
                      )}
                    </div>
                    <div className="flex gap-1.5 sm:gap-1.5 overflow-x-auto pb-2 pt-0.5 px-0.5 scrollbar-none snap-x">
                      {seriesResults.map((item, idx) => (
                        <div key={`search_tv_${item.id}_${idx}`} className="w-[calc((100vw-0.5rem-12px)/3)] sm:w-[calc((100vw-0.5rem-18px)/4)] shrink-0 snap-start">
                          <GridMediaCard 
                            media={item} 
                            onShowClick={onShowClick}
                            show={showsByTmdbId.get(Number(item.id))}
                            onAddClick={handleAddMedia}
                            onToggleWatched={handleToggleWatched}
                            onLongPress={(media) => setPreviewMedia(media)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Section Films */}
                {movieResults.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                          <Film size={18} className="text-[#E5A93D]" />
                          <span>Films</span>
                        </h2>
                        <span className="text-xs font-extrabold text-zinc-400 bg-zinc-900/80 px-2.5 py-0.5 rounded-full border border-white/10 shadow-sm">
                          {movieResults.length}
                        </span>
                      </div>
                      {movieResults.length > 4 && (
                        <button 
                          onClick={() => setActiveCategory('Films')}
                          className="text-xs font-bold text-[#E5A93D] hover:underline cursor-pointer"
                        >
                          Voir tout
                        </button>
                      )}
                    </div>
                    <div className="flex gap-1.5 sm:gap-1.5 overflow-x-auto pb-2 pt-0.5 px-0.5 scrollbar-none snap-x">
                      {movieResults.map((item, idx) => (
                        <div key={`search_movie_${item.id}_${idx}`} className="w-[calc((100vw-0.5rem-12px)/3)] sm:w-[calc((100vw-0.5rem-18px)/4)] shrink-0 snap-start">
                          <GridMediaCard 
                            media={item} 
                            onShowClick={onShowClick}
                            show={showsByTmdbId.get(Number(item.id))}
                            onAddClick={handleAddMedia}
                            onToggleWatched={handleToggleWatched}
                            onLongPress={(media) => setPreviewMedia(media)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(personResults.length > 0 || seriesResults.length > 0 || movieResults.length > 0) && (
                  <div className="w-full text-center py-3 px-4 mt-2">
                    <p className="text-xs font-medium text-zinc-500 flex items-center justify-center gap-2">
                      <span className="h-[1px] w-8 bg-zinc-800" />
                      <span>Fin des résultats</span>
                      <span className="h-[1px] w-8 bg-zinc-800" />
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-x-1.5 gap-y-4 px-1">
                  {(debouncedQuery.trim() && activeCategory === 'Personnes' ? visiblePersonResults :
                    debouncedQuery.trim() && activeCategory === 'Séries' ? visibleSeriesResults :
                    debouncedQuery.trim() && activeCategory === 'Films' ? visibleMovieResults :
                    visibleProcessedResults).map((item, idx) => (
                    item.media_type === 'person' ? (
                      <PersonCard 
                        key={`person_${item.id}_${idx}`} 
                        person={item} 
                        onClick={id => openPersonModal(id)} 
                      />
                    ) : (
                      <GridMediaCard 
                        key={`grid_${item.media_type || 'media'}_${item.id}_${idx}`} 
                        media={item} 
                        onShowClick={onShowClick}
                        show={showsByTmdbId.get(Number(item.id))}
                        isNewlyLoaded={prevLoadedCount > 0 && idx >= prevLoadedCount}
                        onAddClick={handleAddMedia}
                        onToggleWatched={handleToggleWatched}
                        onLongPress={(media) => setPreviewMedia(media)}
                      />
                    )
                  ))}
                </div>

                {!loading && (
                  <div className="w-full flex items-center justify-center mt-2 mb-1">
                    {hasMore ? (
                      <div ref={observerTargetRef} className="w-full h-8 flex items-center justify-center">
                        {isLoadingMore ? (
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#E5A93D]" />
                        ) : (
                          <div className="h-5 w-5" />
                        )}
                      </div>
                    ) : (uniqueProcessedResults.length > 0 || seriesResults.length > 0 || movieResults.length > 0 || personResults.length > 0) ? (
                      <div className="w-full text-center py-2 px-4">
                        <p className="text-xs font-medium text-zinc-500 flex items-center justify-center gap-2">
                          <span className="h-[1px] w-8 bg-zinc-800" />
                          <span>Fin des résultats</span>
                          <span className="h-[1px] w-8 bg-zinc-800" />
                        </p>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            )
          ) : (
            <div className="text-center py-16 space-y-3">
              <div className="w-12 h-12 bg-[#1C1C1E] rounded-full flex items-center justify-center mx-auto text-zinc-500">
                <Search size={24} />
              </div>
              <p className="text-sm font-medium text-zinc-400">
                Aucun résultat ne correspond à votre recherche.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* FLOATING BOTTOM SEARCH BAR */}
      <div 
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={cn(
          "absolute bottom-0 inset-x-0 px-3 pb-[calc(90px+env(safe-area-inset-bottom,0px))] pt-24 bg-gradient-to-t from-black via-black/95 to-transparent pointer-events-none z-40 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]",
          isSearchVisible ? "translate-y-0" : "translate-y-full"
        )}
      >
        <div className="flex flex-col gap-3 pointer-events-auto px-4 max-w-md mx-auto w-full">
          
          <div className="bg-[#1C1C1E]/95 backdrop-blur-xl border border-white/5 rounded-[1.75rem] p-1.5 flex items-center gap-2 shadow-[0_8px_30px_rgb(0,0,0,0.5)]">
            <div className={cn("flex items-center gap-1", (hasActiveFilters || activeCategory !== 'Tout') ? "bg-[#E5A93D]/20" : "bg-white/5", "rounded-full transition-colors shrink-0")}>
              <button 
                onClick={() => setShowGenreMenu(true)} 
                className="flex items-center gap-2 px-3.5 py-2.5 hover:bg-white/10 rounded-full transition-colors"
              >
                <SlidersHorizontal size={15} className={cn("text-zinc-400", (hasActiveFilters || activeCategory !== 'Tout') && "text-[#E5A93D]")} />
                <span className={cn("text-[14px] font-semibold text-zinc-300", (hasActiveFilters || activeCategory !== 'Tout') && "text-[#E5A93D]")}>
                  {activeCategory !== 'Tout' ? activeCategory : 'Filtres'}
                </span>
              </button>
            </div>
            
            <div className="w-px h-6 bg-white/10 shrink-0 mx-0.5" />
            
            <div className="flex-1 flex items-center gap-2 min-w-0">
              <Search size={18} className="text-zinc-500 shrink-0 ml-1" />
              <input 
                type="text" 
                placeholder="Séries, films, acteurs..." 
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => { setIsSearchFocused(true); setIsSearchVisible(true); }}
                onBlur={() => setIsSearchFocused(false)}
                className="bg-transparent border-none outline-none text-white text-[15px] font-medium w-full placeholder:text-zinc-500 min-w-0"
              />
            </div>

            {(query || hasActiveFilters || activeCategory !== 'Tout') && (
              <button 
                onClick={() => {
                  setQuery('');
                  setSelectedPlatforms([]);
                  setSelectedGenres([]);
                  setPegi('Tous');
                  setMinRating('Toutes');
                  setActiveCategory('Tout');
                }}
                className="p-2 text-[#E5A93D] hover:text-[#f8d28a] shrink-0 transition-colors"
                title="Effacer"
              >
                <X size={18} />
              </button>
            )}
          </div>

        </div>
      </div>

      {/* Swipe up gesture receiver when search bar is hidden */}
      {!isSearchVisible && (
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="fixed bottom-0 inset-x-0 h-28 z-30 pointer-events-auto"
          aria-hidden="true"
        />
      )}

      {/* Modal Preview Rapide */}
      {previewMedia && (
        <PreviewModal 
          media={previewMedia}
          isAdded={showsByTmdbId.has(Number(previewMedia.id))}
          isWatched={
            showsByTmdbId.get(Number(previewMedia.id))?.status === 'completed' ||
            showsByTmdbId.get(Number(previewMedia.id))?.seenEpisodes?.includes('movie') ||
            checkIsUpToDate(showsByTmdbId.get(Number(previewMedia.id)))
          }
          onClose={() => setPreviewMedia(null)}
          onAddClick={handleAddMedia}
          onToggleWatched={handleToggleWatched}
          onShowClick={onShowClick}
        />
      )}

      {/* Modal Détails Personne */}
      {selectedPersonId && (
        <PersonDetailModal
          personId={selectedPersonId}
          onClose={() => {
            setSelectedPersonId(null);
            if (window.history.state?.isPersonDetailModal || window.history.state?.isModal) {
              window.history.back();
            }
          }}
          onShowClick={onShowClick}
        />
      )}

      {/* Modal Trailer */}
      {trailerModalVideos && (
        <TrailerModal 
          videos={trailerModalVideos} 
          onClose={() => setTrailerModalVideos(null)} 
        />
      )}

      {/* Modal Filtres */}
      {showGenreMenu && (
        <FilterModal 
          onClose={() => setShowGenreMenu(false)} 
          activeCategory={activeCategory}
          setActiveCategory={setActiveCategory} 
          initialSelectedPlatforms={selectedPlatforms}
          initialSelectedGenres={selectedGenres}
          initialPegi={pegi}
          initialRating={minRating}
          query={query}
          onApply={(platforms, genres, newPegi, newRating) => {
            setSelectedPlatforms(platforms);
            setSelectedGenres(genres);
            setPegi(newPegi);
            setMinRating(newRating);
            setShowGenreMenu(false);
          }}
        />
      )}
    </div>
  );
}

const HeroCard = React.memo(function HeroCard({ media, details, onShowClick, onOpenTrailer, rank, activeCategory, show, addShow, deleteShow }: { key?: React.Key, media: TMDBMedia, details?: any, onShowClick: (id: any, mediaType?: 'tv' | 'movie') => void, onOpenTrailer?: (id: number, mediaType: 'tv' | 'movie') => void, rank: number, activeCategory?: string, show?: any, addShow?: any, deleteShow?: any }) {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const { showToast } = useToastStore();

  const isTv = media.media_type === 'tv' || (!media.media_type && activeCategory !== 'Films');
  
  // Logique de disponibilité des films
  const isAtCinema = !isTv && (isMovieAtCinema(media) || isMovieAtCinema(details));
  const isUpcoming = !isTv && (isMovieUpcoming(media) || isMovieUpcoming(details));

  const title = media.name || media.title || '';
  const rating = media.vote_average ? media.vote_average.toFixed(1) : details?.vote_average ? details.vote_average.toFixed(1) : null;
  const genres = details?.genres?.slice(0, 2).map((g: any) => g.name).join(' · ');
  
  const providerName = isTv ? details?.networks?.[0]?.name : details?.production_companies?.[0]?.name;
  const overview = media.overview || details?.overview;

  const handleFollowToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!addShow || !deleteShow) return;
    if (show) {
      const savedShow = { ...show };
      await deleteShow(show.id);
      showToast(
        isTv ? 'Série retirée de votre suivi' : 'Film retiré de votre liste', 
        'unfollow',
        savedShow,
        async () => {
          if (auth.currentUser && savedShow.id) {
            const docRef = doc(db, 'users', auth.currentUser.uid, 'shows', savedShow.id);
            useShowsStore.getState().addShowOptimistic(savedShow);
            await setDoc(docRef, savedShow);
          }
        }
      );
    } else {
      const newShowData = {
        tmdbId: Number(media.id),
        title,
        posterPath: media.poster_path || '',
        backdropPath: media.backdrop_path || details?.backdrop_path || '',
        year: (media.first_air_date || media.release_date || '').substring(0, 4),
        rating: rating ? parseFloat(rating) : undefined,
        mediaType: isTv ? 'tv' : 'movie' as 'tv' | 'movie',
        seasonRecords: {},
        episodeRecords: {},
        status: 'watching' as const,
        updatedAt: Date.now(),
        createdAt: Date.now(),
        seenEpisodes: [],
        isArchived: false,
      };
      
      const newId = await addShow(newShowData);
      const savedShow = { ...newShowData, id: newId, userId: '' } as Show;
      
      showToast(
        isTv ? 'Série ajoutée à votre suivi' : 'Film ajouté à votre liste', 
        'follow',
        savedShow,
        async () => {
          if (newId) {
            await deleteShow(newId);
          }
        }
      );
    }
  };

  let mainActionText = isTv ? "Suivre la série" : "Ajouter aux films";
  let MainActionIcon = Plus;
  let isTracked = false;
  let isCompleted = false;
  let buttonStyleClass = "bg-[#E5A93D] text-black hover:bg-[#f3b94c] shadow-[0_4px_15px_rgba(229,169,61,0.25)]";

  if (show && show.status !== 'dropped' && !show.isArchived) {
    isTracked = true;
    MainActionIcon = CheckCircle2;
    const seenCount = show.seenEpisodes?.length || 0;

    if (isTv) {
      let sNum = 1;
      let eNum = 1;
      if (show.nextEpisodeToWatch) {
        sNum = show.nextEpisodeToWatch.season_number || 1;
        eNum = show.nextEpisodeToWatch.episode_number || 1;
      } else if (show.seasonsCache && show.seasonsCache.length > 0) {
        const nextInfo = getNextEpisodeNumber(show.seasonsCache, show.seenEpisodes || []);
        if (nextInfo) {
          sNum = nextInfo.season;
          eNum = nextInfo.episode;
        } else {
          isCompleted = true;
        }
      } else if (seenCount > 0 && !show.nextEpisodeToWatch) {
        isCompleted = true;
      }

      if (isCompleted) {
        mainActionText = "À jour sur la diffusion";
        buttonStyleClass = "bg-emerald-500 text-black hover:bg-emerald-400 shadow-[0_4px_15px_rgba(16,185,129,0.25)]";
      } else {
        const seasonCode = String(sNum).padStart(2, '0');
        const epCode = String(eNum).padStart(2, '0');
        const fullEpCode = `S${seasonCode} | E${epCode}`;

        if (seenCount > 0) {
          mainActionText = `Reprendre • ${fullEpCode}`;
        } else {
          mainActionText = `Commencer • ${fullEpCode}`;
        }
        buttonStyleClass = "bg-[#E5A93D] text-black hover:bg-[#f3b94c] shadow-[0_4px_15px_rgba(229,169,61,0.25)]";
      }
    } else {
      // Movie
      const hasSeenMovie = seenCount > 0;
      if (hasSeenMovie) {
        isCompleted = true;
        mainActionText = "Film vu";
        buttonStyleClass = "bg-emerald-500 text-black hover:bg-emerald-400 shadow-[0_4px_15px_rgba(16,185,129,0.25)]";
      } else {
        mainActionText = "Marquer comme vu";
        buttonStyleClass = "bg-[#E5A93D] text-black hover:bg-[#f3b94c] shadow-[0_4px_15px_rgba(229,169,61,0.25)]";
      }
    }
  }

  const truncateLength = 100;
  const needsTruncation = overview && overview.length > truncateLength;
  const displayedOverview = (!isExpanded && needsTruncation) 
    ? overview.slice(0, truncateLength).trim() + '... ' 
    : overview;

  return (
    <div
      onClick={() => onShowClick(media.id, isTv ? 'tv' : 'movie')}
      className="relative w-full aspect-[4/3] sm:aspect-video overflow-hidden cursor-pointer group snap-center shrink-0 bg-zinc-900"
    >
      {/* Image de fond */}
      <img
        src={`https://image.tmdb.org/t/p/w780${media.backdrop_path || media.poster_path}`}
        alt={title}
        className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
      />
      
      {/* DÉGRADÉ AJUSTÉ : Monte un peu plus haut (75%) avec un 'via-black/75' pour bien contraster le texte clair sans assombrir brutalement */}
      <div className="absolute bottom-0 inset-x-0 h-[75%] bg-gradient-to-t from-black via-black/75 to-transparent pointer-events-none" />

      {/* RUBAN TOP 10 */}
      <div className="absolute top-0 right-0 bg-[#E5A93D] text-black px-4 py-2.5 rounded-bl-[24px] shadow-[-4px_4px_20px_rgba(229,169,61,0.3)] flex flex-col items-center justify-center z-20">
        <span className="text-xl sm:text-2xl font-black leading-none tracking-tighter">#{rank}</span>
      </div>

      {/* CONTENU */}
      <div className="absolute bottom-0 inset-x-0 px-5 pb-2 flex flex-col justify-end z-10 w-full">
        
        {/* Ligne des Badges Colorés */}
        <div className="flex flex-wrap items-center gap-2 mb-1.5">
          {/* Badge Type (Série/Film) */}
          <span className={cn(
            "text-[10px] font-bold px-2.5 py-1 rounded-md flex items-center gap-1.5 uppercase tracking-wider shadow-sm",
            isTv ? "bg-indigo-600 text-white" : "bg-rose-600 text-white"
          )}>
            {isTv ? <Tv size={12} /> : <Film size={12} />}
            {isTv ? 'Série' : 'Film'}
          </span>

          {/* Badge Disponibilité (Uniquement pour les films) */}
          {!isTv && (
            <span className={cn(
              "text-[9px] font-extrabold px-2 py-1 rounded-md flex items-center gap-1 uppercase tracking-widest shadow-sm",
              isAtCinema 
                ? "bg-[#E5A93D] text-black" // Doré pour le cinéma
                : isUpcoming
                ? "bg-purple-600 text-white" // Violet pour À venir
                : "bg-emerald-600 text-white" // Vert pour dispo canapé
            )}>
              {isAtCinema ? <Ticket size={10} className="text-black" /> : isUpcoming ? <Calendar size={10} className="text-white" /> : <MonitorPlay size={10} />}
              {isAtCinema ? 'Au Cinéma' : isUpcoming ? 'À Venir' : 'Disponible'}
            </span>
          )}
        </div>

        {/* Titre (Taille réduite : text-2xl au lieu de 3xl) */}
        <h2 className="text-2xl sm:text-3xl font-black text-white uppercase tracking-tight leading-[1.05] mb-1 line-clamp-2 drop-shadow-xl">
          {title}
        </h2>
        
        {/* SYNOPSIS INLINE (Compacté, mb-2) */}
        {overview && (
          <div 
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="mb-2 cursor-pointer group/synopsis"
          >
            <p className="text-[11.5px] text-zinc-300 leading-snug drop-shadow-md w-full">
              {displayedOverview}
              {!isExpanded && needsTruncation && (
                <span className="text-[#E5A93D] text-[10px] font-bold uppercase tracking-wider opacity-90 group-hover/synopsis:opacity-100 ml-1">
                  VOIR PLUS
                </span>
              )}
            </p>
          </div>
        )}

        {/* Rangée Métadonnées */}
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-400 mb-2 w-full overflow-hidden">
          {rating && (
            <div className="flex items-center gap-1 shrink-0">
              <Star size={11} className="text-[#E5A93D] fill-[#E5A93D]" />
              <span className="text-[#E5A93D]">{rating}</span>
            </div>
          )}
          {rating && <span className="shrink-0">·</span>}
          {genres && <span className="truncate min-w-0 shrink">{genres}</span>}
          {providerName && (
            <>
              <span className="shrink-0">·</span>
              <span className="text-zinc-300 truncate shrink-0 max-w-[40%]">{providerName}</span>
            </>
          )}
        </div>

        {/* BOUTONS D'ACTION (Ancrés sur toute la largeur) */}
        <div className="flex items-center gap-3 w-full mt-1">
          <button 
            onClick={(e) => {
              if (isTracked) {
                e.stopPropagation();
                onShowClick(media.id, isTv ? 'tv' : 'movie');
              } else {
                handleFollowToggle(e);
              }
            }}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-extrabold text-[11px] sm:text-xs uppercase tracking-wider transition-transform active:scale-95 shadow-lg cursor-pointer",
              buttonStyleClass
            )}
          >
            <MainActionIcon size={18} className="shrink-0" />
            <span className="truncate">{mainActionText}</span>
          </button>

          <button 
            onClick={(e) => {
              e.stopPropagation();
              if (onOpenTrailer) {
                onOpenTrailer(media.id, isTv ? 'tv' : 'movie');
              } else {
                onShowClick(media.id, isTv ? 'tv' : 'movie');
              }
            }}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-extrabold text-[11px] sm:text-xs uppercase tracking-wider text-white bg-white/10 backdrop-blur-md border border-white/10 hover:bg-white/20 transition-transform active:scale-95 shadow-lg cursor-pointer"
          >
            <Play size={16} className="fill-white shrink-0" />
            <span className="truncate">Trailer</span>
          </button>
        </div>

      </div>
    </div>
  );
});

function GridSkeletons() {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-x-1.5 gap-y-4 px-1">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="animate-pulse space-y-2">
          <div className="w-full aspect-[2/3] bg-zinc-800 rounded-2xl" />
          <div className="h-3 bg-zinc-800 rounded w-3/4" />
          <div className="h-2.5 bg-zinc-800 rounded w-1/2" />
        </div>
      ))}
    </div>
  );
}
