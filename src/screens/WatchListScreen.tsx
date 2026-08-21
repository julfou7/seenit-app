import React, { useState, useEffect, useRef, type RefObject } from 'react';
import { type Show } from '../types';
import { cn, getNextEpisodeNumber, scrollAllCarouselsToStart } from '../lib/utils';
import { ContinueWatchingCard } from '../components/cards/ContinueWatchingCard';
import { MovieWatchCard } from '../components/cards/MovieWatchCard';
import { ShowNewsFeed } from '../components/ShowNewsFeed';
import { UpToDateShowCard, getUpToDateOrNewSeasonCategory } from '../components/cards/UpToDateShowCard';
import { UpcomingShowCard, getUpcomingEpisodeInfo } from '../components/cards/UpcomingShowCard';
import { HistoryFeed } from '../components/HistoryFeed';
import { EpisodeDetailModal } from './EpisodeDetailModal';
import { tmdb } from '../features/shows/tmdb';
import { getFormattedProviderLogo, extractOfficialStreamingProvider, PLEX_LOGO_SVG } from '../utils/providerLogos';
import { checkPlexAvailability } from '../features/plex/plexAvailability';
import { syncSingleItem } from "../hooks/useDetailsSyncWorker";
import { User, Circle, CheckCircle2, Trash2, Archive, X, Clock, Ban } from 'lucide-react';
import { auth, db } from '../lib/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { SyncStatusIndicator } from '../components/SyncStatusIndicator';
import { useShows } from '../hooks/useShows';
import { useToastStore } from '../store/toastStore';
import { useSyncStore } from '../store/syncStore';
import { useShowsStore } from '../store/showsStore';
import { SwipeableCard } from '../components/cards/SwipeableCard';
import { SeenItLogo } from '../components/SeenItLogo';
import { SeenItCheckButton } from '../components/SeenItCheckButton';

interface ExpandedItemCardProps {
  key?: React.Key;
  show: Show;
  sectionType: 'watchNext' | 'notWatched' | 'upToDate';
  onShowClick: (id: string, mediaType?: 'tv' | 'movie') => void;
  onEpisodeClick: (show: Show, seasonNumber: number, episodeNumber: number) => void;
  onMarkAsSeen: (show: Show) => void;
}

function formatRuntime(minutes?: number) {
  if (!minutes || isNaN(minutes) || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h${m > 0 ? (m < 10 ? `0${m}` : m) : ''}`;
  return `${m}min`;
}

function ExpandedItemCard({ show, sectionType, onShowClick, onEpisodeClick, onMarkAsSeen }: ExpandedItemCardProps) {
  const isMovie = show.mediaType === 'movie';
  const [movieRuntime, setMovieRuntime] = useState<number | null>((show as any).runtime || null);
  const [providerLogo, setProviderLogo] = useState<string | null>(
    show.networks && show.networks.length > 0 && show.networks[0].logo_path
      ? show.networks[0].logo_path
      : null
  );
  const [providerName, setProviderName] = useState<string | null>(
    show.networks && show.networks.length > 0 ? show.networks[0].name : null
  );

  useEffect(() => {
    let isMounted = true;
    if (show.tmdbId) {
      if (isMovie && !movieRuntime) {
        tmdb.getMovieDetails(show.tmdbId).then(res => {
          if (isMounted && res.ok && res.value?.runtime) {
            setMovieRuntime(res.value.runtime);
          }
        }).catch(() => {});
      }
      tmdb.getWatchProviders(show.tmdbId, isMovie ? 'movie' : 'tv').then(res => {
        if (!isMounted) return;
        let officialFound = false;
        if (res.ok && res.value?.results) {
          const stream = extractOfficialStreamingProvider(res.value.results);
          if (stream) {
            setProviderLogo(stream.logo_path);
            setProviderName(stream.provider_name);
            officialFound = true;
          }
        }

        if (!officialFound && !show.networks?.length) {
          checkPlexAvailability({
            tmdbId: show.tmdbId,
            title: show.title,
            originalTitle: (show as any).originalTitle || (show as any).original_title,
            year: show.firstAirDate?.slice(0, 4),
            mediaType: isMovie ? 'movie' : 'tv'
          }).then(plexInfo => {
            if (isMounted && plexInfo.available) {
              setProviderLogo(PLEX_LOGO_SVG);
              setProviderName(plexInfo.serverName ? `Plex (${plexInfo.serverName})` : 'Plex');
            }
          }).catch(() => {});
        }
      }).catch(() => {});
    }
    return () => { isMounted = false; };
  }, [isMovie, show.tmdbId, movieRuntime, show.title]);

  let nextEp = show.nextEpisodeToWatch;
  if (!isMovie && !nextEp && sectionType !== 'upToDate') {
    const seen = show.seenEpisodes || [];
    if (seen.length > 0) {
      let maxS = 1;
      let maxE = 0;
      seen.forEach(epKey => {
        const [s, e] = epKey.split('x').map(Number);
        if (!isNaN(s) && !isNaN(e)) {
          if (s > maxS || (s === maxS && e > maxE)) {
            maxS = s;
            maxE = e;
          }
        }
      });
      nextEp = { season_number: maxS, episode_number: maxE + 1 };
    } else {
      nextEp = { season_number: 1, episode_number: 1 };
    }
  }

  let sNum = nextEp?.season_number ?? 1;
  let eNum = nextEp?.episode_number ?? 1;

  let categoryInfo = null;
  if (!isMovie && sectionType === 'upToDate') {
    categoryInfo = getUpToDateOrNewSeasonCategory(show);
    sNum = show.nextEpisodeToWatch?.season_number
      ?? categoryInfo?.nextEpisodeToAir?.season_number
      ?? categoryInfo?.seasonNumber
      ?? 1;
    eNum = show.nextEpisodeToWatch?.episode_number
      ?? categoryInfo?.nextEpisodeToAir?.episode_number
      ?? 1;
  }

  const poster = show.posterPath || show.backdropPath;
  const imgSrc = poster 
    ? (poster.startsWith('http') ? poster : `https://image.tmdb.org/t/p/w300${poster}`)
    : null;

  const networkLogo = getFormattedProviderLogo(
    providerLogo || (show.networks && show.networks.length > 0 ? show.networks[0].logo_path : null),
    providerName || (show.networks && show.networks.length > 0 ? show.networks[0].name : (show as any).network || (show as any).platform)
  );

  let subtitleText = '';
  if (!isMovie) {
    if (sectionType === 'upToDate' && categoryInfo) {
      if (categoryInfo.type === 'NEW_SEASON') {
        subtitleText = `Nouvelle Saison ${categoryInfo.seasonNumber || 1} dispo`;
      } else if (categoryInfo.nextEpisodeToAir?.air_date) {
        const airFormatted = new Date(categoryInfo.nextEpisodeToAir.air_date + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
        subtitleText = `Ép. ${categoryInfo.nextEpisodeToAir.episode_number} le ${airFormatted}`;
      } else {
        subtitleText = 'À jour';
      }
    } else {
      if (show.episodeRecords && Object.keys(show.episodeRecords).length > 0) {
        const entries = Object.entries(show.episodeRecords)
          .map(([key, val]) => ({
            key,
            val,
            time: val && val.watchedAt ? parseTimestamp(val.watchedAt) : 0
          }))
          .filter(item => item.time > 0)
          .sort((a, b) => b.time - a.time);

        if (entries.length > 0) {
          const { key, time } = entries[0];
          let s = '', e = '';
          if (key.includes('x')) {
            const parts = key.split('x');
            s = parts[0];
            e = parts[1];
          } else {
            const match = key.match(/S(\d+)E(\d+)/i);
            if (match) {
              s = match[1];
              e = match[2];
            }
          }
          if (s && e && time > 0) {
            const diff = Date.now() - time;
            const h = Math.floor(diff / (1000 * 60 * 60));
            let timeAgoStr = "";
            if (h < 1) timeAgoStr = "il y a < 1h";
            else if (h < 24) timeAgoStr = `il y a ${h}h`;
            else {
              const d = Math.floor(h / 24);
              timeAgoStr = `il y a ${d}j`;
            }
            subtitleText = `Vu S${s.padStart(2, '0')}E${e.padStart(2, '0')} • ${timeAgoStr}`;
          }
        }
      }
      if (!subtitleText) {
        subtitleText = 'Pas encore commencé';
      }
    }
  }

  const episodeTitle = show.nextEpisodeToWatch?.name 
    || (sectionType === 'upToDate' ? categoryInfo?.nextEpisodeToAir?.name : undefined)
    || nextEp?.name;

  const handleCardClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isMovie) {
      if (onShowClick && show.id) {
        onShowClick(show.id, 'movie');
      }
    } else if (onEpisodeClick) {
      onEpisodeClick(show, sNum, eNum);
    } else if (onShowClick && show.id) {
      onShowClick(show.id, show.mediaType);
    }
  };

  const movieMetaParts: string[] = [];
  if (show.firstAirDate) movieMetaParts.push(show.firstAirDate.slice(0, 4));
  const formattedMovieRuntime = formatRuntime(movieRuntime || undefined);
  if (formattedMovieRuntime) movieMetaParts.push(formattedMovieRuntime);
  const movieMetaStr = movieMetaParts.join(' • ') || 'Film';

  return (
    <div 
      onClick={handleCardClick}
      className="w-full flex items-stretch justify-between gap-3 bg-zinc-900/60 hover:bg-zinc-900/80 rounded-2xl overflow-hidden relative isolate transition-all active:scale-[0.98] cursor-pointer group"
    >
      {/* OVERLAY PREMIUM : Bordure interne parfaite + Effet lumière */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10 group-hover:ring-white/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.12)] transition-all z-20" />
      <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-white/[0.04] to-transparent opacity-0 group-hover:opacity-100 transition-opacity z-10" />

      {networkLogo && (
        <div className="absolute top-0 right-0 z-30 bg-white/95 backdrop-blur-md w-7 h-7 rounded-bl-xl p-1 flex items-center justify-center shrink-0 shadow-sm pointer-events-none">
          <img src={networkLogo} alt="" className="w-5 h-5 object-contain rounded-[3px]" />
        </div>
      )}

      <div className="w-[60px] sm:w-[70px] shrink-0 bg-zinc-950 rounded-l-2xl overflow-hidden flex items-center justify-center relative z-20">
        {imgSrc ? (
          <img 
            loading="lazy" 
            decoding="async" 
            src={imgSrc} 
            alt={show.title} 
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" 
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] text-zinc-600 p-1 text-center font-bold">
            {show.title}
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 py-3 px-0.5 flex flex-col justify-center relative z-20">
        <div className={cn("flex items-center gap-2 min-w-0", networkLogo ? "pr-10" : "pr-1")}>
          <h4 
            onClick={(e) => { e.stopPropagation(); if (show.id) onShowClick(show.id, show.mediaType); }}
            className="text-[#E5A93D] font-extrabold text-xs sm:text-[13px] uppercase tracking-wider line-clamp-2 cursor-pointer hover:underline text-left leading-tight"
          >
            {show.title}
          </h4>
        </div>
        
        {isMovie ? (
          <div className="flex items-center gap-1.5 my-0.5 min-w-0">
            <span className="text-indigo-400 text-xs font-medium truncate">
              {movieMetaStr}
            </span>
          </div>
        ) : (
          <>
            <p className="text-white font-bold text-sm line-clamp-1 leading-snug my-0.5">
              S{String(sNum).padStart(2, '0')} | E{String(eNum).padStart(2, '0')}
              {episodeTitle ? ` • ${episodeTitle}` : ''}
            </p>
            
            <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
              <span className="text-emerald-400 text-xs font-semibold flex items-center gap-1 truncate">
                <Clock size={12} className="shrink-0" />
                <span className="truncate">{subtitleText}</span>
              </span>
            </div>
          </>
        )}
      </div>

      <div className={cn("pr-2 flex items-center justify-center shrink-0 relative z-20", networkLogo && "pt-3.5")}>
        <SeenItCheckButton 
          onClick={(e) => {
            e.stopPropagation();
            onMarkAsSeen(show);
          }}
          size={30}
          title="Marquer comme vu"
        />
      </div>
    </div>
  );
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const parseTimestamp = (val: any): number => {
  if (!val) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const num = Number(val);
  if (!isNaN(num) && num > 1000000000) return num;
  const parsed = Date.parse(val);
  return isNaN(parsed) ? 0 : parsed;
};

const getExplicitLastWatchedTime = (s: Show): number => {
  const seenSet = new Set(s.seenEpisodes || []);
  if (seenSet.size === 0) return 0;

  let maxTime = 0;
  if (s.episodeRecords && Object.keys(s.episodeRecords).length > 0) {
    for (const [key, record] of Object.entries(s.episodeRecords)) {
      if (!record || !record.watchedAt) continue;

      let isSeen = seenSet.has(key);
      if (!isSeen && key.includes('x')) {
        const [season, ep] = key.split('x');
        const formattedKey = `S${season.padStart(2, '0')}E${ep.padStart(2, '0')}`;
        if (seenSet.has(formattedKey)) isSeen = true;
      } else if (!isSeen && key.match(/S(\d+)E(\d+)/i)) {
        const match = key.match(/S(\d+)E(\d+)/i);
        if (match) {
          const normKey = `${parseInt(match[1])}x${parseInt(match[2])}`;
          if (seenSet.has(normKey)) isSeen = true;
        }
      }

      if (isSeen) {
        const t = parseTimestamp(record.watchedAt);
        if (t > maxTime) maxTime = t;
      }
    }
  }

  if (maxTime > 0) return maxTime;

  if (s.lastWatchedAt) {
    const t = parseTimestamp(s.lastWatchedAt);
    if (t > 0) return t;
  }

  return 0;
};

const getShowLastWatchedTime = (s: Show): number => {
  const explicit = getExplicitLastWatchedTime(s);
  if (explicit > 0) return explicit;

  const lw = parseTimestamp(s.lastWatchedAt);
  if (lw > 0) return lw;

  return parseTimestamp(s.createdAt) || 0;
};

const getLastWatchedOrUpdatedTime = (s: Show): number => {
  const explicit = getExplicitLastWatchedTime(s);
  const lw = parseTimestamp(s.lastWatchedAt);
  const up = parseTimestamp(s.updatedAt);
  const cr = parseTimestamp(s.createdAt) || 0;
  return Math.max(explicit, lw, up, cr);
};

const getAddedTime = (s: Show): number => {
  return parseTimestamp(s.createdAt) || 0;
};

export function WatchListScreen({ onShowClick: onShowClickProp }: { onShowClick: (id: string, mediaType?: 'tv' | 'movie') => void; onOpenProfile?: () => void }) {
  const onShowClick = (id: string, mediaType?: 'tv' | 'movie') => {
    sessionStorage.setItem('home_scroll', window.scrollY.toString());
    onShowClickProp(id, mediaType);
  };

  const [activeTab, setActiveTab] = useState<'watch_next' | 'upcoming' | 'history'>('watch_next');
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [selectedEpisodeModal, setSelectedEpisodeModal] = useState<{ show: Show; season: number; episode: any } | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState<number>(8);

  const handleToggleVoirTout = (sectionKey: string) => {
    if (expandedSection === sectionKey) {
      setExpandedSection(null);
      setVisibleCount(8);
    } else {
      setExpandedSection(sectionKey);
      setVisibleCount(8);
    }
  };

  const watchNextRef = useRef<HTMLDivElement>(null);
  const upcomingRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const hasSeededNightAgent = useRef(false);

  const [isOpeningEpisode, setIsOpeningEpisode] = useState<boolean>(false);

  const handleEpisodeClick = async (show: Show, seasonNumber: number, episodeNumber: number) => {
    if (isOpeningEpisode || selectedEpisodeModal) return;
    setIsOpeningEpisode(true);
    try {
      let epData: any = { season_number: seasonNumber, episode_number: episodeNumber };
      if (show.tmdbId) {
        const res = await tmdb.getEpisodeDetails(show.tmdbId, seasonNumber, episodeNumber);
        if (res.ok) {
          epData = res.value;
        } else {
          const upcomingEp = getUpcomingEpisodeInfo(show);
          epData = {
            season_number: seasonNumber,
            episode_number: episodeNumber,
            name: upcomingEp?.name || `Épisode ${episodeNumber}`,
            air_date: upcomingEp?.air_date || null
          };
        }
      } else {
        const upcomingEp = getUpcomingEpisodeInfo(show);
        epData = {
          season_number: seasonNumber,
          episode_number: episodeNumber,
          name: upcomingEp?.name || `Épisode ${episodeNumber}`,
          air_date: upcomingEp?.air_date || null
        };
      }
      setSelectedEpisodeModal({ show, season: seasonNumber, episode: epData });
      const currentState = window.history.state || {};
      window.history.pushState({ ...currentState, isModal: true, isEpisodeDetailModal: true }, '');
    } finally {
      setIsOpeningEpisode(false);
    }
  };

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (!event.state || !event.state.isEpisodeDetailModal) {
        setSelectedEpisodeModal(null);
      }
    };
    const handleCloseModals = () => {
      setSelectedEpisodeModal(null);
    };
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('app-close-modals', handleCloseModals);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('app-close-modals', handleCloseModals);
    };
  }, []);

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

  useEffect(() => {
    if (loading) return;

    let isScrollingFromTab = false;
    let scrollTimeout: NodeJS.Timeout;

    const handleScroll = () => {
      if (isScrollingFromTab) return;

      const upcomingRect = upcomingRef.current?.getBoundingClientRect();
      const historyRect = historyRef.current?.getBoundingClientRect();
      
      const offset = 250; // Threshold from top of viewport

      if (historyRect && historyRect.top < offset) {
        setActiveTab('history');
      } else if (upcomingRect && upcomingRect.top < offset) {
        setActiveTab('upcoming');
      } else {
        setActiveTab('watch_next');
      }
    };

    const container = document.getElementById('watchlist-container');
    if (container) {
      container.addEventListener('scroll', handleScroll, { passive: true });
    } else {
      window.addEventListener('scroll', handleScroll, { passive: true });
    }

    const handleTabScroll = () => {
      isScrollingFromTab = true;
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        isScrollingFromTab = false;
      }, 800);
    };

    window.addEventListener('tab-scroll', handleTabScroll);

    return () => {
      if (container) {
        container.removeEventListener('scroll', handleScroll);
      }
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('tab-scroll', handleTabScroll);
      clearTimeout(scrollTimeout);
    };
  }, [loading]);

  const scrollToSection = (ref: React.RefObject<HTMLDivElement>, tab: 'watch_next' | 'upcoming' | 'history') => {
    setActiveTab(tab);
    window.dispatchEvent(new CustomEvent('tab-scroll'));
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const shows = allShows.filter(s => s.mediaType !== 'movie');

  const isNotUpToDate = (s: Show): boolean => {
    if (s.isArchived) return false;
    if (s.status === 'dropped') return false;
    const watchedCount = s.seenEpisodes ? s.seenEpisodes.length : 0;
    
    // Si l'utilisateur a vu des épisodes et qu'il n'y a plus d'épisodes suivants enregistrés : considéré comme à jour !
    if (watchedCount > 0 && !s.nextEpisodeToWatch) {
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
    // 1. Nouvelle saison (catégorie NEW_SEASON ou S2+ ép 1 avec air_date <= 60 jours)
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

    // 2. Pas commencé du tout (0 épisode vu) avec une date de sortie ou d'ajout <= 60 jours
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

  // Nouveautés : nouvelle saison ou pas commencé avec sortie/ajout < 60 jours
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

  // Continuer à regarder : séries commencées et vues dans les 60 derniers jours (et pas dans nouveautés)
  // Toujours triées par la dernière série vue en premier (du plus récent au plus ancien)
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

  // Pas vu depuis un moment : rien vu depuis plus de 60 jours
  const pasVuDepuisUnMomentShows = candidateWatchShows
    .filter(s => !continueWatchingIds.has(s.id) && !nouveautesIds.has(s.id))
    .sort((a, b) => {
      const timeA = getShowLastWatchedTime(a);
      const timeB = getShowLastWatchedTime(b);
      const diff = timeA - timeB;
      if (diff !== 0) return diff;
      return a.title.localeCompare(b.title);
    });

  const todayIso = new Date().toISOString().slice(0, 10);

  // Films à voir : films non archivés, non abandonnés, non vus et DÉJÀ DISPONIBLES (date de sortie <= aujourd'hui)
  const filmsAVoirShows = allShows
    .filter(s => {
      if (s.mediaType !== 'movie' || s.isArchived || s.status === 'dropped' || s.status === 'completed') {
        return false;
      }
      if (s.seenEpisodes && s.seenEpisodes.includes('movie')) {
        return false;
      }
      // Ne pas afficher les films non encore disponibles/sortis (ex: date de sortie > aujourd'hui)
      if (s.firstAirDate && s.firstAirDate > todayIso) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const addedA = a.updatedAt || a.createdAt || 0;
      const addedB = b.updatedAt || b.createdAt || 0;
      const diff = addedB - addedA; // Plus récent d'abord
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

  const markNextEpisodeAsSeen = async (show: Show) => {
    if (!show.id) return;
    const nextEpNum = show.nextEpisodeToWatch;
    if (!nextEpNum) return;
    
    const epKey = `${nextEpNum.season_number}x${nextEpNum.episode_number}`;
    const sNumStr = String(nextEpNum.season_number).padStart(2, '0');
    const eNumStr = String(nextEpNum.episode_number).padStart(2, '0');

    // Save previous state for undo capability
    const prevSeenEpisodes = show.seenEpisodes || [];
    const prevEpisodeRecords = show.episodeRecords || {};
    const prevLastWatchedAt = show.lastWatchedAt || null;
    const prevNextEpisodeToWatch = show.nextEpisodeToWatch || null;

    const newSeen = new Set(prevSeenEpisodes);
    newSeen.add(epKey);
    const newRecords = { ...prevEpisodeRecords };
    newRecords[epKey] = { 
      watchedAt: Date.now(),
      episodeTitle: nextEpNum.name || null
    };
    
    const totalEps = show.totalAiredEpisodes || show.totalEpisodes || 0;
    const newSeenArray = Array.from(newSeen as Set<string>);
    let optimisticNextEp: any = null;
    
    if (totalEps > 0 && newSeenArray.length >= totalEps) {
      // Done!
      optimisticNextEp = null;
    } else {
      let nextEpObj: any = null;
      if (show.tmdbId) {
        try {
          const seasonRes = await tmdb.getSeasonDetails(show.tmdbId, nextEpNum.season_number);
          if (seasonRes.ok && seasonRes.value?.episodes) {
            const match = seasonRes.value.episodes.find((x: any) => x.episode_number === nextEpNum.episode_number + 1);
            if (match) {
              nextEpObj = match;
            } else {
              const nextSeasonRes = await tmdb.getSeasonDetails(show.tmdbId, nextEpNum.season_number + 1);
              if (nextSeasonRes.ok && nextSeasonRes.value?.episodes?.[0]) {
                nextEpObj = nextSeasonRes.value.episodes[0];
              }
            }
          }
        } catch (e) {
          console.error('Error fetching next ep in markNextEpisodeAsSeen:', e);
        }
      }

      optimisticNextEp = {
        season_number: nextEpObj ? nextEpObj.season_number : nextEpNum.season_number,
        episode_number: nextEpObj ? nextEpObj.episode_number : (nextEpNum.episode_number + 1),
        air_date: nextEpObj?.air_date || null,
        name: nextEpObj?.name || null,
        still_path: nextEpObj?.still_path || null
      };
    }
    
    // Check if the show was currently in "Pas vu depuis un moment"
    const wasInPasVu = pasVuDepuisUnMomentShows.some(s => s.id === show.id);

    await updateShow(show.id, {
      seenEpisodes: newSeenArray,
      episodeRecords: newRecords,
      lastWatchedAt: Date.now(),
      updatedAt: Date.now(),
      nextEpisodeToWatch: optimisticNextEp,
      isSynced: false
    });
    syncSingleItem(show.id, true).catch(console.error);
    scrollAllCarouselsToStart();

    // Si la série était dans "Pas vu depuis un moment", faire remonter le scroll vers "Continuer à regarder"
    if (wasInPasVu) {
      setTimeout(() => {
        const container = document.getElementById('watchlist-container');
        if (container) {
          container.scrollTop = 0;
          try {
            container.scrollTo({ top: 0, behavior: 'smooth' });
          } catch (e) {}
        }
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        window.scrollTo({ top: 0, behavior: 'smooth' });
        
        if (watchNextRef.current) {
          try {
            watchNextRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } catch (e) {}
        }
        
        const continueCarousel = document.getElementById('continue-watching-carousel');
        if (continueCarousel) {
          continueCarousel.scrollLeft = 0;
          try {
            continueCarousel.scrollTo({ left: 0, behavior: 'smooth' });
          } catch (e) {}
        }
        scrollAllCarouselsToStart();
      }, 250);
    }

    showToast(
      `« ${show.title} » S${sNumStr}E${eNumStr} marqué comme vu !`,
      'success',
      show,
      async () => {
        if (show.id) {
          await updateShow(show.id, {
            seenEpisodes: prevSeenEpisodes,
            episodeRecords: prevEpisodeRecords,
            lastWatchedAt: prevLastWatchedAt,
            nextEpisodeToWatch: prevNextEpisodeToWatch,
            updatedAt: Date.now(),
            isSynced: false
          });
          syncSingleItem(show.id, true).catch(console.error);
          scrollAllCarouselsToStart();
        }
      }
    );
  };

  const markMovieAsSeen = async (show: Show) => {
    if (!show.id) return;
    const prevSeen = show.seenEpisodes || [];
    const prevRecords = show.episodeRecords || {};
    const prevStatus = show.status;
    const prevLastWatchedAt = show.lastWatchedAt || null;

    const newRecords = { ...prevRecords };
    newRecords['movie'] = {
      watchedAt: Date.now(),
      episodeTitle: show.title || 'Film'
    };

    await updateShow(show.id, {
      seenEpisodes: ['movie'],
      episodeRecords: newRecords,
      status: 'completed',
      lastWatchedAt: Date.now(),
      updatedAt: Date.now(),
      isSynced: false,
    });
    scrollAllCarouselsToStart();

    showToast(
      `« ${show.title} » marqué comme vu !`,
      'success',
      show,
      async () => {
        if (show.id) {
          await updateShow(show.id, {
            seenEpisodes: prevSeen,
            episodeRecords: prevRecords,
            status: prevStatus,
            lastWatchedAt: prevLastWatchedAt,
            updatedAt: Date.now(),
            isSynced: false,
          });
          scrollAllCarouselsToStart();
        }
      }
    );
  };

  return (
    <div id="watchlist-container" className="flex-1 overflow-y-auto bg-transparent text-white pb-nav">
      <div className="sticky top-0 z-40 px-4 sm:px-6 pt-6 pb-4 flex flex-col gap-3 bg-zinc-950/60 backdrop-blur-xl">
        <div className="absolute top-0 left-0 w-72 h-40 bg-[#E5A93D]/15 blur-[120px] -z-10 rounded-full mix-blend-screen pointer-events-none" />
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 shrink-0">
            <h1 className="text-3xl font-black text-white tracking-tight flex items-center gap-3 whitespace-nowrap">
              <SeenItLogo size={34} symbol="watch" animated />
              <span>À Voir</span>
            </h1>
            <span className="relative flex h-2.5 w-2.5 shrink-0" title="En direct / Instant présent">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#E5A93D] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#E5A93D]"></span>
            </span>
          </div>
          <div className="min-w-0 flex-1 flex justify-end overflow-hidden">
            <SyncStatusIndicator />
          </div>
        </div>
        <div className="bg-zinc-900/70 p-1 rounded-2xl border border-white/10 flex w-full backdrop-blur-md shadow-inner">
          <button 
            className={cn("flex-1 text-center py-2.5 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5", activeTab === 'watch_next' ? "bg-[#E5A93D] text-zinc-950 font-extrabold text-xs shadow-lg shadow-[#E5A93D]/20 scale-[1.01]" : "text-zinc-400 font-semibold text-xs hover:text-white hover:bg-white/5")}
            onClick={() => scrollToSection(watchNextRef, 'watch_next')}
          >
            <span>🍿</span>
            <span>À Regarder</span>
          </button>
          <button 
            className={cn("flex-1 text-center py-2.5 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5", activeTab === 'upcoming' ? "bg-[#E5A93D] text-zinc-950 font-extrabold text-xs shadow-lg shadow-[#E5A93D]/20 scale-[1.01]" : "text-zinc-400 font-semibold text-xs hover:text-white hover:bg-white/5")}
            onClick={() => scrollToSection(upcomingRef, 'upcoming')}
          >
            <span>📅</span>
            <span>À Venir</span>
          </button>
          <button 
            className={cn("flex-1 text-center py-2.5 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5", activeTab === 'history' ? "bg-[#E5A93D] text-zinc-950 font-extrabold text-xs shadow-lg shadow-[#E5A93D]/20 scale-[1.01]" : "text-zinc-400 font-semibold text-xs hover:text-white hover:bg-white/5")}
            onClick={() => scrollToSection(historyRef, 'history')}
          >
            <span>📜</span>
            <span>Historique</span>
          </button>
        </div>
      </div>

      <div className="pb-4 space-y-4">
        {isQuotaExceeded && (
          <div className="mx-4 sm:mx-6 mb-4 mt-2 p-4 bg-red-950/40 border border-red-500/20 rounded-2xl text-red-200 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold mb-1 flex items-center gap-2 text-red-400">
                <span>⚠️</span> Quota quotidien précédemment atteint
              </h3>
              <p className="text-xs leading-relaxed opacity-90">
                Le quota Firestore avait été atteint. Si vous venez de basculer sur la nouvelle base de données réinitialisée, vous pouvez réinitialiser cet avertissement.
              </p>
            </div>
            <button
              onClick={() => useSyncStore.getState().resetQuotaError()}
              className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-200 font-semibold rounded-xl text-xs transition-colors shrink-0"
            >
              Réessayer
            </button>
          </div>
        )}

        {loading ? (
          <div className="space-y-6 pt-2 pb-nav">
            {/* ShowNewsFeed Skeleton */}
            <div className="mb-8 mt-4">
              <div className="flex items-center gap-2 mb-4 px-4 sm:px-6">
                <div className="h-6 w-6 bg-zinc-800 rounded-full animate-pulse" />
                <div className="h-6 w-40 bg-zinc-800 rounded animate-pulse" />
              </div>
              <div className="flex overflow-x-auto gap-4 px-4 sm:px-6 hide-scrollbar pb-4">
                {[1, 2].map(i => (
                  <div key={i} className="w-[280px] shrink-0 h-[120px] bg-zinc-900 rounded-2xl border border-white/5 animate-pulse" />
                ))}
              </div>
            </div>

            {/* Continuer à regarder Skeleton */}
            <div className="mb-6 mt-1">
              <div className="flex items-center justify-between mb-4 px-4 sm:px-6">
                <div className="h-7 w-48 bg-zinc-800 rounded animate-pulse" />
                <div className="h-4 w-12 bg-zinc-800 rounded animate-pulse" />
              </div>
              <div className="flex overflow-x-auto gap-4 px-4 sm:px-6 hide-scrollbar pb-1">
                {[1, 2, 3].map(i => (
                  <div key={i} className="w-64 shrink-0 flex flex-col">
                    <div className="w-full aspect-[4/3] rounded-2xl bg-zinc-900 animate-pulse mb-3" />
                    <div className="h-3 w-3/4 bg-zinc-800 rounded-full animate-pulse mb-1.5" />
                    <div className="h-4 w-1/2 bg-zinc-800 rounded-full animate-pulse" />
                  </div>
                ))}
              </div>
            </div>

            {/* Nouveautés Skeleton */}
            <div className="mb-6 mt-1">
              <div className="flex items-center justify-between mb-4 px-4 sm:px-6">
                <div className="h-7 w-48 bg-zinc-800 rounded animate-pulse" />
                <div className="h-4 w-12 bg-zinc-800 rounded animate-pulse" />
              </div>
              <div className="flex overflow-x-auto gap-4 px-4 sm:px-6 hide-scrollbar pb-1">
                {[1, 2, 3].map(i => (
                  <div key={i} className="w-64 shrink-0 flex flex-col">
                    <div className="w-full aspect-[4/3] rounded-2xl bg-zinc-900 animate-pulse mb-3" />
                    <div className="h-3 w-3/4 bg-zinc-800 rounded-full animate-pulse mb-1.5" />
                    <div className="h-4 w-1/2 bg-zinc-800 rounded-full animate-pulse" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Section A: À Regarder */}
            <div ref={watchNextRef} className="scroll-mt-36">
          <ShowNewsFeed onShowClick={onShowClickProp} onNavigateToShow={onShowClickProp} />

          {continueWatchingShows.length > 0 && (
            <div className="mt-1">
              <div className="flex items-center justify-between mb-2 px-4 sm:px-6">
                <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                  <span className="text-lg">⏯️</span>
                  <span>Continuer à regarder</span>
                </h2>
                <button 
                  onClick={() => handleToggleVoirTout('continueWatching')}
                  className="text-xs font-bold text-[#E5A93D] hover:underline cursor-pointer"
                >
                  {expandedSection === 'continueWatching' ? 'Réduire' : 'Voir tout'}
                </button>
              </div>

              {expandedSection === 'continueWatching' ? (
                <div className="flex flex-col gap-3 my-2 px-4 sm:px-6">
                  {continueWatchingShows.slice(0, visibleCount).map(show => (
                    <SwipeableCard
                      key={show.id}
                      onSwipeLeft={() => setPendingAction({ type: 'unfollow', item: show })}
                      onSwipeRight={() => setPendingAction({ type: 'drop', item: show })}
                    >
                      <ExpandedItemCard 
                        show={show}
                        sectionType="watchNext"
                        onShowClick={onShowClick}
                        onEpisodeClick={handleEpisodeClick}
                        onMarkAsSeen={markNextEpisodeAsSeen}
                      />
                    </SwipeableCard>
                  ))}
                  {visibleCount < continueWatchingShows.length && (
                    <button 
                      onClick={() => setVisibleCount(prev => prev + 8)}
                      className="w-full py-3.5 mt-2 bg-zinc-900 border border-white/10 rounded-2xl text-xs font-bold text-zinc-300 hover:bg-zinc-800 active:scale-[0.98] transition-all"
                    >
                      Charger plus
                    </button>
                  )}
                </div>
              ) : (
                <div id="continue-watching-carousel" className="flex overflow-x-auto gap-4 px-4 sm:px-6 scroll-px-4 sm:scroll-px-6 scrollbar-none snap-x snap-mandatory pb-1">
                  {continueWatchingShows.map(show => (
                    <ContinueWatchingCard 
                      key={show.id}
                      show={show}
                      onShowClick={onShowClick}
                      onEpisodeClick={handleEpisodeClick}
                      onMarkAsSeen={markNextEpisodeAsSeen}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {nouveautesShows.length > 0 && (
            <div className="mt-8">
              <div className="flex items-center justify-between mb-2 px-4 sm:px-6">
                <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                  <span className="text-lg">✨</span>
                  <span>Nouveautés</span>
                </h2>
                <button 
                  onClick={() => handleToggleVoirTout('nouveautes')}
                  className="text-xs font-bold text-[#E5A93D] hover:underline cursor-pointer"
                >
                  {expandedSection === 'nouveautes' ? 'Réduire' : 'Voir tout'}
                </button>
              </div>

              {expandedSection === 'nouveautes' ? (
                <div className="flex flex-col gap-3 my-2 px-4 sm:px-6">
                  {nouveautesShows.slice(0, visibleCount).map(show => (
                    <SwipeableCard
                      key={show.id}
                      onSwipeLeft={() => setPendingAction({ type: 'unfollow', item: show })}
                      onSwipeRight={() => setPendingAction({ type: 'drop', item: show })}
                    >
                      <ExpandedItemCard 
                        show={show}
                        sectionType="watchNext"
                        onShowClick={onShowClick}
                        onEpisodeClick={handleEpisodeClick}
                        onMarkAsSeen={markNextEpisodeAsSeen}
                      />
                    </SwipeableCard>
                  ))}
                  {visibleCount < nouveautesShows.length && (
                    <button 
                      onClick={() => setVisibleCount(prev => prev + 8)}
                      className="w-full py-3.5 mt-2 bg-zinc-900 border border-white/10 rounded-2xl text-xs font-bold text-zinc-300 hover:bg-zinc-800 active:scale-[0.98] transition-all"
                    >
                      Charger plus
                    </button>
                  )}
                </div>
              ) : (
                <div id="nouveautes-carousel" className="flex overflow-x-auto gap-4 px-4 sm:px-6 scroll-px-4 sm:scroll-px-6 scrollbar-none snap-x snap-mandatory pb-1">
                  {nouveautesShows.map(show => (
                    <ContinueWatchingCard 
                      key={show.id}
                      show={show}
                      onShowClick={onShowClick}
                      onEpisodeClick={handleEpisodeClick}
                      onMarkAsSeen={markNextEpisodeAsSeen}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {pasVuDepuisUnMomentShows.length > 0 && (
            <div className="mt-8">
              <div className="flex items-center justify-between mb-2 px-4 sm:px-6">
                <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                  <span className="text-lg">⏳</span>
                  <span>Pas vu depuis un moment</span>
                </h2>
                <button 
                  onClick={() => handleToggleVoirTout('notWatched')}
                  className="text-xs font-bold text-[#E5A93D] hover:underline cursor-pointer"
                >
                  {expandedSection === 'notWatched' ? 'Réduire' : 'Voir tout'}
                </button>
              </div>

              {expandedSection === 'notWatched' ? (
                <div className="flex flex-col gap-3 my-2 px-4 sm:px-6">
                  {pasVuDepuisUnMomentShows.slice(0, visibleCount).map(show => (
                    <SwipeableCard
                      key={show.id}
                      onSwipeLeft={() => setPendingAction({ type: 'unfollow', item: show })}
                      onSwipeRight={() => setPendingAction({ type: 'drop', item: show })}
                    >
                      <ExpandedItemCard 
                        show={show}
                        sectionType="notWatched"
                        onShowClick={onShowClick}
                        onEpisodeClick={handleEpisodeClick}
                        onMarkAsSeen={markNextEpisodeAsSeen}
                      />
                    </SwipeableCard>
                  ))}
                  {visibleCount < pasVuDepuisUnMomentShows.length && (
                    <button 
                      onClick={() => setVisibleCount(prev => prev + 8)}
                      className="w-full py-3.5 mt-2 bg-zinc-900 border border-white/10 rounded-2xl text-xs font-bold text-zinc-300 hover:bg-zinc-800 active:scale-[0.98] transition-all"
                    >
                      Charger plus
                    </button>
                  )}
                </div>
              ) : (
                <div id="pas-vu-depuis-un-moment-carousel" className="flex overflow-x-auto gap-4 px-4 sm:px-6 scroll-px-4 sm:scroll-px-6 scrollbar-none snap-x snap-mandatory pb-1">
                  {pasVuDepuisUnMomentShows.map(show => (
                    <ContinueWatchingCard 
                      key={show.id}
                      show={show}
                      onShowClick={onShowClick}
                      onEpisodeClick={handleEpisodeClick}
                      onMarkAsSeen={markNextEpisodeAsSeen}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {filmsAVoirShows.length > 0 && (
            <div className="mt-8">
              <div className="flex items-center justify-between mb-2 px-4 sm:px-6">
                <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                  <span className="text-lg">🎬</span>
                  <span>Films à voir</span>
                </h2>
                <button 
                  onClick={() => handleToggleVoirTout('filmsAVoir')}
                  className="text-xs font-bold text-[#E5A93D] hover:underline cursor-pointer"
                >
                  {expandedSection === 'filmsAVoir' ? 'Réduire' : 'Voir tout'}
                </button>
              </div>

              {expandedSection === 'filmsAVoir' ? (
                <div className="flex flex-col gap-3 my-2 px-4 sm:px-6">
                  {filmsAVoirShows.slice(0, visibleCount).map(show => (
                    <SwipeableCard
                      key={show.id}
                      onSwipeLeft={() => setPendingAction({ type: 'unfollow', item: show })}
                      onSwipeRight={() => setPendingAction({ type: 'drop', item: show })}
                    >
                      <ExpandedItemCard 
                        show={show}
                        sectionType="watchNext"
                        onShowClick={onShowClick}
                        onEpisodeClick={handleEpisodeClick}
                        onMarkAsSeen={markMovieAsSeen}
                      />
                    </SwipeableCard>
                  ))}
                  {visibleCount < filmsAVoirShows.length && (
                    <button 
                      onClick={() => setVisibleCount(prev => prev + 8)}
                      className="w-full py-3.5 mt-2 bg-zinc-900 border border-white/10 rounded-2xl text-xs font-bold text-zinc-300 hover:bg-zinc-800 active:scale-[0.98] transition-all"
                    >
                      Charger plus
                    </button>
                  )}
                </div>
              ) : (
                <div id="films-a-voir-carousel" className="flex overflow-x-auto gap-4 px-4 sm:px-6 scroll-px-4 sm:scroll-px-6 scrollbar-none snap-x snap-mandatory pb-1">
                  {filmsAVoirShows.map(show => (
                    <MovieWatchCard 
                      key={show.id}
                      show={show}
                      onShowClick={onShowClick}
                      onMarkAsSeen={markMovieAsSeen}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {continueWatchingShows.length === 0 && nouveautesShows.length === 0 && pasVuDepuisUnMomentShows.length === 0 && filmsAVoirShows.length === 0 && (
            <div className="py-8 text-center text-zinc-500 text-sm px-4 sm:px-6">
              Rien à afficher dans À Regarder pour le moment.
            </div>
          )}
        </div>

        {/* Section B: À Venir */}
        <div ref={upcomingRef} className="scroll-mt-36 px-4 sm:px-6 mt-8">
          <h2 className="text-xl font-bold text-white mb-2 tracking-tight flex items-center gap-2">
            <span className="text-lg">📅</span>
            <span>À Venir</span>
          </h2>
          {upcomingShows.length > 0 ? (
            <div className="space-y-3">
              {upcomingShows.map(show => (
                <SwipeableCard
                  key={show.id}
                  onSwipeLeft={() => setPendingAction({ type: 'unfollow', item: show })}
                  onSwipeRight={() => setPendingAction({ type: 'drop', item: show })}
                >
                  <UpcomingShowCard 
                    show={show}
                    onShowClick={onShowClick}
                    onEpisodeClick={handleEpisodeClick}
                  />
                </SwipeableCard>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-zinc-500 text-sm">
              Aucun épisode à venir.
            </div>
          )}
        </div>

        {/* Section C: Historique */}
        <div ref={historyRef} className="scroll-mt-36 px-4 sm:px-6 mt-8">
          <h2 className="text-xl font-bold text-white mb-2 tracking-tight flex items-center gap-2">
            <span className="text-lg">📜</span>
            <span>Historique</span>
          </h2>
          <HistoryFeed 
            onShowClick={onShowClick} 
            onEpisodeClick={(showId, season, episode) => {
              const show = allShows?.find(s => s.id === showId || s.tmdbId?.toString() === showId);
              if (show) {
                handleEpisodeClick(show, season, episode);
              } else if (onShowClick) {
                onShowClick(showId, 'tv');
              }
            }}
          />
        </div>
        </>
        )}
      </div>

      {selectedEpisodeModal && (
        <EpisodeDetailModal 
          show={selectedEpisodeModal.show}
          season={selectedEpisodeModal.season}
          episode={selectedEpisodeModal.episode}
          tmdbShowTitle={selectedEpisodeModal.show.title}
          tmdbShowId={selectedEpisodeModal.show.tmdbId}
          onShowClick={(tmdbId) => {
            setSelectedEpisodeModal(null);
            if (window.history.state?.isEpisodeDetailModal || window.history.state?.isModal) {
              window.history.back();
            }
            setTimeout(() => {
              if (onShowClick) {
                if (selectedEpisodeModal.show.id) {
                  onShowClick(selectedEpisodeModal.show.id, selectedEpisodeModal.show.mediaType);
                } else {
                  onShowClick(tmdbId.toString(), selectedEpisodeModal.show.mediaType);
                }
              }
            }, 50);
          }}
          onClose={() => {
            setSelectedEpisodeModal(null);
            if (window.history.state?.isEpisodeDetailModal || window.history.state?.isModal) {
              window.history.back();
            }
          }}
        />
      )}

      {pendingAction && (
        <div 
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setPendingAction(null);
            }
          }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            className="bg-zinc-900 border border-white/10 rounded-3xl p-6 w-full max-w-sm shadow-2xl flex flex-col items-center text-center"
          >
            {pendingAction.type === 'drop' ? (
              <>
                <div className="w-14 h-14 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center mb-4">
                  <Ban size={28} />
                </div>
                <h3 className="text-base font-bold text-white mb-2">Abandonner la série ?</h3>
                <p className="text-xs text-zinc-400 mb-6 leading-relaxed">
                  Voulez-vous vraiment marquer <strong className="text-white">{pendingAction.item.title}</strong> comme abandonnée ? Elle sera déplacée dans vos séries abandonnées.
                </p>
                <button 
                  type="button"
                  onPointerUp={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const item = pendingAction.item;
                    handleDropShow(item);
                    setTimeout(() => {
                      setPendingAction(null);
                    }, 100);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  className="w-full py-3 rounded-xl bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30 [@media(hover:hover)]:hover:bg-amber-500/30 active:bg-amber-500/30 mb-2 active:scale-95 transition-all cursor-pointer touch-manipulation select-none"
                >
                  Marquer comme abandonnée
                </button>
              </>
            ) : pendingAction.type === 'archive' ? (
              <>
                <div className="w-14 h-14 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center mb-4">
                  <Archive size={28} />
                </div>
                <h3 className="text-base font-bold text-white mb-2">Archiver cette série ?</h3>
                <p className="text-xs text-zinc-400 mb-6">
                  <strong className="text-white">{pendingAction.item.title}</strong> sera déplacée dans vos archives.
                </p>
                <button 
                  type="button"
                  onPointerUp={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const item = pendingAction.item;
                    handleArchiveShow(item);
                    setTimeout(() => {
                      setPendingAction(null);
                    }, 100);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  className="w-full py-3 rounded-xl bg-blue-500/20 text-blue-400 font-bold border border-blue-500/30 [@media(hover:hover)]:hover:bg-blue-500/30 active:bg-blue-500/30 mb-2 active:scale-95 transition-all cursor-pointer touch-manipulation select-none"
                >
                  Confirmer l'archivage
                </button>
              </>
            ) : (
              <>
                <div className="w-14 h-14 rounded-full bg-red-500/20 text-red-500 flex items-center justify-center mb-4">
                  <Trash2 size={28} />
                </div>
                <h3 className="text-base font-bold text-white mb-2">Supprimer la série ?</h3>
                <p className="text-xs text-zinc-400 mb-6 leading-relaxed">
                  Voulez-vous vraiment supprimer <strong className="text-white">{pendingAction.item.title}</strong> de votre suivi ?
                  {((pendingAction.item.seenEpisodes && pendingAction.item.seenEpisodes.length > 0) ||
                    (pendingAction.item.episodeRecords && Object.keys(pendingAction.item.episodeRecords).length > 0)) && (
                    <span className="block mt-2 text-red-400 font-semibold">⚠️ Votre progression de visionnage sera réinitialisée.</span>
                  )}
                </p>
                <button 
                  type="button"
                  onPointerUp={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const item = pendingAction.item;
                    executeUnfollow(item);
                    setTimeout(() => {
                      setPendingAction(null);
                    }, 100);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  className="w-full py-3 rounded-xl bg-red-500/20 text-red-500 font-bold border border-red-500/30 [@media(hover:hover)]:hover:bg-red-500/30 active:bg-red-500/30 mb-2 active:scale-95 transition-all cursor-pointer touch-manipulation select-none"
                >
                  Supprimer
                </button>
              </>
            )}

            <button 
              type="button"
              onPointerUp={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setTimeout(() => {
                  setPendingAction(null);
                }, 100);
              }}
              onClick={(e) => {
                e.stopPropagation();
              }}
              className="w-full py-3 rounded-xl bg-zinc-800 text-zinc-300 font-bold [@media(hover:hover)]:hover:bg-zinc-700 active:bg-zinc-700 mb-2 active:scale-95 transition-all cursor-pointer touch-manipulation select-none"
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
