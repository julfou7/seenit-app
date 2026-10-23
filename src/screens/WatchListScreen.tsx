import { markMovieWatched, markWatchRecordUnseen } from '../features/watchlist/watchProgressActions';
import type { SeriesCardEpisode } from '../features/watchlist/seriesCardPresentation';
import React, { startTransition, useState, useEffect, useRef, useMemo, useCallback, type RefObject } from 'react';
import { type Show } from '../types';
import { cn, getNextEpisodeNumber, scrollAllCarouselsToStart, checkIsUpToDate, getAiredProgress, getTodayStr } from '../lib/utils';
import { ContinueWatchingCard } from '../components/cards/ContinueWatchingCard';
import { MovieWatchCard } from '../components/cards/MovieWatchCard';
import { ShowNewsFeed } from '../components/ShowNewsFeed';
import { UpToDateShowCard, getUpToDateOrNewSeasonCategory } from '../components/cards/UpToDateShowCard';
import { UpcomingShowCard, getUpcomingEpisodeInfo } from '../components/cards/UpcomingShowCard';
import { HistoryFeed } from '../components/HistoryFeed';
import { EpisodeDetailModal } from './EpisodeDetailModal';
import { PersonDetailModal } from './PersonDetailModal';
import { tmdb } from '../features/shows/tmdb';
import { markEpisodeWatched } from '../features/shows/markEpisodeWatched';
import { markWatchCardEpisode } from '../features/watchlist/watchCardResume';
import { getFormattedProviderLogo } from '../utils/providerLogos';
import { User, Circle, CheckCircle2, Trash2, Archive, X, Clock, Ban } from 'lucide-react';
import { auth, db } from '../lib/firebase';
import { doc, setDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { SyncStatusIndicator } from '../components/SyncStatusIndicator';
import { useShows } from '../hooks/useShows';
import { useToastStore } from '../store/toastStore';
import { useSyncStore } from '../store/syncStore';
import { useShowsStore } from '../store/showsStore';
import { useLogStore } from '../store/logStore';
import { SwipeableCard } from '../components/cards/SwipeableCard';
import { SeenItLogo } from '../components/SeenItLogo';
import { SeenItCheckButton } from '../components/SeenItCheckButton';
import { useHorizontalVirtualWindow } from '../hooks/useBoundedVirtualWindow';
import { usePassiveWatchProvider } from '../hooks/usePassiveWatchProvider';
import { createWatchProviderRequestLimiter } from '../features/providers/watchProviderRequestPolicy';
import { createPassiveCardEnrichmentGate } from '../features/providers/passiveCardEnrichmentPolicy';
import { hasAiredEpisodeEvidence } from '../features/watchlist/watchAvailability';
import {
  WATCHLIST_BATCH_SIZE,
  getAddedTime,
  getExplicitLastWatchedTime,
  getLastWatchedOrUpdatedTime,
  getShowLastWatchedTime,
  parseTimestamp,
} from './watchListPresentation';
import { WatchListView } from './WatchListView';
import { useTabShortcut } from '../features/navigation/useTabShortcut';
import { type EpisodeDetailData } from './episodeDetailTypes';

export function WatchListScreen({
  onShowClick: onShowClickProp,
  onEpisodeParentClick: onEpisodeParentClickProp,
  navigationShortcut,
  onExplore,
}: {
  onShowClick: (id: string, mediaType?: 'tv' | 'movie') => void;
  onEpisodeParentClick?: (id: string, mediaType?: 'tv' | 'movie') => void;
  onOpenProfile?: () => void;
  onExplore?: () => void;
  navigationShortcut?: number;
}) {
  const onShowClick = useCallback((id: string, mediaType?: 'tv' | 'movie') => {
    sessionStorage.setItem('home_scroll', window.scrollY.toString());
    onShowClickProp(id, mediaType);
  }, [onShowClickProp]);

  const tabScrollPositions = useRef<Record<string, number>>({});
  const [today, setToday] = useState(() => getTodayStr());
  useEffect(() => {
    const timer = setInterval(() => setToday(getTodayStr()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const [activeTab, setActiveTab] = useState<'watch_next' | 'upcoming' | 'history'>('watch_next');
  useTabShortcut(navigationShortcut, () => {
    setActiveTab('watch_next');
    const frame = requestAnimationFrame(() => document.getElementById('watchlist-container')?.scrollTo({ top: 0, behavior: 'smooth' }));
    return () => cancelAnimationFrame(frame);
  });
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [selectedEpisodeModal, setSelectedEpisodeModal] = useState<{ show: Show; season: number; episode: EpisodeDetailData; isHydrating: boolean } | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<number | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState<number>(WATCHLIST_BATCH_SIZE);

  const openPersonModal = useCallback((personId: number) => {
    setSelectedPersonId(personId);
    const currentState = window.history.state || {};
    window.history.pushState({ ...currentState, isModal: true, isPersonDetailModal: true, personId }, '');
  }, []);

  const handleToggleVoirTout = useCallback((sectionKey: string) => {
    if (expandedSection === sectionKey) {
      setExpandedSection(null);
      setVisibleCount(WATCHLIST_BATCH_SIZE);
    } else {
      setExpandedSection(sectionKey);
      setVisibleCount(WATCHLIST_BATCH_SIZE);
    }
  }, [expandedSection]);

  const watchNextRef = useRef<HTMLDivElement>(null);
  const upcomingRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const hasSeededNightAgent = useRef(false);
  const openingEpisodeRef = useRef(false);
  const episodeRequestRef = useRef(0);
  const pendingEpisodeParentRef = useRef<{ id: string; mediaType: 'tv' | 'movie' } | null>(null);

  const handleEpisodeClick = useCallback((show: Show, seasonNumber: number, episodeNumber: number) => {
    if (openingEpisodeRef.current || selectedEpisodeModal) return;
    openingEpisodeRef.current = true;

    const upcomingEp = getUpcomingEpisodeInfo(show);
    const candidates = [show.nextEpisodeToWatch, upcomingEp].filter(Boolean) as Array<{ season_number: number; episode_number: number; name?: string; air_date?: string | null; still_path?: string | null }>;
    const knownEpisode = candidates.find(ep =>
      Number(ep?.season_number) === Number(seasonNumber)
      && Number(ep?.episode_number) === Number(episodeNumber)
    );
    const cachedEpisode = show.tmdbId ? tmdb.peekEpisodeDetails(show.tmdbId, seasonNumber, episodeNumber) : null;
    const epData = cachedEpisode || {
      season_number: seasonNumber,
      episode_number: episodeNumber,
      name: knownEpisode?.name || `Épisode ${episodeNumber}`,
      air_date: knownEpisode?.air_date || null,
      still_path: knownEpisode?.still_path || null,
    };
    const isHydrating = Boolean(show.tmdbId && !cachedEpisode);

    setSelectedEpisodeModal({ show, season: seasonNumber, episode: epData, isHydrating });
    const currentState = window.history.state || {};
    if (!currentState.isEpisodeDetailModal) {
      window.history.pushState({ ...currentState, isModal: true, isEpisodeDetailModal: true }, '');
    }

    const requestId = ++episodeRequestRef.current;
    requestAnimationFrame(() => { openingEpisodeRef.current = false; });
    if (!show.tmdbId || cachedEpisode) return;

    const settleEpisodeHydration = (episode?: EpisodeDetailData) => {
      setSelectedEpisodeModal(current => {
        if (!current) return current;
        const sameShow = String(current.show.id || current.show.tmdbId || '') === String(show.id || show.tmdbId || '');
        const sameEpisode = current.season === seasonNumber && Number(current.episode?.episode_number) === Number(episodeNumber);
        if (!sameShow || !sameEpisode) return current;
        return { ...current, ...(episode ? { episode } : {}), isHydrating: false };
      });
    };

    void tmdb.getEpisodeDetails(show.tmdbId, seasonNumber, episodeNumber).then(res => {
      if (requestId !== episodeRequestRef.current) return;
      settleEpisodeHydration(res.ok && res.value ? res.value : undefined);
    }).catch(() => {
      if (requestId === episodeRequestRef.current) settleEpisodeHydration();
    });
  }, [selectedEpisodeModal]);

  const openEpisodeParentNow = useCallback((target: { id: string; mediaType: 'tv' | 'movie' }) => {
    sessionStorage.setItem('home_scroll', window.scrollY.toString());
    startTransition(() => {
      if (onEpisodeParentClickProp) onEpisodeParentClickProp(target.id, target.mediaType);
      else onShowClickProp(target.id, target.mediaType);
      setSelectedEpisodeModal(null);
    });
  }, [onEpisodeParentClickProp, onShowClickProp]);

  const handleEpisodeParentClick = useCallback((show: Show, tmdbId: number) => {
    const target = {
      id: show.id ? String(show.id) : String(tmdbId),
      mediaType: show.mediaType === 'movie' ? 'movie' as const : 'tv' as const,
    };
    if (window.history.state?.isEpisodeDetailModal || window.history.state?.isModal) {
      pendingEpisodeParentRef.current = target;
      window.history.back();
      return;
    }
    openEpisodeParentNow(target);
  }, [openEpisodeParentNow]);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (!event.state || !event.state.isEpisodeDetailModal) {
        const pendingParent = pendingEpisodeParentRef.current;
        if (pendingParent) {
          pendingEpisodeParentRef.current = null;
          openEpisodeParentNow(pendingParent);
        } else {
          setSelectedEpisodeModal(null);
        }
      }
      if (event.state && event.state.isPersonDetailModal && event.state.personId) setSelectedPersonId(event.state.personId);
      else if (!event.state || !event.state.isPersonDetailModal) setSelectedPersonId(null);
    };
    const handleCloseModals = () => {
      pendingEpisodeParentRef.current = null;
      setSelectedEpisodeModal(null);
      setSelectedPersonId(null);
    };
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('app-close-modals', handleCloseModals);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('app-close-modals', handleCloseModals);
    };
  }, [openEpisodeParentNow]);

  useEffect(() => {
    return onAuthStateChanged(auth, setUser);
  }, []);

  const { shows: allShows, loading, addShow, updateShow, deleteShow } = useShows();

  useEffect(() => {
    const savedScroll = sessionStorage.getItem('home_scroll');
    if (savedScroll && !loading) {
      setTimeout(() => {
        window.scrollTo(0, parseInt(savedScroll, 10));
        sessionStorage.removeItem('home_scroll');
      }, 50);
    }
  }, [loading]);

  const { showToast } = useToastStore();
  const isQuotaExceeded = useSyncStore(state => state.isQuotaExceeded);
  const [pendingAction, setPendingAction] = useState<{ type: 'archive' | 'unfollow' | 'drop'; item: Show } | null>(null);

  useEffect(() => {
    const handleBackOneLevel = (event: Event) => {
      if (pendingAction || expandedSection || activeTab !== 'watch_next') event.preventDefault();
      if (pendingAction) {
        setPendingAction(null);
        return;
      }
      if (expandedSection) {
        setExpandedSection(null);
        setVisibleCount(WATCHLIST_BATCH_SIZE);
        return;
      }
      if (activeTab !== 'watch_next') {
        tabScrollPositions.current = {};
        setActiveTab('watch_next');
        requestAnimationFrame(() => {
          const container = document.getElementById('watchlist-container');
          if (container) container.scrollTop = 0;
        });
      }
    };
    const handleResetAll = () => {
      episodeRequestRef.current += 1;
      setSelectedEpisodeModal(null);
      setSelectedPersonId(null);
      setPendingAction(null);
      setExpandedSection(null);
      setVisibleCount(WATCHLIST_BATCH_SIZE);
      tabScrollPositions.current = {};
      setActiveTab('watch_next');
      requestAnimationFrame(() => {
        const container = document.getElementById('watchlist-container');
        if (container) container.scrollTop = 0;
        scrollAllCarouselsToStart();
      });
      showToast('À Voir réinitialisé : retour à À Regarder.', 'info');
    };

    window.addEventListener('watchlist-back-one-level', handleBackOneLevel);
    window.addEventListener('watchlist-reset-all', handleResetAll);
    return () => {
      window.removeEventListener('watchlist-back-one-level', handleBackOneLevel);
      window.removeEventListener('watchlist-reset-all', handleResetAll);
    };
  }, [activeTab, expandedSection, pendingAction, showToast]);

  useEffect(() => {
    if (pendingAction) {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    }
  }, [pendingAction]);

  const handleDropShow = async (show: Show) => {
    if (!show.id) return;
    const previousStatus = show.status || 'watching';
    await updateShow(show.id, {
      status: 'dropped',
      updatedAt: Date.now()
    });
    showToast(
      `« ${show.title} » marquée comme abandonnée.`,
      'dropped',
      show,
      async () => {
        if (show.id) {
          await updateShow(show.id, { status: previousStatus, updatedAt: Date.now(), lastWatchedAt: Date.now() });
          scrollAllCarouselsToStart();
        }
      }
    );
  };

  const handleArchiveShow = async (show: Show) => {
    if (!show.id) return;
    await updateShow(show.id, {
      isArchived: true,
      updatedAt: Date.now()
    });
    showToast(
      `« ${show.title} » a été déplacée dans vos archives.`,
      'archive',
      show,
      async () => {
        if (show.id) {
          await updateShow(show.id, { isArchived: false, updatedAt: Date.now(), lastWatchedAt: Date.now() });
          scrollAllCarouselsToStart();
        }
      }
    );
  };

  const executeUnfollow = async (show: Show) => {
    if (!show.id) return;
    const savedShow = { ...show };
    await deleteShow(show.id);
    showToast(
      `« ${show.title} » a été supprimée de votre suivi.`,
      'unfollow',
      show,
      async () => {
        if (auth.currentUser && savedShow.id) {
          const docRef = doc(db, 'users', auth.currentUser.uid, 'shows', savedShow.id);
          const restoredShow = { ...savedShow, updatedAt: Date.now(), lastWatchedAt: Date.now() };
          useShowsStore.getState().addShowOptimistic(restoredShow);
          await setDoc(docRef, restoredShow);
          scrollAllCarouselsToStart();
        }
      }
    );
  };

  const scrollToSection = (_ref: React.RefObject<HTMLDivElement>, tab: 'watch_next' | 'upcoming' | 'history') => {
    const container = document.getElementById('watchlist-container');
    if (container) tabScrollPositions.current[activeTab] = container.scrollTop;
    setActiveTab(tab);
    requestAnimationFrame(() => { if (container) container.scrollTop = tabScrollPositions.current[tab] || 0; });
  };

  const {
    shows,
    nouveautesShows,
    continueWatchingShows,
    pasVuDepuisUnMomentShows,
    filmsAVoirShows,
    upcomingShows
  } = useMemo(() => {
    const shows = allShows.filter(s => s.mediaType !== 'movie');
    const todayIso = today;

    const isNotUpToDate = (s: Show): boolean => {
      if (s.isArchived) return false;
      if (s.status === 'dropped') return false;
      if (s.status === 'completed') return false;
      if (!hasAiredEpisodeEvidence(s, todayIso)) return false;
      if (checkIsUpToDate(s)) return false;

      const watchedCount = s.seenEpisodes ? s.seenEpisodes.length : 0;
      if (watchedCount > 0 && !s.nextEpisodeToWatch) {
        return false;
      }

      const progress = getAiredProgress(s);
      if (progress >= 100) return false;

      if (typeof s.totalAiredEpisodes === 'number' && s.totalAiredEpisodes > 0 && watchedCount >= s.totalAiredEpisodes) {
        return false;
      }

      if (s.totalEpisodes && s.totalEpisodes > 0) {
        if (watchedCount >= s.totalEpisodes) {
          if (!s.nextEpisodeToWatch?.air_date) return false;
          const airTime = parseTimestamp(s.nextEpisodeToWatch.air_date);
          if (airTime > Date.now()) return false;
        }
      }
      if (s.nextEpisodeToWatch?.air_date) {
        const airTime = parseTimestamp(s.nextEpisodeToWatch.air_date);
        if (airTime > Date.now()) {
          return false;
        }
      }
      return true;
    };

    const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;
    const candidateWatchShows = shows.filter(isNotUpToDate);
    const now = Date.now();

    const isWatchedRecently = (s: Show): boolean => {
      const watchedCount = s.seenEpisodes ? s.seenEpisodes.length : 0;
      if (watchedCount === 0) return false;

      const lastWatched = getExplicitLastWatchedTime(s);
      if (lastWatched > 0) return (Date.now() - lastWatched) <= SIXTY_DAYS_MS;
      const fallbackTime = parseTimestamp(s.lastWatchedAt) || parseTimestamp(s.createdAt);
      if (fallbackTime > 0) return (Date.now() - fallbackTime) <= SIXTY_DAYS_MS;
      return false;
    };

    const isNouveaute = (s: Show): boolean => {
      const cat = getUpToDateOrNewSeasonCategory(s);
      if (cat?.type === 'NEW_SEASON') return true;

      if (s.nextEpisodeToWatch) {
        if (s.nextEpisodeToWatch.season_number > 1 && s.nextEpisodeToWatch.episode_number === 1) {
          const airMs = parseTimestamp(s.nextEpisodeToWatch.air_date);
          if (airMs > 0 && (now - airMs) <= SIXTY_DAYS_MS && airMs <= (now + 24 * 60 * 60 * 1000)) {
            return true;
          }
        }
      }

      const watchedCount = s.seenEpisodes ? s.seenEpisodes.length : 0;
      if (watchedCount === 0) {
        const releaseDateStr = s.firstAirDate || s.nextEpisodeToWatch?.air_date;
        const releaseTime = parseTimestamp(releaseDateStr) || parseTimestamp(s.createdAt);
        if (releaseTime > 0) {
          const diff = now - releaseTime;
          if (diff >= 0 && diff <= SIXTY_DAYS_MS) {
            return true;
          }
        }
      }

      return false;
    };

    const nouveautesShows = candidateWatchShows
      .filter(isNouveaute)
      .sort((a, b) => {
        const timeA = getLastWatchedOrUpdatedTime(a);
        const timeB = getLastWatchedOrUpdatedTime(b);
        const diff = timeB - timeA;
        if (diff !== 0) return diff;
        return a.title.localeCompare(b.title);
      });

    const nouveautesIds = new Set(nouveautesShows.map(s => s.id));

    const continueWatchingShows = candidateWatchShows
      .filter(s => !nouveautesIds.has(s.id) && (s.seenEpisodes?.length || 0) > 0 && isWatchedRecently(s))
      .sort((a, b) => {
        const timeA = getShowLastWatchedTime(a);
        const timeB = getShowLastWatchedTime(b);
        const diff = timeB - timeA;
        if (diff !== 0) return diff;
        return a.title.localeCompare(b.title);
      });

    const continueWatchingIds = new Set(continueWatchingShows.map(s => s.id));

    const pasVuDepuisUnMomentShows = candidateWatchShows
      .filter(s => !continueWatchingIds.has(s.id) && !nouveautesIds.has(s.id))
      .sort((a, b) => {
        const timeA = getShowLastWatchedTime(a);
        const timeB = getShowLastWatchedTime(b);
        const diff = timeA - timeB;
        if (diff !== 0) return diff;
        return a.title.localeCompare(b.title);
      });

    const filmsAVoirShows = allShows
      .filter(s => {
        if (s.mediaType !== 'movie' || s.isArchived || s.status === 'dropped' || s.status === 'completed') {
          return false;
        }
        if (s.seenEpisodes && s.seenEpisodes.includes('movie')) {
          return false;
        }
        if (s.firstAirDate && s.firstAirDate > todayIso) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const addedA = a.updatedAt || a.createdAt || 0;
        const addedB = b.updatedAt || b.createdAt || 0;
        const diff = addedB - addedA;
        if (diff !== 0) return diff;
        return a.title.localeCompare(b.title);
      });

    const upcomingShows = allShows
      .map(s => ({ show: s, upcomingEp: getUpcomingEpisodeInfo(s) }))
      .filter((item): item is { show: Show; upcomingEp: NonNullable<ReturnType<typeof getUpcomingEpisodeInfo>> } => item.upcomingEp !== null)
      .sort((a, b) => {
        const da = new Date(a.upcomingEp.air_date + 'T00:00:00').getTime();
        const db = new Date(b.upcomingEp.air_date + 'T00:00:00').getTime();
        if (da !== db) return da - db;
        return a.show.title.localeCompare(b.show.title);
      })
      .map(item => item.show);

    return {
      shows,
      nouveautesShows,
      continueWatchingShows,
      pasVuDepuisUnMomentShows,
      filmsAVoirShows,
      upcomingShows
    };
  }, [allShows, today]);

  const markNextEpisodeAsSeen = useCallback(async (show: Show) => {
    return markWatchCardEpisode(show, getTodayStr(), markEpisodeWatched);
  }, []);

  const markMovieAsSeen = useCallback((show: Show) => markMovieWatched(show, updateShow), [updateShow]);
  const markAsUnseen = useCallback((show: Show, episode: SeriesCardEpisode | null) => markWatchRecordUnseen(show, episode, updateShow), [updateShow]);
  return <WatchListView model={{ onExplore, activeTab, allShows, continueWatchingShows, executeUnfollow, expandedSection, filmsAVoirShows, handleArchiveShow, handleDropShow, handleEpisodeClick, handleEpisodeParentClick, handleToggleVoirTout, historyRef, isQuotaExceeded, loading, markMovieAsSeen, markNextEpisodeAsSeen, markAsUnseen, nouveautesShows, onShowClick, onShowClickProp, openPersonModal, pasVuDepuisUnMomentShows, pendingAction, scrollToSection, selectedEpisodeModal, selectedPersonId, setPendingAction, setSelectedEpisodeModal, setSelectedPersonId, setVisibleCount, upcomingRef, upcomingShows, visibleCount, watchNextRef }} />;
}
