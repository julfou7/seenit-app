import React, { useState, useEffect, useRef, useMemo } from 'react';
import { type Show } from '../types';
import { tmdb, isAdultOrParodyMedia, isMovieAtCinema, isMovieUpcoming } from '../features/shows/tmdb';
import { ChevronLeft, Star, Heart, CheckCircle2, Circle, Tv, Zap, X, EyeOff, Archive, Trash2, MoreVertical, Plus, Check, Share, Share2, Play, Calendar, ChevronUp, ChevronDown, ArchiveRestore, Ban, RotateCcw, MonitorPlay, Ticket, Youtube, Clapperboard, ExternalLink, Clock, RefreshCw, Download } from 'lucide-react';
import { cn, computeAutoArchiveStatus, formatAirDateSafe, formatVoteCount, getBestLogoPath, getTodayStr, getCalendarDaysDiff, getEpisodeRelativeAirDate, scrollAllCarouselsToStart, openExternalUrl, checkIsUpToDate } from '../lib/utils';
import { EpisodeDetailModal } from './EpisodeDetailModal';
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
import { getSeriesImdbData } from '../features/shows/omdbService';
import { getFormattedProviderLogo, PLEX_LOGO_SVG } from '../utils/providerLogos';
import { checkPlexAvailability, PlexMediaInfo } from '../features/plex/plexAvailability';
import { useMediaPresence } from '../hooks/useMediaPresence';
import { RedditSection } from '../components/community/RedditSection';
import { useLiveDownloadStore } from '../store/liveDownloadStore';
import { LiveDownloadBanner } from '../components/LiveDownloadBanner';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { searchAndDownloadInSonarr, searchAndDownloadInRadarr } from '../services/sonarrRadarr';


interface ShowDetailScreenProps {
  key?: string;
  showId?: string;
  tmdbId?: number;
  mediaType?: 'tv' | 'movie';
  initialSeason?: number;
  initialEpisode?: number;
  onBack: () => void;
  onShowClick?: (tmdbId: number, mediaType?: 'tv' | 'movie') => void;
}

const getSeasonReleaseDateText = (airDate?: string): string | null => {
  if (!airDate || !airDate.trim()) return null;
  const str = airDate.trim();
  const parts = str.split('-');
  
  if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);
    if (!isNaN(year) && !isNaN(month) && !isNaN(day) && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(year, month - 1, day);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
      }
    }
    if (!isNaN(year) && year > 1900) {
      return year.toString();
    }
  }

  if (parts[0] && parts[0].length === 4) {
    const year = parseInt(parts[0], 10);
    if (!isNaN(year) && year > 1900) {
      return year.toString();
    }
  }

  return null;
};

const getEpisodeAirDateLabel = (airDate?: string | null) => {
  if (!airDate) return 'Bientôt';

  const diffDays = getCalendarDaysDiff(airDate);
  if (diffDays < 0) return null; // Déjà sorti
  if (diffDays === 0) return "Aujourd'hui";
  if (diffDays === 1) return 'Demain';
  if (diffDays <= 7) return `Dans ${diffDays} jours`;

  return `Le ${formatAirDateSafe(airDate, 'short')}`;
};

function formatAgeRating(rating: string | undefined | null): { label: string; color: string } {
  if (!rating) return { label: 'Non classé', color: 'bg-zinc-800 text-zinc-400 border-zinc-700' };

  const r = rating.trim().toUpperCase();

  if (r === '18' || r === '-18' || r === 'TV-MA' || r === 'R' || r === 'NC-17') {
    return { label: '-16 ANS', color: 'bg-red-500/15 border-red-500/30 text-red-400' };
  }
  if (r === '16' || r === '-16') {
    return { label: '-16 ANS', color: 'bg-red-500/15 border-red-500/30 text-red-400' };
  }
  if (r === '12' || r === '-12' || r === 'TV-14' || r === 'PG-13') {
    return { label: '-12 ANS', color: 'bg-amber-500/15 border-amber-500/30 text-amber-400' };
  }
  if (r === '10' || r === '-10' || r === 'TV-PG' || r === 'PG') {
    return { label: '-10 ANS', color: 'bg-amber-500/15 border-amber-500/30 text-amber-400' };
  }
  if (r === 'U' || r === 'G' || r === 'TV-G' || r === 'TV-Y' || r === 'TV-Y7' || r.includes('TOUS')) {
    return { label: 'TOUS PUBLICS', color: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' };
  }

  return { label: r.startsWith('-') ? `${r} ANS` : r, color: 'bg-amber-500/15 border-amber-500/30 text-amber-400' };
}

const getCleanProviderName = (provider: any) => {
  const name = (provider.provider_name || '').toLowerCase();
  if (name.includes('netflix')) return 'Netflix';
  if (name.includes('prime') || name.includes('amazon')) return 'Prime Video';
  if (name.includes('disney')) return 'Disney+';
  if (name.includes('canal') || name.includes('mycanal')) return 'Canal+';
  if (name.includes('apple tv') || name.includes('apple')) return 'Apple TV+';
  if (name.includes('paramount')) return 'Paramount+';
  if (name.includes('max') || name.includes('hbo')) return 'Max';
  if (name.includes('france') || name.includes('ftv')) return 'France TV';
  if (name.includes('arte')) return 'Arte';
  return provider.provider_name
    .replace(/ à la demande/gi, '')
    .replace(/ Plus/gi, '+')
    .replace(/ Channel/gi, '')
    .trim();
};

const getProviderDirectLink = (providerId: number, title: string, fallbackLink: string) => {
  const query = encodeURIComponent(title);
  switch (providerId) {
    case 8: return `https://www.netflix.com/search?q=${query}`;
    case 119: return `https://www.primevideo.com/search/ref=atv_sr_sug_1?phrase=${query}`;
    case 337: return `https://www.disneyplus.com/search?q=${query}`;
    case 381: return `https://www.canalplus.com/recherche/?q=${query}`;
    case 350: return `https://tv.apple.com/fr/search?q=${query}`;
    case 531: return `https://www.paramountplus.com/search/?q=${query}`;
    case 1899: return `https://www.max.com/search?q=${query}`;
    case 234: return `https://www.france.tv/recherche/?q=${query}`;
    case 239: return `https://www.arte.tv/fr/search/?q=${query}`;
    default: return fallbackLink || '#';
  }
};

const ASIAN_COUNTRIES = new Set(['KR', 'JP', 'CN', 'TW', 'TH', 'HK']);
const NON_FICTION_GENRES = [10767, 10763, 10764, 10766]; // Talk, News, Reality, Soap

const getPrioritizedSimilarMedia = (tmdbDetails: any, collectionData?: any) => {
  if (!tmdbDetails) return [];

  const collectionIds = new Set<number>(
    (collectionData?.parts || []).map((p: any) => p.id)
  );
  
  // Toujours exclure le media actuel et ses spin-offs directs
  const isDuplicate = (item: any) => {
    if (!item || !item.poster_path) return true;
    if (item.id === tmdbDetails.id) return true;
    if (collectionIds.has(item.id)) return true;
    if (isAdultOrParodyMedia(item)) return true;
    if ((item.vote_count || 0) < 50) return true;
    return false;
  };

  const currentGenreIds = new Set<number>(
    (tmdbDetails.genres || []).map((g: any) => g.id)
  );
  const forbiddenGenres = new Set<number>(
    NON_FICTION_GENRES.filter(gId => !currentGenreIds.has(gId))
  );

  const filterItem = (item: any, isSimilarFallback: boolean = false) => {
    if (isDuplicate(item)) return false;
    
    const itemGenres: number[] = item.genre_ids || [];
    if (itemGenres.some(gId => forbiddenGenres.has(gId))) return false;
    
    const countries = item.origin_country || [];
    const isAsian = countries.some((c: string) => ASIAN_COUNTRIES.has(c));
    if (isAsian) {
      const isGlobalHit = (item.vote_count || 0) >= 1000 || (item.popularity || 0) >= 80;
      if (!isGlobalHit) return false;
    }
    
    // Si ça vient de "similar" (basé sur mots clés), on est plus strict sur la qualité
    if (isSimilarFallback) {
      if ((item.vote_average || 0) < 6.5) return false;
      if ((item.vote_count || 0) < 300) return false;
    }
    
    return true;
  };

  let recommendations = (tmdbDetails.recommendations?.results || []).filter((i: any) => filterItem(i, false));
  let similar = (tmdbDetails.similar?.results || []).filter((i: any) => filterItem(i, true));
  
  // Trier le fallback similar par popularité pour éviter les résultats obscurs
  similar.sort((a: any, b: any) => (b.vote_count || 0) - (a.vote_count || 0));

  // Fusionner intelligemment : on garde les recommandations (comportement utilisateur) 
  // et on complète avec les meilleurs "similar" si on manque de recommandations.
  const seenIds = new Set<number>(recommendations.map((i: any) => i.id));
  const combined = [...recommendations];
  
  for (const item of similar) {
    if (!seenIds.has(item.id)) {
      combined.push(item);
      seenIds.add(item.id);
    }
  }

  return combined;
};

const getSmartDefaultSeason = (show: any, tmdbDetails: any): number => {
  // 1. Priorité 1 : Saison de l'épisode suivant à regarder
  if (show?.nextEpisodeToWatch?.season_number) {
    return show.nextEpisodeToWatch.season_number;
  }

  // 2. Priorité 2 : Saison du prochain épisode prévu en diffusion
  if (show?.nextEpisodeToAir?.season_number) {
    return show.nextEpisodeToAir.season_number;
  }

  // 3. Priorité 3 : Saison la plus haute dont au moins 1 épisode a été vu (Série terminée)
  if (show?.seenEpisodes && show.seenEpisodes.length > 0) {
    const watchedSeasons = show.seenEpisodes
      .map((epKey: string) => parseInt(epKey.split('x')[0], 10))
      .filter((s: number) => !isNaN(s) && s > 0);

    if (watchedSeasons.length > 0) {
      return Math.max(...watchedSeasons);
    }
  }

  // 4. Priorité 4 : Première saison disponible (Série non commencée)
  const validSeasons = tmdbDetails?.seasons?.filter((s: any) => s.season_number > 0) || [];
  return validSeasons.length > 0 ? validSeasons[0].season_number : 1;
};

export function ShowDetailScreen({ showId, tmdbId: externalTmdbId, mediaType: externalMediaType, initialSeason, initialEpisode, onBack, onShowClick }: ShowDetailScreenProps) {
  const { shows, addShow, updateShow, deleteShow } = useShows();
  const { showToast } = useToastStore();
  
  // Robust lookup to handle potential number/string mismatches and fallback if showId is actually a tmdbId
  const show = shows.find(s => 
    (showId && (String(s.id) === String(showId) || String(s.tmdbId) === String(showId))) || 
    (externalTmdbId && String(s.tmdbId) === String(externalTmdbId))
  );

  const lastKnownShowRef = useRef<any>(show);
  if (show) {
    lastKnownShowRef.current = show;
  }
  
  // Mémoriser de façon persistante le TMDB ID pour qu'une suppression de show ne rende jamais effectiveTmdbId undefined
  const persistentTmdbIdRef = useRef<number | undefined>(
    externalTmdbId ? Number(externalTmdbId) : (show?.tmdbId ? Number(show.tmdbId) : (showId && !isNaN(Number(showId)) ? Number(showId) : undefined))
  );
  if (!persistentTmdbIdRef.current) {
    if (externalTmdbId) persistentTmdbIdRef.current = Number(externalTmdbId);
    else if (show?.tmdbId) persistentTmdbIdRef.current = Number(show.tmdbId);
    else if (showId && !isNaN(Number(showId))) persistentTmdbIdRef.current = Number(showId);
  }

  const effectiveTmdbId = show?.tmdbId || (externalTmdbId ? Number(externalTmdbId) : undefined) || persistentTmdbIdRef.current;

  const [tmdbDetails, setTmdbDetails] = useState<any>(null);
  const title = show?.title || tmdbDetails?.name || tmdbDetails?.title || 'Chargement...';
  const isSeries = (show?.mediaType === 'tv') || (tmdbDetails?.number_of_seasons !== undefined);

  const releaseDateStr = isSeries ? (tmdbDetails?.first_air_date || (show as any)?.first_air_date) : (tmdbDetails?.release_date || (show as any)?.release_date);
  const releaseYear = releaseDateStr ? releaseDateStr.slice(0, 4) : undefined;
  const isUnreleased = releaseDateStr ? new Date(releaseDateStr).getTime() > Date.now() : false;

  const [fetchError, setFetchError] = useState<boolean>(false);
  const [collectionData, setCollectionData] = useState<any>(null);
  const [universeData, setUniverseData] = useState<any>(null);
  const [collectionLoading, setCollectionLoading] = useState<boolean>(true);
  const [imdbData, setImdbData] = useState<any>(null);
  const [imdbLoading, setImdbLoading] = useState<boolean>(false);
  const [providers, setProviders] = useState<any>(null);
  const [keywords, setKeywords] = useState<string[]>([]);
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
  const [isDownloadMode, setIsDownloadMode] = useState(false);
  const [is1ClickDownloading, setIs1ClickDownloading] = useState<Record<string, boolean>>({});

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

    // Ajout optimiste immédiat pour affichage instantané du badge "1" et de la barre
    useLiveDownloadStore.getState().addOptimisticDownload({
      mediaType: 'tv',
      title: `${showTitle} (S${seasonNumber}E${episodeNumber})`,
      seriesTitle: showTitle,
      tmdbId: effectiveTmdbId,
      tvdbId,
      seasonNumber,
      episodeNumber,
      downloadClient: 'Sonarr',
      statusText: 'Lancement dans Sonarr...'
    });

    try {
      const res = await searchAndDownloadInSonarr({
        url: config.sonarrUrl,
        apiKey: config.sonarrApiKey,
        title: showTitle,
        tmdbId: effectiveTmdbId,
        tvdbId,
        season: seasonNumber,
        episode: episodeNumber,
        qualityPreference: '1080p'
      });

      if (res.success) {
        showToast(`Téléchargement de S${seasonNumber}E${episodeNumber} lancé dans Sonarr !`, 'success');
        useLiveDownloadStore.getState().startPolling(1000);
        useLiveDownloadStore.getState().fetchDownloads();
      } else {
        showToast(res.message || "Erreur lors du lancement dans Sonarr", "error");
      }
    } catch (err: any) {
      showToast(err?.message || "Erreur réseau Sonarr", "error");
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

    // Ajout optimiste immédiat pour affichage instantané du badge "1" et de la barre
    useLiveDownloadStore.getState().addOptimisticDownload({
      mediaType: 'tv',
      title: `${showTitle} (Saison ${seasonNumber})`,
      seriesTitle: showTitle,
      tmdbId: effectiveTmdbId,
      tvdbId,
      seasonNumber,
      downloadClient: 'Sonarr',
      statusText: 'Lancement de la saison dans Sonarr...'
    });

    try {
      const res = await searchAndDownloadInSonarr({
        url: config.sonarrUrl,
        apiKey: config.sonarrApiKey,
        title: showTitle,
        tmdbId: effectiveTmdbId,
        tvdbId,
        season: seasonNumber,
        qualityPreference: '1080p'
      });

      if (res.success) {
        showToast(`Téléchargement de la Saison ${seasonNumber} lancé dans Sonarr !`, 'success');
        useLiveDownloadStore.getState().startPolling(1000);
        useLiveDownloadStore.getState().fetchDownloads();
      } else {
        showToast(res.message || "Erreur lors du lancement de la saison", "error");
      }
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

    setIs1ClickDownloading(prev => ({ ...prev, movie: true }));

    // Ajout optimiste immédiat pour affichage instantané du badge "1" et de la barre
    useLiveDownloadStore.getState().addOptimisticDownload({
      mediaType: 'movie',
      title: movieTitle,
      movieTitle: movieTitle,
      tmdbId: effectiveTmdbId,
      downloadClient: 'Radarr',
      statusText: 'Lancement dans Radarr...'
    });

    try {
      const res = await searchAndDownloadInRadarr({
        url: config.radarrUrl,
        apiKey: config.radarrApiKey,
        title: movieTitle,
        tmdbId: effectiveTmdbId,
        year: movieYear,
        imdbId,
        qualityPreference: '1080p'
      });

      if (res.success) {
        showToast(`Téléchargement de « ${movieTitle} » lancé dans Radarr !`, 'success');
        useLiveDownloadStore.getState().startPolling(1000);
        useLiveDownloadStore.getState().fetchDownloads();
      } else {
        showToast(res.message || "Erreur lors du lancement dans Radarr", "error");
      }
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
      if (res.success) {
        showToast(`« ${show.title} » a été synchronisé(e) avec succès !`, "success");
      } else {
        showToast(`Erreur : ${res.error || 'Échec de la synchronisation'}`, "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Erreur lors de la synchronisation", "error");
    } finally {
      setIsSyncingSingle(false);
    }
  };




  const [visibleSeasons, setVisibleSeasons] = useState(5);
  const [visibleSimilar, setVisibleSimilar] = useState(10);
  const [visibleCast, setVisibleCast] = useState(12);
  const [showAllCast, setShowAllCast] = useState(false);
  const [trailerModalVideos, setTrailerModalVideos] = useState<any[] | null>(null);
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);
  const [downloadTargetSeason, setDownloadTargetSeason] = useState<number | undefined>(undefined);
  const [downloadTargetEpisode, setDownloadTargetEpisode] = useState<number | undefined>(undefined);

  // Téléchargements en direct (Sonarr / Radarr / qBittorrent)
  const { startPolling, stopPolling, getShowDownloads, getMovieDownload, getEpisodeDownload } = useLiveDownloadStore();

  useEffect(() => {
    startPolling(4000);
    return () => {
      stopPolling();
    };
  }, [startPolling, stopPolling]);

  const activeDownloads = isSeries
    ? getShowDownloads(effectiveTmdbId, tmdbDetails?.external_ids?.tvdb_id || (show as any)?.tvdbId, tmdbDetails?.name || show?.title)
    : (getMovieDownload(effectiveTmdbId, tmdbDetails?.title || show?.title) ? [getMovieDownload(effectiveTmdbId, tmdbDetails?.title || show?.title)!] : []);

  // Vérification présence locale (Sonarr / Radarr / Plex)
  const presence = useMediaPresence({
    tmdbId: effectiveTmdbId,
    tvdbId: tmdbDetails?.external_ids?.tvdb_id || (show as any)?.tvdbId,
    imdbId: tmdbDetails?.external_ids?.imdb_id || (show as any)?.imdbId,
    title: title,
    originalTitle: tmdbDetails?.original_title || tmdbDetails?.original_name || (show as any)?.originalTitle,
    year: releaseYear ? parseInt(releaseYear) : undefined,
    mediaType: isSeries ? 'tv' : 'movie'
  });

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
      if (!event.state || !event.state.isEpisodeDetailModal) {
        setSelectedEpisode(null);
      }
      if (event.state && event.state.isPersonDetailModal && event.state.personId) {
        setSelectedPersonId(event.state.personId);
      } else if (!event.state || !event.state.isPersonDetailModal) {
        setSelectedPersonId(null);
      }
    };
    const handleCloseModals = () => {
      setTrailerModalVideos(null);
    };
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
  const [plexMediaInfo, setPlexMediaInfo] = useState<PlexMediaInfo | null>(null);

  useEffect(() => {
    const handleStorage = () => {
      const saved = localStorage.getItem('user_platforms');
      if (saved) {
        try { setUserPlatforms(JSON.parse(saved)); } catch (e) {}
      }
    };
    handleStorage(); // init
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const uniqueProviders = useMemo(() => {
    if (!providers) return [];
    const allList = [
      ...(providers.flatrate || []),
      ...(providers.ads || []),
      ...(providers.free || [])
    ];
    const uniqueMap = new Map();
    allList.forEach((p: any) => {
      const cleanName = getCleanProviderName(p);
      const key = cleanName.toLowerCase().trim();
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, { ...p, provider_name: cleanName });
      }
    });
    return Array.from(uniqueMap.values());
  }, [providers]);

  const sortedProviders = useMemo(() => {
    const list: any[] = [...uniqueProviders];
    if (plexMediaInfo?.available) {
      list.push({
        provider_id: 999999,
        provider_name: plexMediaInfo.serverName ? `Plex (${plexMediaInfo.serverName})` : 'Plex',
        logo_path: 'PLEX_CUSTOM_SVG',
        isPlex: true,
        serverName: plexMediaInfo.serverName,
        plexUrl: plexMediaInfo.plexUrl || 'https://app.plex.tv/desktop'
      });
    }
    return list.sort((a: any, b: any) => {
      // Les diffuseurs officiels restent prioritaires
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
    setTimeout(() => {
      onBack();
    }, 280);
  };

  const handleTouchStart = (e: React.TouchEvent) => {};
  const handleTouchMove = (e: React.TouchEvent) => {};
  const handleTouchEnd = () => {};

  const handleTabChange = (tab: 'about' | 'episodes' | 'casting') => {
    setActiveTab(tab);
    isManualScrollingRef.current = true;
    setTimeout(() => {
      const el = document.getElementById(`section-${tab}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (tabsAnchorRef.current) {
        tabsAnchorRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      setTimeout(() => {
        isManualScrollingRef.current = false;
      }, 800);
    }, 50);
  };

  const lastLoadedTmdbIdRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!effectiveTmdbId) return;
    if (lastLoadedTmdbIdRef.current === effectiveTmdbId) return;
    lastLoadedTmdbIdRef.current = effectiveTmdbId;

    setTmdbDetails(null);
    setFetchError(false);
    setCollectionData(null);
    setUniverseData(null);
    setCollectionLoading(true);
    setImdbData(null);
    setProviders(null);
    setPlexMediaInfo(null);
    setKeywords([]);
    setSeasonsCache({});
    setExpandedSeason(null);
    setSelectedEpisode(null);
    setShowMenu(false);
    setActiveTab('about');
    setLogoError(false);
    setPosterError(false);

    if (mainScrollRef.current) {
      mainScrollRef.current.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [effectiveTmdbId]);

  useEffect(() => {
    if (!effectiveTmdbId) return;
    
    let isMounted = true;
    const targetMediaType = show?.mediaType || externalMediaType || 'tv';
    
    const fetchDetails = async () => {
      let res = await tmdb.getMediaDetails(effectiveTmdbId, targetMediaType);
      // Fallback si le mediaType passé n'était pas le bon
      if (!res.ok && isMounted) {
        const fallbackType = targetMediaType === 'tv' ? 'movie' : 'tv';
        const fallbackRes = await tmdb.getMediaDetails(effectiveTmdbId, fallbackType);
        if (fallbackRes.ok) {
          res = fallbackRes;
        }
      }

      if (!isMounted) return;

      if (res.ok) {
        setTmdbDetails(res.value);
        setFetchError(false);

        const realMediaType: 'tv' | 'movie' = (res.value.name || res.value.number_of_seasons !== undefined) ? 'tv' : 'movie';
        const realTitle = res.value.title || res.value.name;
        const realOriginal = res.value.original_title || res.value.original_name;
        const realYear = (res.value.release_date || res.value.first_air_date)?.slice(0, 4);
        const realImdbId = res.value.imdb_id || res.value.external_ids?.imdb_id;

        // Fetch / update Plex availability with the verified TMDB details
        checkPlexAvailability({
          tmdbId: effectiveTmdbId,
          imdbId: realImdbId,
          title: realTitle,
          originalTitle: realOriginal,
          year: realYear,
          mediaType: realMediaType,
          forceRefresh: true
        }).then(info => {
          if (isMounted) {
            setPlexMediaInfo(info);
          }
        }).catch(() => {
          if (isMounted) {
            setPlexMediaInfo({ available: false, lastChecked: Date.now() });
          }
        });

        tmdb.getUniverseAndCollection(res.value).then(({ collection, universe }) => {
          if (isMounted) setCollectionLoading(false);
          if (isMounted) {
            if (collection && collection.length > 0) setCollectionData({ parts: collection });
            if (universe && universe.length > 0) setUniverseData({ parts: universe });
          }
        });
      } else {
        setFetchError(true);
        if (isMounted) setCollectionLoading(false);
      }
    };

    fetchDetails();

    tmdb.getWatchProviders(effectiveTmdbId, targetMediaType).then(res => {
      if (res.ok && isMounted) {
         setProviders(res.value.results?.FR || []);
      }
    });

    if (show?.title && show.title !== 'Chargement...') {
      checkPlexAvailability({
        tmdbId: effectiveTmdbId,
        title: show.title,
        originalTitle: (show as any)?.originalTitle || (show as any)?.original_title,
        year: (show?.firstAirDate)?.slice(0, 4),
        mediaType: targetMediaType === 'tv' ? 'tv' : 'movie'
      }).then(info => {
        if (isMounted) {
          setPlexMediaInfo(info);
        }
      }).catch(() => {
        if (isMounted) {
          setPlexMediaInfo({ available: false, lastChecked: Date.now() });
        }
      });
    }

    // Récupération et Nettoyage des thèmes profonds (keywords)
    tmdb.getMediaKeywords(effectiveTmdbId, targetMediaType).then(res => {
      if (res.ok && isMounted) {
        const blacklist = [
          'aftercreditsstinger', 'duringcreditsstinger', 'post-credits scene', 
          'mid-credits scene', '3d', 'imax', 'marvel cinematic universe', 
          'dc extended universe', 'cinematic universe', 'anime'
        ];
        
        const cleanKeywords = res.value.filter((kw: string) => {
          const lowerKw = kw.toLowerCase();
          return !blacklist.some(badWord => lowerKw.includes(badWord)) && kw.length < 25;
        });

        // On garde un maximum de 5 mots-clés qualitatifs
        setKeywords(cleanKeywords.slice(0, 5));
      }
    });

    return () => { isMounted = false; };
  }, [effectiveTmdbId, show?.mediaType, externalMediaType]);

  const resolvedImdbId = useMemo(() => {
    return tmdbDetails?.external_ids?.imdb_id || tmdbDetails?.imdb_id || (show as any)?.imdbId || null;
  }, [tmdbDetails, show]);

  useEffect(() => {
    if (!resolvedImdbId) {
      setImdbData(null);
      setImdbLoading(false);
      return;
    }
    let isMounted = true;
    setImdbLoading(true);
    getSeriesImdbData(resolvedImdbId).then((data) => {
      if (isMounted) {
        setImdbData(data || { rating: 0 });
        setImdbLoading(false);
      }
    }).catch(() => {
      if (isMounted) {
        setImdbData({ rating: 0 });
        setImdbLoading(false);
      }
    });
    return () => { isMounted = false; };
  }, [resolvedImdbId]);

  const initialAutoOpenRef = useRef<boolean>(false);

  useEffect(() => {
    // Réinitialiser l'auto-ouverture si l'identifiant de la série change
    initialAutoOpenRef.current = false;
  }, [effectiveTmdbId]);

  useEffect(() => {
    if (!tmdbDetails || !effectiveTmdbId || initialAutoOpenRef.current) return;

    let targetSeason = initialSeason || getSmartDefaultSeason(show, tmdbDetails);
    
    if (targetSeason) {
      initialAutoOpenRef.current = true;
      setExpandedSeason(targetSeason);
      
      // Auto-open episode if initialEpisode is provided
      if (initialSeason && initialEpisode) {
         setActiveTab('episodes'); // switch to episodes tab
         
         // Fetch season and then set the episode
         if (!seasonsCache[targetSeason]) {
           tmdb.getSeasonDetails(effectiveTmdbId, targetSeason).then(res => {
             if (res.ok) {
               setSeasonsCache(prev => ({ ...prev, [targetSeason]: res.value }));
               const ep = res.value.episodes?.find((x: any) => x.episode_number === initialEpisode);
               if (ep) {
                 setSelectedEpisode({ season: targetSeason, episode: ep });
                 window.history.pushState({ isEpisodeDetailModal: true }, '');
               }
             }
           });
         } else {
           const ep = seasonsCache[targetSeason].episodes?.find((x: any) => x.episode_number === initialEpisode);
           if (ep) {
             setSelectedEpisode({ season: targetSeason, episode: ep });
             window.history.pushState({ isEpisodeDetailModal: true }, '');
           }
         }
      } else {
        // Si les détails de cette saison ne sont pas encore en cache, les charger immédiatement
        if (!seasonsCache[targetSeason]) {
          tmdb.getSeasonDetails(effectiveTmdbId, targetSeason).then(res => {
            if (res.ok) {
              setSeasonsCache(prev => ({ ...prev, [targetSeason]: res.value }));
            }
          });
        }
      }
    }
  }, [tmdbDetails, show, effectiveTmdbId, initialSeason, initialEpisode]);

  // Handle updates to initialSeason and initialEpisode independently from initialAutoOpenRef
  useEffect(() => {
    if (initialSeason && initialEpisode && effectiveTmdbId) {
       setActiveTab('episodes');
       setExpandedSeason(initialSeason);
       
       const tryOpenEpisode = (seasonData: any) => {
         const ep = seasonData?.episodes?.find((x: any) => x.episode_number === initialEpisode);
         if (ep) {
           setSelectedEpisode({ season: initialSeason, episode: ep });
           // Only push state if not already open to avoid history spam
           if (!window.history.state?.isEpisodeDetailModal) {
             window.history.pushState({ isEpisodeDetailModal: true }, '');
           }
         }
       };

       if (!seasonsCache[initialSeason]) {
         tmdb.getSeasonDetails(effectiveTmdbId, initialSeason).then(res => {
           if (res.ok) {
             setSeasonsCache(prev => ({ ...prev, [initialSeason]: res.value }));
             tryOpenEpisode(res.value);
           }
         });
       } else {
         tryOpenEpisode(seasonsCache[initialSeason]);
       }
    }
  }, [initialSeason, initialEpisode, effectiveTmdbId]);

  const seasonObserverRef = useRef<HTMLDivElement>(null);
  const similarObserverRef = useRef<HTMLDivElement>(null);
  const castObserverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setVisibleSeasons(prev => prev + 5);
      }
    }, { rootMargin: '100px' });
    if (seasonObserverRef.current) observer.observe(seasonObserverRef.current);
    return () => observer.disconnect();
  }, [activeTab]);

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setVisibleSimilar(prev => prev + 10);
      }
    }, { rootMargin: '100px' });
    if (similarObserverRef.current) observer.observe(similarObserverRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setVisibleCast(prev => prev + 12);
      }
    }, { rootMargin: '100px' });
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

    const observerOptions = {
      root: mainScrollRef.current,
      rootMargin: '-20% 0px -60% 0px',
      threshold: 0
    };

    const observer = new IntersectionObserver((entries) => {
      if (isManualScrollingRef.current) return;

      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const sectionName = sections.find(s => s.id === entry.target.id)?.name;
          if (sectionName) {
            setActiveTab(sectionName as any);
          }
        }
      });
    }, observerOptions);

    sections.forEach(s => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [tmdbDetails, isSeries]);

  const loadSeason = async (seasonNumber: number) => {
    if (expandedSeason === seasonNumber) {
      setExpandedSeason(null);
      return;
    }
    
    setExpandedSeason(seasonNumber);
    if (!effectiveTmdbId || seasonsCache[seasonNumber]) return;

    const res = await tmdb.getSeasonDetails(effectiveTmdbId, seasonNumber);
    if (res.ok) {
      setSeasonsCache(prev => ({ ...prev, [seasonNumber]: res.value }));
    }
  };

  const handleAddOrRemoveShow = async () => {
    if (show?.id) {
      if (show.status === 'dropped') {
        const savedShow = { ...show };
        await updateShow(show.id, { status: 'watching', updatedAt: Date.now() });
        showToast(`« ${show.title} » ajoutée à votre suivi`, 'follow', savedShow, async () => {
          if (savedShow.id) {
            await updateShow(savedShow.id, { status: 'dropped', updatedAt: Date.now() });
          }
        });
      } else {
        await handleDeleteShow();
      }
    } else {
      if (!effectiveTmdbId) return;
      const titleToUse = tmdbDetails?.name || tmdbDetails?.title || 'Chargement...';
      const posterToUse = tmdbDetails?.poster_path ? `https://image.tmdb.org/t/p/w342${tmdbDetails.poster_path}` : undefined;
      const backdropToUse = tmdbDetails?.backdrop_path ? `https://image.tmdb.org/t/p/w780${tmdbDetails.backdrop_path}` : undefined;
      const mediaType: 'tv' | 'movie' = tmdbDetails?.number_of_seasons ? 'tv' : 'movie';
      
      const newShowData = {
        tmdbId: effectiveTmdbId,
        title: titleToUse,
        mediaType,
        status: 'watching' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        posterPath: posterToUse,
        backdropPath: backdropToUse,
        firstAirDate: tmdbDetails?.first_air_date || tmdbDetails?.release_date,
        networks: tmdbDetails?.networks,
        seenEpisodes: [],
        episodeRecords: {},
        isArchived: false,
      };
      const newId = await addShow(newShowData);
      const savedShow = { ...newShowData, id: newId, userId: '' };
      showToast(
        `« ${titleToUse} » ajoutée à votre suivi`,
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

  const toggleEpisodeSeen = async (e: React.MouseEvent, season: number, episode: number) => {
    e.stopPropagation();
    
    let currentShow = show;
    if (!currentShow || !currentShow.id) {
      if (!effectiveTmdbId) return;
      const titleToUse = tmdbDetails?.name || tmdbDetails?.title || 'Chargement...';
      const posterToUse = tmdbDetails?.poster_path ? `https://image.tmdb.org/t/p/w342${tmdbDetails.poster_path}` : undefined;
      const backdropToUse = tmdbDetails?.backdrop_path ? `https://image.tmdb.org/t/p/w780${tmdbDetails.backdrop_path}` : undefined;
      const mediaType = tmdbDetails?.number_of_seasons ? 'tv' : 'movie';
      
      const newShowData = {
        tmdbId: effectiveTmdbId,
        title: titleToUse,
        mediaType: mediaType as 'tv' | 'movie',
        status: 'watching' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        posterPath: posterToUse || null,
        backdropPath: backdropToUse || null,
        firstAirDate: tmdbDetails?.first_air_date || tmdbDetails?.release_date,
        networks: tmdbDetails?.networks,
        seenEpisodes: [],
        episodeRecords: {},
        isArchived: false,
      };
      const newId = await addShow(newShowData);
      currentShow = { ...newShowData, id: newId, userId: '' };
    }
    
    if (!currentShow || !currentShow.id) return;
    
    const epKey = `${season}x${episode}`;
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
      const epObj = seasonsCache[season]?.episodes?.find((x: any) => x.episode_number === episode);
      newRecords[epKey] = { 
        watchedAt: Date.now(),
        episodeTitle: epObj?.name || null
      };
    }

    const computeOptimisticNextEp = async (seenSet: Set<string>) => {
      const allSeasons = tmdbDetails?.seasons?.filter((s: any) => s.season_number > 0)?.sort((a: any, b: any) => a.season_number - b.season_number) || [];
      for (const s of allSeasons) {
        const epCount = s.episode_count || 0;
        for (let ep = 1; ep <= epCount; ep++) {
          if (!seenSet.has(`${s.season_number}x${ep}`)) {
            let seasonData = seasonsCache[s.season_number];
            if ((!seasonData || !seasonData.episodes) && effectiveTmdbId) {
              const res = await tmdb.getSeasonDetails(effectiveTmdbId, s.season_number);
              if (res.ok && res.value) {
                seasonData = res.value;
                setSeasonsCache(prev => ({ ...prev, [s.season_number]: res.value }));
              }
            }
            const cachedEp = seasonData?.episodes?.find((x: any) => x.episode_number === ep);
            return {
              season_number: s.season_number,
              episode_number: ep,
              air_date: cachedEp?.air_date || null,
              name: cachedEp?.name || null,
              still_path: cachedEp?.still_path || null
            };
          }
        }
      }
      return null;
    };

    const optimisticNextEp = await computeOptimisticNextEp(newSeen);
    
    const isEnded = tmdbDetails?.status === 'Ended' || tmdbDetails?.status === 'Canceled' || currentShow.seriesEnded || currentShow.tmdbStatus === 'Ended' || currentShow.tmdbStatus === 'Canceled';
    const autoArchived = computeAutoArchiveStatus({
      ...currentShow,
      seenEpisodes: Array.from(newSeen as Set<string>),
      tmdbStatus: tmdbDetails?.status || currentShow.tmdbStatus,
      seriesEnded: isEnded,
      nextEpisodeToWatch: optimisticNextEp
    });

    let calculatedLastWatchedAt = Date.now();
    if (!newSeen.has(epKey)) {
      let maxRemaining = 0;
      for (const ep of newSeen) {        const t = newRecords[ep]?.watchedAt;
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
        isArchived: autoArchived,
        status: optimisticNextEp ? 'watching' : 'completed'
    });
    syncSingleItem(currentShow.id, true).catch(console.error);
    scrollAllCarouselsToStart();

    const epObj = seasonsCache[season]?.episodes?.find((x: any) => x.episode_number === episode);
    const sNumStr = String(season).padStart(2, '0');
    const eNumStr = String(episode).padStart(2, '0');
    const showTitleStr = currentShow.title || tmdbDetails?.name || tmdbDetails?.title || 'Série';

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
      
      const newShowData = {
        tmdbId: effectiveTmdbId,
        title: titleToUse,
        mediaType: mediaType as 'tv' | 'movie',
        status: 'watching' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        posterPath: posterToUse || null,
        backdropPath: backdropToUse || null,
        firstAirDate: tmdbDetails?.first_air_date || tmdbDetails?.release_date,
        networks: tmdbDetails?.networks,
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

    let seasonData = seasonsCache[seasonNumber];
    if (!seasonData && effectiveTmdbId) {
      const res = await tmdb.getSeasonDetails(effectiveTmdbId, seasonNumber);
      if (res.ok) {
        seasonData = res.value;
        setSeasonsCache(prev => ({ ...prev, [seasonNumber]: seasonData }));
      }
    }

    let epKeys: string[] = [];
    if (seasonData?.episodes) {
      epKeys = seasonData.episodes
        .filter((ep: any) => !ep.air_date || new Date(ep.air_date).getTime() <= Date.now())
        .map((ep: any) => `${seasonNumber}x${ep.episode_number}`);
    } else {
      for (let i = 1; i <= expectedEpCount; i++) {
        epKeys.push(`${seasonNumber}x${i}`);
      }
    }

    const existingSeen = new Set(prevSeenEpisodes);
    const existingRecords = { ...prevEpisodeRecords };

    const allSeen = epKeys.length > 0 && epKeys.every(k => existingSeen.has(k));
    const now = Date.now();

    if (allSeen) {
      epKeys.forEach(k => {
        existingSeen.delete(k);
        delete existingRecords[k];
      });
    } else {
      epKeys.forEach(k => {
        existingSeen.add(k);
        existingRecords[k] = { watchedAt: now };
      });
    }

    const computeOptimisticNextEp = async (seenSet: Set<string>) => {
      const allSeasons = tmdbDetails?.seasons?.filter((s: any) => s.season_number > 0)?.sort((a: any, b: any) => a.season_number - b.season_number) || [];
      for (const s of allSeasons) {
        const epCount = s.episode_count || 0;
        for (let ep = 1; ep <= epCount; ep++) {
          if (!seenSet.has(`${s.season_number}x${ep}`)) {
            let seasonData = seasonsCache[s.season_number];
            if ((!seasonData || !seasonData.episodes) && effectiveTmdbId) {
              const res = await tmdb.getSeasonDetails(effectiveTmdbId, s.season_number);
              if (res.ok && res.value) {
                seasonData = res.value;
                setSeasonsCache(prev => ({ ...prev, [s.season_number]: res.value }));
              }
            }
            const cachedEp = seasonData?.episodes?.find((x: any) => x.episode_number === ep);
            return {
              season_number: s.season_number,
              episode_number: ep,
              air_date: cachedEp?.air_date || null,
              name: cachedEp?.name || null,
              still_path: cachedEp?.still_path || null
            };
          }
        }
      }
      return null;
    };

    const optimisticNextEp = await computeOptimisticNextEp(existingSeen);

    const isEnded = tmdbDetails?.status === 'Ended' || tmdbDetails?.status === 'Canceled' || currentShow.seriesEnded || currentShow.tmdbStatus === 'Ended' || currentShow.tmdbStatus === 'Canceled';
    const autoArchived = computeAutoArchiveStatus({
      ...currentShow,
      seenEpisodes: Array.from(existingSeen as Set<string>),
      tmdbStatus: tmdbDetails?.status || currentShow.tmdbStatus,
      seriesEnded: isEnded,
      nextEpisodeToWatch: optimisticNextEp
    });

    await updateShow(currentShow.id, {
      seenEpisodes: Array.from(existingSeen as Set<string>),
      episodeRecords: existingRecords,
      lastWatchedAt: allSeen ? (currentShow.lastWatchedAt || now) : now,
      updatedAt: now,
      isSynced: false,
      nextEpisodeToWatch: optimisticNextEp,
      isArchived: autoArchived,
      status: optimisticNextEp ? 'watching' : 'completed'
    });
    syncSingleItem(currentShow.id, true).catch(console.error);

    const showTitleStr = currentShow.title || tmdbDetails?.name || tmdbDetails?.title || 'Série';
    if (allSeen) {
      showToast(
        `« ${showTitleStr} » Saison ${seasonNumber} marquée comme non vue`,
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
          }
        }
      );
    } else {
      showToast(
        `« ${showTitleStr} » Saison ${seasonNumber} marquée comme vue !`,
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
          }
        }
      );
    }
  };

  const toggleArchive = async () => {
    if (!show?.id) return;
    const now = Date.now();
    const newArchived = !show.isArchived;
    const savedShow = { ...show };
    await updateShow(show.id, { 
      isArchived: newArchived,
      updatedAt: now
    });
    if (newArchived) {
      showToast(
        `« ${show.title} » a été déplacée dans vos archives.`, 
        'archive', 
        show,
        async () => {
          if (savedShow.id) {
            await updateShow(savedShow.id, { isArchived: false, updatedAt: Date.now() });
          }
        }
      );
    }
  };

  const followShow = handleAddOrRemoveShow;

  const resumeShow = async () => {
    if (!show?.id) return;
    await updateShow(show.id, {
      status: 'watching',
      updatedAt: Date.now()
    });
  };

  const rewatchShow = async () => {
    if (!show?.id) return;
    const now = Date.now();

    await updateShow(show.id, {
      seenEpisodes: [],
      episodeRecords: {},
      status: 'watching',
      isArchived: false,
      lastWatchedAt: now,
      nextEpisodeToWatch: {
        season_number: 1,
        episode_number: 1,
        air_date: null,
        name: null
      },
      updatedAt: now
    });

    setExpandedSeason(1);
    showToast(`« ${show.title} » réinitialisée : reprise à la saison 1 !`, 'success');
  };

  const dropShow = async () => {
    if (!show?.id) return;
    const previousStatus = show.status || 'watching';
    const savedShow = { ...show };
    await updateShow(show.id, {
      status: 'dropped',
      updatedAt: Date.now()
    });
    showToast(
      `« ${show.title} » marquée comme abandonnée.`,
      'dropped',
      show,
      async () => {
        if (savedShow.id) {
          await updateShow(savedShow.id, { status: previousStatus, updatedAt: Date.now() });
        }
      }
    );
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
      showToast(
        `« ${targetShow.title} » a été supprimée de votre suivi.`,
        'unfollow',
        targetShow,
        async () => {
          if (auth.currentUser && savedShow.id) {
            const docRef = doc(db, 'users', auth.currentUser.uid, 'shows', savedShow.id);
            useShowsStore.getState().addShowOptimistic(savedShow);
            await setDoc(docRef, savedShow);
          }
        }
      );
      return;
    }

    const newStatus = targetShow.status === 'dropped' ? 'watching' : 'dropped';
    await updateShow(targetShow.id, { 
      status: newStatus,
      updatedAt: now
    });

    if (newStatus === 'dropped') {
      showToast(
        `« ${targetShow.title} » marquée comme abandonnée.`,
        'dropped',
        targetShow,
        async () => {
          if (savedShow.id) {
            await updateShow(savedShow.id, { status: previousStatus, updatedAt: Date.now() });
          }
        }
      );
    }
  };

  const handleDeleteShow = async () => {
    const targetShow = show || lastKnownShowRef.current;
    if (!targetShow?.id) return;
    const savedShow = { ...targetShow };
    
    // Déclenche immédiatement l'animation de sortie fluide
    handleAnimatedBack();

    try {
      await deleteShow(targetShow.id);
      showToast(
        `« ${targetShow.title} » a été supprimée de votre suivi.`,
        'unfollow',
        targetShow,
        async () => {
          if (auth.currentUser && savedShow.id) {
            const docRef = doc(db, 'users', auth.currentUser.uid, 'shows', savedShow.id);
            useShowsStore.getState().addShowOptimistic(savedShow);
            await setDoc(docRef, savedShow);
          }
        }
      );
    } catch (err) {
      console.error("Delete error:", err);
    }
  };

  const rateShow = async (rating: number) => {
    if (!show?.id) return;
    await updateShow(show.id, {
      userRating: rating,
      updatedAt: Date.now()
    });
  };

  const togglePlanToWatchMovie = async () => {
    let currentShow = show;
    if (!currentShow || !currentShow.id) {
      if (!effectiveTmdbId) return;
      const titleToUse = tmdbDetails?.name || tmdbDetails?.title || 'Chargement...';
      const posterToUse = tmdbDetails?.poster_path ? `https://image.tmdb.org/t/p/w342${tmdbDetails.poster_path}` : undefined;
      const backdropToUse = tmdbDetails?.backdrop_path ? `https://image.tmdb.org/t/p/w780${tmdbDetails.backdrop_path}` : undefined;
      
      const newShowData = {
        tmdbId: effectiveTmdbId,
        title: titleToUse,
        mediaType: 'movie' as const,
        status: 'plan_to_watch' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        posterPath: posterToUse || null,
        backdropPath: backdropToUse || null,
        firstAirDate: tmdbDetails?.first_air_date || tmdbDetails?.release_date,
        networks: tmdbDetails?.networks,
        seenEpisodes: [],
        episodeRecords: {},
        isArchived: false,
        isFavorite: false,
      };
      const newId = await addShow(newShowData);
      const savedShow = { ...newShowData, id: newId, userId: '' };
      showToast(
        `« ${titleToUse} » ajouté à vos films à voir`,
        'follow',
        savedShow,
        async () => {
          if (newId) {
            await deleteShow(newId);
          }
        }
      );
      return;
    }

    const isAlreadyPlanToWatch = currentShow.status === 'plan_to_watch' || (!hasSeenMedia && currentShow.status !== 'dropped');
    
    if (isAlreadyPlanToWatch) {
      const savedShow = { ...currentShow };
      await deleteShow(currentShow.id);
      showToast(
        `« ${currentShow.title} » retiré de votre suivi.`,
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
      const savedShow = { ...currentShow };
      await updateShow(currentShow.id, {
        status: 'plan_to_watch',
        seenEpisodes: [],
        isFavorite: false,
        updatedAt: Date.now(),
        isSynced: false,
      });
      showToast(
        `« ${currentShow.title} » ajouté à vos films à voir`,
        'follow',
        savedShow,
        async () => {
          if (savedShow.id) {
            await updateShow(savedShow.id, {
              status: savedShow.status,
              seenEpisodes: savedShow.seenEpisodes,
              isFavorite: savedShow.isFavorite,
              updatedAt: Date.now()
            });
          }
        }
      );
    }
  };

  const toggleMovieSeen = async () => {
    let currentShow = show;
    if (!currentShow || !currentShow.id) {
      if (!effectiveTmdbId) return;
      const titleToUse = tmdbDetails?.name || tmdbDetails?.title || 'Chargement...';
      const posterToUse = tmdbDetails?.poster_path ? `https://image.tmdb.org/t/p/w342${tmdbDetails.poster_path}` : undefined;
      const backdropToUse = tmdbDetails?.backdrop_path ? `https://image.tmdb.org/t/p/w780${tmdbDetails.backdrop_path}` : undefined;
      
      const newShowData = {
        tmdbId: effectiveTmdbId,
        title: titleToUse,
        mediaType: 'movie' as const,
        status: 'completed' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        posterPath: posterToUse || null,
        backdropPath: backdropToUse || null,
        firstAirDate: tmdbDetails?.first_air_date || tmdbDetails?.release_date,
        networks: tmdbDetails?.networks,
        seenEpisodes: ['movie'],
        episodeRecords: { movie: { watchedAt: Date.now() } },
        isArchived: false,
        isFavorite: false,
      };
      const newId = await addShow(newShowData);
      const savedShow = { ...newShowData, id: newId, userId: '' };
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
      return;
    }

    const savedShow = { ...currentShow };
    const seen = currentShow.seenEpisodes?.includes('movie') || currentShow.status === 'completed';
    const newSeen = seen ? [] : ['movie'];
    const newStatus = seen ? 'plan_to_watch' : 'completed';
    const newRecords = { ...(currentShow.episodeRecords || {}) };
    if (!seen) {
      newRecords['movie'] = {
        watchedAt: Date.now(),
        episodeTitle: currentShow.title || 'Film'
      };
    } else {
      delete newRecords['movie'];
    }
    
    await updateShow(currentShow.id, {
      seenEpisodes: newSeen,
      episodeRecords: newRecords,
      status: newStatus,
      isFavorite: seen ? false : currentShow.isFavorite,
      lastWatchedAt: seen ? null : Date.now(),
      updatedAt: Date.now(),
      isSynced: false,
    });

    if (seen) {
      showToast(
        `« ${currentShow.title} » marqué comme non vu`,
        'info',
        savedShow,
        async () => {
          if (savedShow.id) {
            await updateShow(savedShow.id, {
              seenEpisodes: savedShow.seenEpisodes || ['movie'],
              status: savedShow.status,
              isFavorite: savedShow.isFavorite,
              updatedAt: Date.now()
            });
          }
        }
      );
    } else {
      showToast(
        `« ${currentShow.title} » marqué comme vu !`,
        'success',
        savedShow,
        async () => {
          if (savedShow.id) {
            await updateShow(savedShow.id, {
              seenEpisodes: savedShow.seenEpisodes || [],
              status: savedShow.status,
              isFavorite: savedShow.isFavorite,
              updatedAt: Date.now()
            });
          }
        }
      );
    }
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

      const newShowData: Omit<Show, 'id' | 'userId'> = {
        tmdbId: effectiveTmdbId,
        title: titleToUse,
        mediaType: isSeriesItem ? 'tv' : 'movie',
        status: 'watching',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        posterPath: posterToUse ? (posterToUse.startsWith('http') ? posterToUse : `https://image.tmdb.org/t/p/w500${posterToUse}`) : null,
        backdropPath: backdropToUse ? (backdropToUse.startsWith('http') ? backdropToUse : `https://image.tmdb.org/t/p/w1280${backdropToUse}`) : null,
        firstAirDate: tmdbDetails?.first_air_date || tmdbDetails?.release_date,
        networks: tmdbDetails?.networks,
        seenEpisodes: [],
        episodeRecords: {},
        isArchived: false,
        isFavorite: newFav,
        notificationsEnabled: newFav ? true : undefined,
      };
      const newId = await addShow(newShowData);
      showToast(newFav ? `« ${titleToUse} » ${isSeries ? 'ajoutée' : 'ajouté'} aux favoris • Notifications activées 🔔` : `« ${titleToUse} » ${isSeries ? 'retirée' : 'retiré'} des favoris`, 'favorite', currentShow);
      return;
    }

    if (currentShow.id) {
      await updateShow(currentShow.id, {
        isFavorite: newFav,
        ...(newFav ? { notificationsEnabled: true } : {}),
        updatedAt: Date.now(),
      });
      showToast(newFav ? `« ${currentShow.title} » ${isSeries ? 'ajoutée' : 'ajouté'} aux favoris • Notifications activées 🔔` : `« ${currentShow.title} » ${isSeries ? 'retirée' : 'retiré'} des favoris`, 'favorite', currentShow);
    }
  };

  const handleShare = async () => {
    const titleText = title || tmdbDetails?.name || tmdbDetails?.title || (isSeries ? 'Série' : 'Film');
    const shareData = {
      title: titleText,
      text: `Découvre ${titleText} !`,
      url: window.location.href,
    };
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (e) {
        // User cancelled or share failed
      }
    } else {
      try {
        await navigator.clipboard.writeText(window.location.href);
        showToast('Lien copié dans le presse-papier !', 'info', show || undefined);
      } catch (e) {
        showToast('Impossible de copier le lien', 'info', show || undefined);
      }
    }
  };

  if (!show && !tmdbDetails) {
    if (!effectiveTmdbId || fetchError) {
      return (
        <div className="flex-1 bg-black flex flex-col items-center justify-center p-6 text-center">
          <div className="w-12 h-12 bg-red-500/20 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Média introuvable</h2>
          <p className="text-zinc-400 mb-6">Les détails de ce média n'ont pas pu être chargés.</p>
          <button onClick={onBack} className="px-6 py-2 bg-white/10 hover:bg-white/20 text-white rounded-full font-semibold transition-colors">
            Retour
          </button>
        </div>
      );
    }
    return (
      <div className="flex-1 overflow-y-auto bg-black text-white relative pb-nav w-full h-full animate-in fade-in duration-150">
        {/* Skeleton Hero Header */}
        <div className="relative">
          <div className="absolute top-0 inset-x-0 h-96 bg-zinc-900/60 animate-pulse" />
          <div className="sticky top-0 z-40 pt-10 pb-2 px-4 flex justify-between items-center">
            <button 
              onClick={onBack}
              className="w-10 h-10 bg-black/60 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 text-white"
            >
              <ChevronLeft size={24} />
            </button>
            <div className="w-10 h-10 bg-black/60 rounded-full border border-white/10 animate-pulse" />
          </div>

          <div className="relative z-10 px-4 mt-6">
            <div className="flex gap-4">
              <div className="w-[120px] shrink-0 aspect-[2/3] bg-zinc-800/80 rounded-xl border border-white/10 animate-pulse" />
              <div className="flex-1 min-w-0 flex flex-col justify-end pb-1 gap-2.5">
                <div className="flex gap-2">
                  <div className="h-5 w-24 bg-zinc-800/80 rounded-md animate-pulse" />
                  <div className="h-5 w-16 bg-zinc-800/80 rounded-md animate-pulse" />
                </div>
                <div className="h-8 w-44 bg-zinc-800/80 rounded-lg animate-pulse my-0.5" />
                <div className="h-4 w-32 bg-zinc-800/80 rounded animate-pulse" />
                {/* Rating Badges Skeleton */}
                <div className="flex gap-2 mt-1">
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-zinc-800/80 border border-white/5 rounded-lg animate-pulse w-16 h-6">
                    <span className="text-[#f5c518]/60 font-black text-[9px] bg-black/20 px-1 rounded-sm">IMDb</span>
                  </div>
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-zinc-800/80 border border-white/5 rounded-lg animate-pulse w-16 h-6">
                    <span className="text-[#01b4e4]/60 font-black text-[9px] bg-black/20 px-1 rounded-sm">TMDB</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="h-12 w-full bg-zinc-800/80 rounded-2xl mt-4 animate-pulse" />
          </div>
        </div>

        {/* Skeleton Tabs */}
        <div className="px-4 mt-6">
          <div className="h-10 bg-zinc-900 rounded-full animate-pulse border border-white/5" />
        </div>

        {/* Skeleton Content */}
        <div className="p-4 space-y-6">
          <div className="space-y-2">
            <div className="h-3 w-20 bg-zinc-800 rounded animate-pulse" />
            <div className="h-3.5 bg-zinc-800/80 rounded w-full animate-pulse" />
            <div className="h-3.5 bg-zinc-800/80 rounded w-11/12 animate-pulse" />
            <div className="h-3.5 bg-zinc-800/80 rounded w-4/5 animate-pulse" />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-24 bg-zinc-800 rounded animate-pulse" />
            <div className="flex gap-2">
              <div className="h-8 w-28 bg-zinc-800/80 rounded-xl border border-white/5 animate-pulse" />
              <div className="h-8 w-24 bg-zinc-800/80 rounded-xl border border-white/5 animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const hasSeenMedia = isSeries 
      ? (show?.seenEpisodes && show.seenEpisodes.length > 0)
      : (show?.seenEpisodes?.includes('movie') || show?.status === 'completed');

  const isUpToDate = isSeries && show ? checkIsUpToDate(show) : false;

  const fallbackNextEp = isSeries && (!hasSeenMedia)
    ? { season_number: 1, episode_number: 1, name: 'Épisode 1' }
    : null;

  const nextEp = isUpToDate
    ? (show?.nextEpisodeToAir || tmdbDetails?.next_episode_to_air || null)
    : (show?.nextEpisodeToWatch || fallbackNextEp || show?.nextEpisodeToAir || tmdbDetails?.next_episode_to_air);

  const handleWatchNextEpisode = () => {
    if (!nextEp) return;
    openEpisodeModal(nextEp.season_number, nextEp);
  };

  const getNextEpisodeStatus = () => {
    if (isUpToDate && !show?.nextEpisodeToAir && !tmdbDetails?.next_episode_to_air) {
      return null;
    }
    if (!nextEp) return null;

    const sNum = nextEp.season_number ?? 1;
    const eNum = nextEp.episode_number ?? 1;
    if (isNaN(Number(sNum)) || isNaN(Number(eNum))) return null;

    const seasonNum = String(sNum).padStart(2, '0');
    const epNum = String(eNum).padStart(2, '0');
    const fullEpCode = `S${seasonNum} | E${epNum}`;

    let airDate = nextEp.air_date;
    if (!airDate && seasonsCache[nextEp.season_number]?.episodes) {
      const cachedEp = seasonsCache[nextEp.season_number].episodes.find((x: any) => x.episode_number === nextEp.episode_number);
      if (cachedEp?.air_date) {
        airDate = cachedEp.air_date;
      }
    }

    const todayStr = getTodayStr();

    // Check if the episode explicitly has a future air date
    if (airDate) {
      const diffDays = getCalendarDaysDiff(airDate);
      if (diffDays > 0) {
        if (diffDays === 1) {
          return { isUpcoming: true, label: `${fullEpCode} demain` };
        }
        if (diffDays <= 7) {
          return { isUpcoming: true, label: `${fullEpCode} dans ${diffDays} jours` };
        }
        return { isUpcoming: true, label: `${fullEpCode} le ${formatAirDateSafe(airDate, 'short')}` };
      }
    } else {
      // If air_date is unknown, check if the show hasn't premiered yet
      if (!hasSeenMedia && tmdbDetails?.first_air_date && tmdbDetails.first_air_date > todayStr) {
        return { isUpcoming: true, label: `${fullEpCode} bientôt` };
      }
    }

    // Default: episode is available!
    const prefix = hasSeenMedia ? "Reprendre" : "Commencer";
    return { isUpcoming: false, label: `${prefix} • ${fullEpCode}` };
  };

  const epStatus = getNextEpisodeStatus();

  const logoPath = !logoError ? getBestLogoPath(tmdbDetails?.images) : null;
  
  const rawPoster = tmdbDetails?.poster_path || show?.posterPath;
  const posterPath = rawPoster
    ? (rawPoster.startsWith('http') 
        ? rawPoster 
        : `https://image.tmdb.org/t/p/w500${rawPoster.startsWith('/') ? '' : '/'}${rawPoster}`)
    : undefined;

  const rawBackdrop = tmdbDetails?.backdrop_path || show?.backdropPath;
  const backdropUrl = rawBackdrop
    ? (rawBackdrop.startsWith('http')
        ? rawBackdrop
        : `https://image.tmdb.org/t/p/w780${rawBackdrop.startsWith('/') ? '' : '/'}${rawBackdrop}`)
    : posterPath;
  
  const totalEpisodes = tmdbDetails?.number_of_episodes || show?.totalEpisodes || show?.totalAiredEpisodes || 0;
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
  const mainProviderName = mainProvider 
    ? mainProvider.provider_name 
    : (tmdbDetails?.networks?.[0]?.name || (show as any)?.network || (show as any)?.platform);
  const mainProviderLogo = mainProvider
    ? (mainProvider.isPlex ? PLEX_LOGO_SVG : getFormattedProviderLogo(mainProvider.logo_path, mainProvider.provider_name))
    : (tmdbDetails?.networks?.[0]?.logo_path ? getFormattedProviderLogo(tmdbDetails.networks[0].logo_path, tmdbDetails.networks[0].name) : null);
  const mainProviderLink = mainProvider 
    ? (mainProvider.isPlex ? (mainProvider.plexUrl || 'https://app.plex.tv/desktop') : getProviderDirectLink(mainProvider.provider_id, title, watchLink))
    : (watchLink || `https://www.google.com/search?q=${encodeURIComponent(title + ' ' + (mainProviderName || ''))}`);

  const getRatingInfo = () => {
    if (!tmdbDetails) return { label: 'Non classé', colorClass: 'bg-zinc-800/80 border-white/10 text-zinc-400' };

    let raw = '';
    if (isSeries) {
      const results = tmdbDetails.content_ratings?.results || [];
      const fr = results.find((r: any) => r.iso_3166_1 === 'FR');
      if (fr?.rating) {
        raw = fr.rating;
      } else {
        const us = results.find((r: any) => r.iso_3166_1 === 'US');
        if (us?.rating) raw = us.rating;
      }
    } else {
      const results = tmdbDetails.release_dates?.results || [];
      const fr = results.find((r: any) => r.iso_3166_1 === 'FR');
      if (fr?.release_dates) {
        const cert = fr.release_dates.find((d: any) => d.certification && d.certification.trim() !== '');
        if (cert) raw = cert.certification;
      }
      if (!raw) {
        const us = results.find((r: any) => r.iso_3166_1 === 'US');
        if (us?.release_dates) {
          const cert = us.release_dates.find((d: any) => d.certification && d.certification.trim() !== '');
          if (cert) raw = cert.certification;
        }
      }
    }

    const info = formatAgeRating(raw);
    return { label: info.label, colorClass: info.color };
  };

  const ratingInfo = getRatingInfo();
  const mediaTarget = tmdbDetails || show || (effectiveTmdbId ? { id: effectiveTmdbId } : null);


  return (
    <div 
      ref={mainScrollRef} 
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        transform: isExiting ? 'translateX(100%)' : (dragX > 0 ? `translateX(${dragX}px)` : undefined),
      }}
      className={cn(
        "flex-1 overflow-y-auto bg-transparent text-white relative pb-nav w-full h-full",
        isDragging 
          ? "transition-none" 
          : "transition-transform duration-300 ease-out",
        !isExiting && dragX === 0 && "animate-in slide-in-from-right duration-300"
      )}
    >
      {/* Hero Header */}
      <div className="relative">
        <div className="absolute top-0 inset-x-0 h-96 z-0">
          {backdropUrl && (
            <img loading="lazy" decoding="async" 
              src={backdropUrl} 
              alt="Backdrop" 
              className="w-full h-full object-cover opacity-60"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/80 to-transparent" />
        </div>

        {/* Top bar (Back / Menu) */}
        <div className="sticky top-0 z-40 pt-10 pb-2 px-4 flex justify-between items-center bg-gradient-to-b from-black/90 via-black/50 to-transparent">
          <button 
            type="button"
            onPointerUp={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleAnimatedBack();
            }}
            onClick={(e) => {
              e.stopPropagation();
            }}
            className="w-10 h-10 bg-black/60 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 text-white hover:bg-black/80 transition-colors active:scale-95 touch-manipulation cursor-pointer z-50 select-none"
          >
            <ChevronLeft size={24} />
          </button>
          
          <div className="relative z-50">
            <button 
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(!showMenu);
              }}
              className="w-10 h-10 bg-black/60 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 text-white hover:bg-black/80 transition-colors active:scale-95 touch-manipulation cursor-pointer"
            >
              <MoreVertical size={20} />
            </button>
            
            {showMenu && (
              <>
                <div 
                  className="fixed inset-0 z-40 bg-black/20" 
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMenu(false);
                  }} 
                />
                <div className="absolute right-0 top-12 w-56 bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden flex flex-col py-1 animate-in fade-in duration-150">
                  {/* Action Téléchargement */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowMenu(false);
                      setDownloadTargetSeason(undefined);
                      setDownloadTargetEpisode(undefined);
                      setIsDownloadModalOpen(true);
                    }}
                    className="w-full px-4 py-3 text-left text-sm text-blue-400 hover:bg-zinc-800 transition-colors flex items-center gap-3 font-semibold cursor-pointer active:bg-zinc-800"
                  >
                    <Download size={16} className="text-blue-400 shrink-0" />
                    <span>Téléchargement</span>
                  </button>

                  <div className="h-px bg-white/5 my-0.5" />

                  {/* Action Synchroniser */}
                  {show && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowMenu(false);
                        handleSyncSingle();
                      }}
                      disabled={isSyncingSingle}
                      className="w-full px-4 py-3 text-left text-sm text-[#E5A93D] hover:bg-zinc-800 transition-colors flex items-center gap-3 font-semibold cursor-pointer active:bg-zinc-800 disabled:opacity-50"
                    >
                      <RefreshCw size={16} className={cn(isSyncingSingle && "animate-spin")} />
                      <span>Synchroniser {isSeries ? 'la série' : 'le film'}</span>
                    </button>
                  )}

                  {show && (
                    <>
                      <div className="h-px bg-white/5 my-1" />

                      {/* Action Contextuelle selon le Statut */}
                      {show.isArchived ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowMenu(false);
                            if (isSeries) {
                              rewatchShow();
                            } else {
                              toggleMovieSeen();
                            }
                          }}
                          className="w-full px-4 py-3 text-left text-sm text-zinc-300 hover:bg-zinc-800 transition-colors flex items-center gap-3 font-semibold cursor-pointer active:bg-zinc-800"
                        >
                          <RotateCcw size={16} className="text-emerald-400" />
                          <span>{isSeries ? "Revoir la série" : "Revoir le film"}</span>
                        </button>
                      ) : show.status === 'dropped' ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowMenu(false);
                            if (isSeries) {
                              resumeShow();
                            } else {
                              togglePlanToWatchMovie();
                            }
                          }}
                          className="w-full px-4 py-3 text-left text-sm text-zinc-300 hover:bg-zinc-800 transition-colors flex items-center gap-3 font-semibold cursor-pointer active:bg-zinc-800"
                        >
                          <RotateCcw size={16} className="text-emerald-400" />
                          <span>{isSeries ? "Reprendre la série" : "Ajouter à ma liste"}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowMenu(false);
                            if (isSeries) {
                              dropShow();
                            } else {
                              togglePlanToWatchMovie();
                            }
                          }}
                          className="w-full px-4 py-3 text-left text-sm text-zinc-300 hover:bg-zinc-800 transition-colors flex items-center gap-3 font-semibold cursor-pointer active:bg-zinc-800"
                        >
                          <Ban size={16} className="text-amber-400" />
                          <span>{isSeries ? "Abandonner la série" : "Retirer de ma liste"}</span>
                        </button>
                      )}

                      <div className="h-px bg-white/5 my-1" />

                      {/* Action de Suppression */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowMenu(false);
                          handleDeleteShow();
                        }}
                        className="w-full px-4 py-3 text-left text-sm text-red-500 hover:bg-red-500/10 transition-colors flex items-center gap-3 font-semibold cursor-pointer active:bg-zinc-800"
                      >
                        <Trash2 size={16} />
                        <span>{isSeries ? "Supprimer la série" : "Supprimer le film"}</span>
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Poster & Content */}
        <div className="relative z-10 px-4 mt-6">
          <div className="flex gap-4">
            <div className="w-[120px] shrink-0">
              {posterPath && !posterError ? (
                <img loading="lazy" decoding="async"
                   src={posterPath}
                   alt={title}
                   onError={() => setPosterError(true)}
                   className="w-full aspect-[2/3] rounded-xl shadow-2xl border border-white/10 object-cover"
                />
              ) : (
                <div className="w-full aspect-[2/3] rounded-xl bg-zinc-900 border border-white/10 flex flex-col items-center justify-center p-2 text-center shadow-2xl">
                  {isSeries ? <Tv className="w-8 h-8 text-[#E5A93D]/70 mb-1" /> : <Clapperboard className="w-8 h-8 text-[#E5A93D]/70 mb-1" />}
                  <span className="text-[10px] font-bold text-zinc-300 line-clamp-2 leading-tight">{title}</span>
                </div>
              )}
            </div>
            
            <div className="flex-1 min-w-0 flex flex-col justify-end pb-1">
              {/* Type & Age Rating Badges */}
              <div className="mb-2 flex items-center gap-2 flex-wrap min-h-[24px]">
                {!tmdbDetails ? (
                  <>
                    <div className="h-5 w-28 bg-zinc-800/80 rounded-md border border-white/5 animate-pulse" />
                    <div className="h-5 w-16 bg-zinc-800/80 rounded-md border border-white/5 animate-pulse" />
                  </>
                ) : (
                  <>
                    <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-[#E5A93D]/20 text-[10px] font-bold tracking-widest text-[#E5A93D] uppercase rounded-md border border-[#E5A93D]/30">
                      {isSeries ? (
                        <>📺 SÉRIE • {tmdbDetails?.number_of_seasons || '?'} {tmdbDetails?.number_of_seasons === 1 ? 'SAISON' : 'SAISONS'}</>
                      ) : (
                        <>🎬 FILM • {formatRuntime(tmdbDetails?.runtime)}</>
                      )}
                    </span>
                    <span className={cn("inline-flex items-center px-2 py-1 text-[10px] font-bold tracking-wider uppercase rounded-md border shrink-0", ratingInfo.colorClass)}>
                      {ratingInfo.label}
                    </span>
                  </>
                )}
              </div>
              
              {/* Title */}
              <div className="my-2 min-h-[64px] flex items-center">
                {logoPath ? (
                  <img
                    src={`https://image.tmdb.org/t/p/w500${logoPath}`}
                    alt={title}
                    className="h-16 sm:h-20 w-auto max-w-full object-contain object-left filter drop-shadow-[0_4px_12px_rgba(0,0,0,0.9)]"
                    loading="eager"
                    decoding="async"
                    onError={() => setLogoError(true)}
                  />
                ) : title && title !== 'Chargement...' ? (
                  <h1 className="text-xl sm:text-2xl font-extrabold leading-tight drop-shadow-lg text-white line-clamp-2 sm:line-clamp-3">{title}</h1>
                ) : (
                  <div className="h-8 w-48 bg-zinc-800/80 rounded-lg animate-pulse" />
                )}
              </div>
              
              {/* Metadata */}
              {(() => {
                const year = tmdbDetails?.first_air_date?.substring(0, 4) || tmdbDetails?.release_date?.substring(0, 4) || show?.firstAirDate?.substring(0, 4) || '';
                
                const isAtCinema = !isSeries && (isMovieAtCinema(tmdbDetails) || isMovieAtCinema(show));
                const isUpcoming = !isSeries && !isAtCinema && (isMovieUpcoming(tmdbDetails) || isMovieUpcoming(show));

                const rawStatus = isSeries ? (tmdbDetails?.status || show?.status) : null;
                const statusText = rawStatus ? (
                  rawStatus === 'Ended' ? 'Terminée' :
                  rawStatus === 'Canceled' ? 'Annulée' :
                  rawStatus === 'Returning Series' ? 'En cours' :
                  rawStatus === 'In Production' ? 'En production' :
                  rawStatus === 'Post Production' ? 'Post-production' :
                  rawStatus === 'Planned' ? 'Prévue' :
                  rawStatus === 'Pilot' ? 'Pilote' :
                  rawStatus === 'ended' ? 'Terminée' :
                  rawStatus === 'canceled' ? 'Annulée' :
                  rawStatus === 'returning' ? 'En cours' :
                  rawStatus
                ) : null;

                const numberOfSeasons = tmdbDetails?.number_of_seasons || (show as any)?.totalSeasons;

                const hasImdb = imdbData && typeof imdbData.rating === 'number' && imdbData.rating > 0;
                const imdbRating = hasImdb ? imdbData.rating.toFixed(1) : null;

                const hasTmdb = tmdbDetails?.vote_average != null && Number(tmdbDetails.vote_average) > 0;
                const tmdbRating = hasTmdb ? Number(tmdbDetails.vote_average).toFixed(1) : null;

                const isImdbLoading = resolvedImdbId && (imdbLoading || !imdbData);
                const isTmdbLoading = !tmdbDetails;

                return (
                  <div className="flex flex-col gap-2.5 mt-2">
                    {/* LIGNE 1 : INFOS DE BASE (Année, Statut, Saisons) */}
                    {!tmdbDetails && !year ? (
                      <div className="h-4 w-36 bg-zinc-800/80 rounded animate-pulse my-0.5" />
                    ) : (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] sm:text-xs text-zinc-300 font-medium">
                        {(year || (!isSeries && isAtCinema)) && (
                          <span className="flex items-center gap-1.5">
                            {year && (!(!isSeries && isAtCinema)) && <span>{year}</span>}
                            {!isSeries && (
                              isAtCinema ? (
                                <span className="text-[#E5A93D] font-extrabold inline-flex items-center gap-1 bg-[#E5A93D]/10 px-2 py-0.5 rounded border border-[#E5A93D]/30 text-[10px]">
                                  <Ticket size={11} className="text-[#E5A93D]" />
                                  Au cinéma
                                </span>
                              ) : isUpcoming ? (
                                <span className="text-purple-400 font-extrabold inline-flex items-center gap-1 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/30 text-[10px]">
                                  <Calendar size={11} className="text-purple-400" />
                                  À venir
                                </span>
                              ) : null
                            )}
                          </span>
                        )}
                        
                        {year && statusText && <span className="text-zinc-600">•</span>}
                        
                        {statusText && <span>{statusText}</span>}
                        
                        {numberOfSeasons != null && numberOfSeasons > 0 && (
                          <>
                            {(year || statusText) && <span className="text-zinc-600">•</span>}
                            <span>{numberOfSeasons} Saison{numberOfSeasons > 1 ? 's' : ''}</span>
                          </>
                        )}
                      </div>
                    )}

                    {/* LIGNE 2 : BADGES SCORES PREMIUM (Regroupés avec Skeletons) */}
                    <div className="flex flex-wrap items-center gap-2 mt-0.5 min-h-[26px]">
                      {/* Badge IMDb */}
                      {hasImdb ? (
                        <div className="flex items-center gap-1.5 px-2 py-1 bg-white/10 backdrop-blur-md border border-white/10 rounded-lg shadow-sm">
                          <span className="text-[#f5c518] font-black text-[9px] tracking-tight bg-black/20 px-1 rounded-sm">IMDb</span>
                          <span className="text-[11px] font-bold text-white">{imdbRating}</span>
                        </div>
                      ) : isImdbLoading ? (
                        <div className="flex items-center gap-1.5 px-2 py-1 bg-zinc-800/80 border border-white/5 rounded-lg animate-pulse">
                          <span className="text-[#f5c518]/60 font-black text-[9px] tracking-tight bg-black/20 px-1 rounded-sm">IMDb</span>
                          <div className="w-5 h-3 bg-zinc-700/60 rounded-xs" />
                        </div>
                      ) : null}

                      {/* Badge TMDB */}
                      {hasTmdb ? (
                        <div className="flex items-center gap-1.5 px-2 py-1 bg-white/10 backdrop-blur-md border border-white/10 rounded-lg shadow-sm">
                          <span className="text-[#01b4e4] font-black text-[9px] tracking-tight bg-black/20 px-1 rounded-sm">TMDB</span>
                          <span className="text-[11px] font-bold text-white">{tmdbRating}</span>
                        </div>
                      ) : isTmdbLoading ? (
                        <div className="flex items-center gap-1.5 px-2 py-1 bg-zinc-800/80 border border-white/5 rounded-lg animate-pulse">
                          <span className="text-[#01b4e4]/60 font-black text-[9px] tracking-tight bg-black/20 px-1 rounded-sm">TMDB</span>
                          <div className="w-5 h-3 bg-zinc-700/60 rounded-xs" />
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
          
          {/* Progress bar */}
          {(hasSeenMedia || (show && isSeries)) && show?.status !== 'dropped' && (
            <div className="mt-5">
               <div className="flex justify-between text-[10px] font-bold text-zinc-400 mb-1.5 uppercase tracking-wider">
                  <span className="text-white">{progressPercentage}% vu</span>
                  {remainingTimeMinutes > 0 && <span>reste {formatRemainingTime(remainingTimeMinutes)}</span>}
               </div>
               <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  {seenCount > 0 && progressPercentage === 0 && totalEpisodes === 0 ? (
                    <div className="h-full w-full bg-zinc-700/50 animate-pulse rounded-full" />
                  ) : (
                    <div className="h-full bg-emerald-500 rounded-full transition-all duration-500 ease-out" style={{ width: `${progressPercentage}%` }} />
                  )}
               </div>
            </div>
          )}
          
          {/* Action buttons */}
          <div className="flex flex-col w-full mt-4 gap-2">
            {/* BOUTONS D'ACTION DYNAMIQUE */}
            <div className="flex items-center gap-3 w-full">
              {isSeries ? (
                !show ? (
                  <button
                    onClick={followShow}
                    className="flex-1 py-3.5 px-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all bg-[#E5A93D] text-black hover:bg-[#d49935] active:scale-95 shadow-lg shadow-[#E5A93D]/20 touch-manipulation cursor-pointer"
                  >
                    <Plus size={18} />
                    <span>Suivre la série</span>
                  </button>
                ) : show.status === 'dropped' ? (
                  <button
                    onClick={resumeShow}
                    className="flex-1 py-3.5 px-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all bg-[#E5A93D] text-black hover:bg-[#d49935] active:scale-95 shadow-lg shadow-[#E5A93D]/20 touch-manipulation cursor-pointer"
                  >
                    <RotateCcw size={18} />
                    <span>Reprendre la série</span>
                  </button>
                ) : show.isArchived ? (
                  <button
                    onClick={rewatchShow}
                    className="flex-1 py-3.5 px-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all bg-[#E5A93D]/20 text-[#E5A93D] border border-[#E5A93D]/30 hover:bg-[#E5A93D]/30 active:scale-95 touch-manipulation cursor-pointer"
                  >
                    <RotateCcw size={18} />
                    <span>Revoir la série</span>
                  </button>
                ) : epStatus ? (
                  epStatus.isUpcoming ? (
                    /* ÉPISODE OU SAISON NON ENCORE SORTI(E) - CLIQUABLE POUR VOIR LE SYNOPSIS ET LES DÉTAILS */
                    <button
                      onClick={handleWatchNextEpisode}
                      className="flex-1 py-3.5 px-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all bg-zinc-800/80 text-zinc-300 border border-zinc-700/80 hover:bg-zinc-700 hover:text-white active:scale-95 touch-manipulation cursor-pointer"
                      title="Ouvrir les détails et le synopsis de cet épisode"
                    >
                      <Calendar size={18} className="text-amber-400" />
                      <span>{epStatus.label}</span>
                    </button>
                  ) : (
                    /* ÉPISODE DISPONIBLE À LA LECTURE */
                    <button
                      onClick={handleWatchNextEpisode}
                      className="flex-1 py-3.5 px-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all bg-[#E5A93D] text-black hover:bg-[#d49935] active:scale-95 shadow-lg shadow-[#E5A93D]/20 touch-manipulation cursor-pointer"
                    >
                      <CheckCircle2 size={18} />
                      <span>{epStatus.label}</span>
                    </button>
                  )
                ) : (
                  /* À JOUR SUR LA DIFFUSION */
                  <div className="flex-1 py-3.5 px-4 rounded-2xl font-bold flex items-center justify-center gap-2 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 select-none">
                    <CheckCircle2 size={18} />
                    <span>À jour sur la diffusion</span>
                  </div>
                )
              ) : (
                !show ? (
                  <button
                    type="button"
                    onClick={togglePlanToWatchMovie}
                    className="flex-1 py-3.5 px-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all bg-[#E5A93D] text-black hover:bg-[#d49935] active:scale-95 shadow-lg shadow-[#E5A93D]/20 touch-manipulation cursor-pointer"
                  >
                    <Plus size={18} />
                    <span>Ajouter aux films à voir</span>
                  </button>
                ) : !hasSeenMedia ? (
                  <button
                    type="button"
                    onClick={toggleMovieSeen}
                    className="flex-1 py-3.5 px-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all bg-[#E5A93D] text-black hover:bg-[#d49935] active:scale-95 shadow-lg shadow-[#E5A93D]/20 touch-manipulation cursor-pointer"
                  >
                    <Check size={18} />
                    <span>Marquer comme vu</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={toggleMovieSeen}
                    className="flex-1 py-3.5 px-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 active:scale-95 touch-manipulation cursor-pointer"
                  >
                    <CheckCircle2 size={18} />
                    <span>Film vu</span>
                  </button>
                )
              )}

              {/* Boutons annexes Favoris & Bande-annonce & Téléchargement */}
              {hasTrailer && (
                <button
                  onClick={() => setTrailerModalVideos(ytVideos)}
                  className="w-12 h-12 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-center justify-center text-amber-400 hover:text-amber-300 hover:bg-amber-500/20 hover:border-amber-400/50 hover:shadow-[0_0_20px_rgba(245,158,11,0.25)] shrink-0 active:scale-95 transition-all cursor-pointer backdrop-blur-md"
                  title="Voir la bande-annonce"
                >
                  <Clapperboard size={20} className="stroke-[2]" />
                </button>
              )}
              {!isSeries && (
                <button
                  type="button"
                  onClick={() => {
                    setDownloadTargetSeason(undefined);
                    setDownloadTargetEpisode(undefined);
                    setIsDownloadModalOpen(true);
                  }}
                  className="w-12 h-12 bg-blue-500/15 border border-blue-500/40 rounded-2xl flex items-center justify-center text-blue-400 hover:text-blue-300 hover:bg-blue-500/25 hover:border-blue-400/60 hover:shadow-[0_0_20px_rgba(59,130,246,0.25)] shrink-0 active:scale-95 transition-all cursor-pointer backdrop-blur-md"
                  title="Télécharger le film (1080p / 4K)"
                >
                  <Download size={20} className="stroke-[2.2]" />
                </button>
              )}
              {hasSeenMedia && (
                <button 
                  type="button"
                  onClick={toggleFavorite}
                  className={cn(
                    "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 active:scale-95 transition-all cursor-pointer border",
                    show?.isFavorite 
                      ? "bg-rose-500/20 border-rose-500/40 text-rose-500" 
                      : "bg-zinc-900 border-white/10 text-zinc-400 hover:text-white"
                  )}
                  title={show?.isFavorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                >
                  <Heart size={20} className={cn(show?.isFavorite && "fill-rose-500 text-rose-500")} />
                </button>
              )}
            </div>
          </div>

          {/* Bandeau de téléchargement en direct (Sonarr/Radarr/qBittorrent) */}
          {activeDownloads.length > 0 && (
            <div className="mt-4 px-1">
              <LiveDownloadBanner items={activeDownloads} />
            </div>
          )}
        </div>
      </div>
      
      {/* Tabs Menu */}
      <div ref={tabsRef} className="px-4 mt-6 sticky top-0 z-20 bg-black/90 backdrop-blur-xl pt-2 pb-2">
        <div className="flex gap-1 bg-zinc-900 p-1 rounded-full border border-white/5">
          <button 
            onClick={() => handleTabChange('about')}
            className={cn(
              "flex-1 py-2 text-xs font-bold tracking-wider uppercase transition-all rounded-full touch-manipulation",
              activeTab === 'about' ? "bg-zinc-800 text-[#E5A93D] shadow-lg" : "text-zinc-500"
            )}
          >
            À propos
          </button>
          {isSeries && (
            <button 
              onClick={() => {
                handleTabChange('episodes');
                if (expandedSeason === null) {
                  const targetSeason = getSmartDefaultSeason(show, tmdbDetails);
                  loadSeason(targetSeason);
                }
              }}
              className={cn(
                "flex-1 py-2 text-xs font-bold tracking-wider uppercase transition-all rounded-full touch-manipulation",
                activeTab === 'episodes' ? "bg-zinc-800 text-[#E5A93D] shadow-lg" : "text-zinc-500"
              )}
            >
              Épisodes
            </button>
          )}
          {((tmdbDetails?.aggregate_credits?.cast || tmdbDetails?.credits?.cast)?.length > 0) && (
            <button 
              onClick={() => {
                handleTabChange('casting');
                setShowAllCast(false);
              }}
              className={cn(
                "flex-1 py-2 text-xs font-bold tracking-wider uppercase transition-all rounded-full touch-manipulation",
                activeTab === 'casting' ? "bg-zinc-800 text-[#E5A93D] shadow-lg" : "text-zinc-500"
              )}
            >
              Casting
            </button>
          )}
        </div>
      </div>

      <div className="p-4 min-h-[400px] pb-6">
        <div id="section-about" className="scroll-mt-40 space-y-6 animate-in fade-in duration-200">
            {/* Synopsis dans À Propos */}
            <div>
              <h3 className="text-xs font-bold uppercase text-zinc-500 tracking-wider mb-3">Synopsis</h3>
              {tmdbDetails?.overview ? (
                <div>
                  <p
                    onClick={() => setIsSynopsisExpanded(!isSynopsisExpanded)}
                    className={cn(
                      "text-[13px] text-zinc-300 leading-relaxed cursor-pointer transition-all duration-300 ease-in-out",
                      !isSynopsisExpanded && "line-clamp-3"
                    )}
                  >
                    {tmdbDetails.overview}
                  </p>
                  {!isSynopsisExpanded && tmdbDetails.overview.length > 120 && (
                    <button
                      onClick={() => setIsSynopsisExpanded(true)}
                      className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-500 mt-1 hover:text-white transition-colors cursor-pointer"
                    >
                      Suite...
                    </button>
                  )}
                </div>
              ) : !tmdbDetails ? (
                <div className="space-y-2 animate-pulse">
                  <div className="h-3.5 bg-zinc-800/80 rounded w-full" />
                  <div className="h-3.5 bg-zinc-800/80 rounded w-11/12" />
                  <div className="h-3.5 bg-zinc-800/80 rounded w-4/5" />
                </div>
              ) : (
                <p className="text-xs text-zinc-500 italic">Aucun synopsis disponible.</p>
              )}
            </div>

            {/* Ordre de visionnage / Saga */}
            {(collectionData && collectionData.parts && collectionData.parts.length > 0) && (
              <div>
                <h3 className="text-xs font-bold uppercase text-zinc-500 tracking-wider mb-3">
                  Ordre de visionnage
                </h3>
                <div className="flex overflow-x-auto gap-3.5 hide-scrollbar py-2 px-1 -mx-1">
                  {collectionData.parts.map((part: any, idx: number) => (
                    <TimelineMediaCard
                      key={`col_part_${part.media_type || 'media'}_${part.id}_${idx}`}
                      media={part}
                      isActive={part.id === effectiveTmdbId}
                      onClick={() => onShowClick && onShowClick(part.id, part.media_type || (part.title ? 'movie' : 'tv'))}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Univers Etendu (TVDB) */}
            {(universeData && universeData.parts && universeData.parts.length > 0) && (
              <div className={collectionData?.parts?.length > 0 ? "mt-6" : ""}>
                <h3 className="text-xs font-bold uppercase text-zinc-500 tracking-wider mb-3">
                  Dans le même univers
                </h3>
                <div className="flex overflow-x-auto gap-3.5 hide-scrollbar py-2 px-1 -mx-1">
                  {universeData.parts.map((part: any, idx: number) => (
                    <TimelineMediaCard
                      key={`univ_part_${part.media_type || 'media'}_${part.id}_${idx}`}
                      media={part}
                      isActive={part.id === effectiveTmdbId}
                      onClick={() => onShowClick && onShowClick(part.id, part.media_type || (part.title ? 'movie' : 'tv'))}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Loading State for Franchises */}
            {collectionLoading && (
              <div>
                <h3 className="text-xs font-bold uppercase text-zinc-500 tracking-wider mb-3">
                  {isSeries ? "Dans le même univers" : "Ordre de visionnage"}
                </h3>
                <div className="flex overflow-x-auto gap-3.5 hide-scrollbar py-2 px-1 -mx-1">
                  {[1, 2, 3, 4].map(i => (
                    <div key={`saga_loader_${i}`} className="flex-none w-[110px] animate-pulse">
                      <div className="w-full aspect-[2/3] bg-zinc-800/80 rounded-xl mb-2" />
                      <div className="h-3 bg-zinc-800/80 rounded w-3/4 mx-auto" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Thèmes & Genres (Premium UI) */}
            {!tmdbDetails ? (
              <div className="col-span-2 bg-zinc-900/40 border border-white/5 p-4 rounded-2xl mt-1">
                <span className="block text-xs font-bold uppercase text-zinc-500 tracking-wider mb-3">
                  Catégories & Thèmes
                </span>
                <div className="flex flex-wrap gap-2 animate-pulse">
                  <div className="h-7 w-20 bg-zinc-800/80 rounded-full" />
                  <div className="h-7 w-24 bg-zinc-800/80 rounded-full" />
                  <div className="h-7 w-16 bg-zinc-800/80 rounded-full" />
                </div>
              </div>
            ) : (tmdbDetails?.genres?.length > 0 || keywords.length > 0) ? (
              <div className="col-span-2 bg-zinc-900/40 border border-white/5 p-4 rounded-2xl mt-1">
                <span className="block text-xs font-bold uppercase text-zinc-500 tracking-wider mb-3">
                  Catégories & Thèmes
                </span>
                <div className="flex flex-wrap gap-2">
                  {/* Genres principaux (Glassmorphism) */}
                  {tmdbDetails?.genres?.map((g: any, idx: number) => (
                    <span 
                      key={`genre_${g.id}_${idx}`} 
                      className="px-3 py-1.5 bg-white/10 border border-white/15 text-white text-[11px] font-bold uppercase tracking-wide rounded-full backdrop-blur-md shadow-sm"
                    >
                      {g.name}
                    </span>
                  ))}
                  
                  {/* Mots-clés profonds */}
                  {keywords.map((kw: string, idx: number) => (
                    <span 
                      key={idx} 
                      className="px-3 py-1.5 bg-zinc-800/60 border border-zinc-700/50 text-zinc-300 hover:text-white transition-colors text-[11px] font-medium rounded-full capitalize"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Où regarder (Format discret) */}
            <div>
              <h3 className="text-xs font-bold uppercase text-zinc-500 tracking-wider mb-2">Où regarder</h3>
              {(() => {
                const hasProviders = sortedProviders.length > 0;
                const isLoadingPlex = plexMediaInfo === null;
                const isLoadingProviders = providers === null;

                // 1. Affichage dès qu'au moins une plateforme (Plex ou SVOD) est disponible
                if (hasProviders) {
                  return (
                    <div className="flex items-center gap-2 flex-wrap">
                      {sortedProviders.map((provider: any, idx: number) => {
                        if (provider.isPlex) {
                          return (
                            <a
                              key={`plex-provider-item-${idx}`}
                              href={provider.plexUrl || "https://app.plex.tv/desktop"}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => {
                                e.preventDefault();
                                openExternalUrl(provider.plexUrl || "https://app.plex.tv/desktop");
                              }}
                              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-[#E5A93D]/40 bg-[#E5A93D]/10 text-[#E5A93D] hover:bg-[#E5A93D]/20 text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-[0_0_12px_rgba(229,169,61,0.2)]"
                              title={`Disponible sur Plex : ${provider.serverName || 'Serveur'}`}
                            >
                              <img 
                                src={PLEX_LOGO_SVG}
                                alt="Plex"
                                className="w-4 h-4 object-contain rounded shrink-0"
                              />
                              <span>Disponible sur Plex {provider.serverName ? `(${provider.serverName})` : ''}</span>
                            </a>
                          );
                        }

                        const isSubscribed = userPlatforms.includes(provider.provider_id);
                        const directLink = getProviderDirectLink(provider.provider_id, title, providers?.link || '#');
                        const logoUrl = getFormattedProviderLogo(provider.logo_path, provider.provider_name);
                        return (
                          <a
                            key={`provider_${provider.provider_id}_${idx}`}
                            href={directLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => {
                              if (directLink && directLink !== '#') {
                                e.preventDefault();
                                openExternalUrl(directLink);
                              }
                            }}
                            className={cn(
                              "inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all active:scale-95 cursor-pointer",
                              isSubscribed
                                ? "bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20 hover:border-amber-400/50 shadow-[0_0_10px_rgba(245,158,11,0.15)]"
                                : "bg-zinc-900/80 border-white/10 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                            )}
                            title={`Ouvrir ${provider.provider_name}`}
                          >
                            {logoUrl ? (
                              <img
                                loading="lazy"
                                decoding="async"
                                src={logoUrl}
                                alt={provider.provider_name}
                                className="w-4 h-4 object-cover rounded shrink-0"
                              />
                            ) : (
                              <MonitorPlay size={14} className={cn("shrink-0", isSubscribed ? "text-amber-400" : "text-zinc-400")} />
                            )}
                            <span>{provider.provider_name}</span>
                          </a>
                        );
                      })}

                      {/* Indicateur discret si une vérification est encore en cours */}
                      {(isLoadingPlex || isLoadingProviders) && (
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-zinc-900/60 border border-white/5 text-zinc-400 text-xs animate-pulse">
                          <img
                            src={PLEX_LOGO_SVG}
                            alt="Plex"
                            className="w-3.5 h-3.5 object-contain rounded shrink-0"
                          />
                          <span>Vérification...</span>
                        </div>
                      )}
                    </div>
                  );
                }

                // 2. Si les deux sont en cours de chargement initial
                if (isLoadingPlex || isLoadingProviders) {
                  return (
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-white/10 bg-zinc-900/80 text-zinc-400 text-xs font-medium animate-pulse">
                        <img
                          src={PLEX_LOGO_SVG}
                          alt="Plex"
                          className="w-4 h-4 object-contain rounded shrink-0"
                        />
                        <span>Recherche des disponibilités (Plex & Streaming)...</span>
                      </div>
                    </div>
                  );
                }

                // 3. Si les deux ont terminé et rien n'a été trouvé
                return (
                  <div className="flex items-center gap-3 flex-wrap">
                    {presence.hasFile || presence.plexInfo?.available ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 text-xs font-bold shadow-sm">
                          <CheckCircle2 size={14} className="shrink-0 text-emerald-400" />
                          <span>{presence.plexInfo?.available ? "Sur Plex" : "Téléchargé"}</span>
                        </div>
                        {presence.plexInfo?.available && (
                          <button
                            type="button"
                            onClick={() => openExternalUrl(presence.plexInfo?.plexUrl || 'https://app.plex.tv/desktop')}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 active:scale-95 text-xs font-bold transition-all cursor-pointer shadow-sm"
                            title="Ouvrir dans l'application Plex"
                          >
                            <Play size={14} className="shrink-0 text-amber-400 fill-amber-400" />
                            <span>Ouvrir dans Plex</span>
                          </button>
                        )}
                      </div>
                    ) : isUnreleased ? (
                      <p className="text-xs text-zinc-500 italic font-medium flex items-center gap-1.5">
                        <Clock size={14} />
                        <span>Bientôt disponible</span>
                      </p>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        {!isSeries ? (
                          <button
                            type="button"
                            onClick={(e) => handle1ClickDownloadMovie(e)}
                            disabled={is1ClickDownloading.movie}
                            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-blue-500/40 bg-blue-500/15 hover:bg-blue-500/25 active:scale-95 text-xs font-bold text-blue-300 transition-all cursor-pointer shadow-[0_0_15px_rgba(59,130,246,0.25)]"
                            title="Télécharger le film en 1 clic dans Radarr"
                          >
                            <Download size={14} className={cn("text-blue-300 stroke-[2.5]", is1ClickDownloading.movie && "animate-spin")} />
                            <span>{is1ClickDownloading.movie ? "Lancement Radarr..." : "Télécharger le film (1 Clic)"}</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setIsDownloadModalOpen(true)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-blue-500/40 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 active:scale-95 text-xs font-bold transition-all cursor-pointer shadow-[0_0_12px_rgba(59,130,246,0.2)]"
                            title="Rechercher et télécharger sur Sonarr / C411"
                          >
                            <Download size={14} className="shrink-0" />
                            <span>Télécharger</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Graphique interactif des notes par épisode */}
            {isSeries && tmdbDetails?.seasons && tmdbDetails.seasons.length > 0 && (
              <div className="pt-2">
                <EpisodeRatingsChart
                  effectiveTmdbId={effectiveTmdbId}
                  imdbId={tmdbDetails?.external_ids?.imdb_id || tmdbDetails?.imdb_id || (show as any)?.imdbId || null}
                  seasons={tmdbDetails.seasons}
                  seasonsCache={seasonsCache}
                  onLoadSeason={async (sNum) => {
                    if (!effectiveTmdbId || seasonsCache[sNum]) return;
                    const res = await tmdb.getSeasonDetails(effectiveTmdbId, sNum);
                    if (res.ok) {
                      setSeasonsCache(prev => ({ ...prev, [sNum]: res.value }));
                    }
                  }}
                  onSelectEpisode={(seasonNum, ep) => {
                    openEpisodeModal(seasonNum, ep);
                  }}
                  defaultSeasonNumber={expandedSeason || 1}
                />
              </div>
            )}

            {/* Discussions Reddit */}
            <div className="pt-1">
              <RedditSection
                query={`${tmdbDetails?.name || tmdbDetails?.title || show?.title || ''} ${isSeries ? 'series discussion' : 'movie discussion'}`}
                isLocked={false}
                title="Discussions Reddit"
                description="Retrouvez les avis, théories et spoilers de la communauté."
              />
            </div>

            {/* Séries / Films similaires remontés dans À Propos */}
            {(() => {
              const similarList = getPrioritizedSimilarMedia(tmdbDetails, collectionData);
              if (similarList.length === 0) return null;

              return (
                <div className="pt-2">
                  <h3 className="text-xs font-bold uppercase text-zinc-500 tracking-wider mb-3">
                    {isSeries ? "Séries similaires" : "Films similaires"}
                  </h3>
                  <div className="flex gap-3.5 overflow-x-auto pb-2 snap-x snap-mandatory hide-scrollbar">
                    {similarList.slice(0, 15).map((item: any, idx: number) => {
                      const title = item.title || item.name;

                      return (
                        <div
                          key={`similar_${item.media_type || 'media'}_${item.id}_${idx}`}
                          onClick={() => onShowClick?.(item.id, item.media_type || (item.title ? 'movie' : (isSeries ? 'tv' : 'movie')))}
                          className="w-[115px] shrink-0 snap-start flex flex-col gap-1.5 cursor-pointer group active:scale-95 transition-transform"
                        >
                          <div className="w-full aspect-[2/3] bg-zinc-900 rounded-xl overflow-hidden relative shadow-md border border-white/5">
                            {item.poster_path ? (
                              <img loading="lazy" decoding="async"
                                src={`https://image.tmdb.org/t/p/w185${item.poster_path}`}
                                alt={title}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center p-2 text-center text-xs text-zinc-600 font-bold">
                                {title}
                              </div>
                            )}
                          </div>

                          <span className="text-[11px] font-bold text-zinc-300 line-clamp-1 group-hover:text-[#E5A93D] transition-colors">
                            {title}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>

        {isSeries && (
          <div id="section-episodes" className="scroll-mt-40 mt-12 space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="text-xs font-bold uppercase text-zinc-500 tracking-wider">Épisodes</h3>
              <button
                type="button"
                onClick={() => setIsDownloadMode(!isDownloadMode)}
                className={cn(
                  "px-2.5 py-1 rounded-xl border text-[11px] font-bold flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer",
                  isDownloadMode 
                    ? "bg-blue-500/20 border-blue-500/40 text-blue-300 shadow-[0_0_12px_rgba(59,130,246,0.25)]" 
                    : "bg-zinc-800/80 border-white/10 text-zinc-400 hover:text-white"
                )}
                title="Activer le mode téléchargement 1-clic direct vers Sonarr"
              >
                <Download size={12} className={cn(isDownloadMode && "text-blue-400 animate-pulse")} />
                <span>{isDownloadMode ? "Mode Téléchargement (Actif)" : "Téléchargement 1-Clic"}</span>
              </button>
            </div>
            {tmdbDetails?.seasons?.filter((s: any) => s.season_number > 0).slice(0, visibleSeasons).map((season: any, idx: number) => {
              const seasonNum = season.season_number;
              const seasonEpCount = season.episode_count || 0;
              const cachedSeason = seasonsCache[seasonNum];
              const displayAirDate = cachedSeason?.episodes?.[0]?.air_date || season.air_date;
              
              const todayStr = getTodayStr();
              const isFutureByDate = displayAirDate ? displayAirDate > todayStr : false;
              const hasAiredEpisodesInCache = cachedSeason?.episodes?.some((ep: any) => {
                if (!ep.air_date) return true;
                return ep.air_date <= todayStr;
              });

              const isFutureSeason = isFutureByDate || seasonEpCount === 0 || (cachedSeason?.episodes && !hasAiredEpisodesInCache);
              const seasonPrefix = `${seasonNum}x`;
              const watchedInSeason = (show?.seenEpisodes || []).filter(epKey => epKey.startsWith(seasonPrefix)).length;
              const isFullyWatched = seasonEpCount > 0 && watchedInSeason >= seasonEpCount;

              return (
              <div key={`season_${season.id || season.season_number}_${idx}`} className={cn("bg-[#1a1b26] border border-white/5 rounded-2xl overflow-hidden transition-all", isFutureSeason && "opacity-75")}>
                {/* Season Header */}
                <div className="w-full p-4 flex items-center gap-3">
                  <button 
                    onClick={() => loadSeason(seasonNum)}
                    className="flex-1 flex items-center text-left touch-manipulation py-1"
                  >
                    <div className="flex items-center gap-3 w-full">
                        <h3 className="font-bold text-white text-[15px]">
                          Saison {seasonNum}
                          {seasonEpCount > 0 && (
                            <span className="text-zinc-400 font-semibold text-xs ml-1.5">
                              ({watchedInSeason}/{seasonEpCount})
                            </span>
                          )}
                        </h3>
                        {!isFutureSeason && seasonEpCount > 0 && show?.status !== 'dropped' && (
                          <div className="w-12 h-1 bg-zinc-800 rounded-full overflow-hidden flex items-center shrink-0">
                            <div className="h-full bg-emerald-500" style={{ width: `${(watchedInSeason / seasonEpCount) * 100}%` }} />
                          </div>
                        )}
                        {isFutureSeason && displayAirDate && (
                          <span className="inline-block bg-amber-500/20 border border-amber-500/30 text-amber-400 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md">
                            PROCHAINEMENT • {formatAirDateSafe(displayAirDate, 'long')}
                          </span>
                        )}
                    </div>
                  </button>

                  {!isFutureSeason && seasonEpCount > 0 && (
                    <button
                      onClick={(e) => toggleSeasonSeen(e, seasonNum, seasonEpCount)}
                      className={cn(
                        "px-3 py-1 rounded-full border text-[10px] font-bold flex items-center gap-1 transition-colors active:scale-95 touch-manipulation uppercase tracking-wider shrink-0",
                        isFullyWatched ? "border-emerald-500 bg-emerald-500/15 text-emerald-400 font-bold" : "border-[#E5A93D]/30 text-[#E5A93D] hover:bg-[#E5A93D]/5 font-bold"
                      )}
                      title={isFullyWatched ? "Marquer toute la saison comme non vue" : "Marquer toute la saison comme vue"}
                    >
                      {isFullyWatched ? "✓ Tout vu" : "Tout marquer"}
                    </button>
                  )}

                  {/* Bouton Télécharger la saison 1-clic */}
                  {!isFutureSeason && (
                    <button
                      type="button"
                      onClick={(e) => handle1ClickDownloadSeason(e, seasonNum)}
                      disabled={is1ClickDownloading[`S${seasonNum}`]}
                      className="p-1.5 px-2.5 rounded-full border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 hover:text-blue-300 text-[10px] font-bold flex items-center gap-1 transition-colors active:scale-95 touch-manipulation uppercase tracking-wider shrink-0 cursor-pointer disabled:opacity-50"
                      title={`Télécharger la saison ${seasonNum} en 1 clic dans Sonarr`}
                    >
                      <Download size={12} className={cn("text-blue-400", is1ClickDownloading[`S${seasonNum}`] && "animate-spin")} />
                      <span className="hidden sm:inline">S{seasonNum}</span>
                    </button>
                  )}
                  
                  <button onClick={() => loadSeason(seasonNum)} className="text-zinc-500 hover:text-white transition-colors shrink-0 px-2">
                    {expandedSeason === season.season_number ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>

                {/* Episodes List (Accordion avec animation d'apparition douce) */}
                {expandedSeason === season.season_number && (
                  <div className="bg-[#1a1b26] border-t border-white/5 divide-y divide-white/5 animate-in fade-in duration-200">
                    {!seasonsCache[season.season_number] ? (
                      <div className="p-4 space-y-3 animate-pulse">
                        {[1, 2, 3].map(i => (
                          <div key={i} className="flex items-center gap-3">
                            <div className="w-24 h-16 rounded-xl bg-zinc-800/80 shrink-0" />
                            <div className="flex-1 space-y-2">
                              <div className="h-4 bg-zinc-800/80 rounded w-3/4" />
                              <div className="h-3 bg-zinc-800/60 rounded w-1/2" />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <>
                        {/* Trailer de la saison */}
                        {(() => {
                          const ytVideos = seasonsCache[season.season_number].videos?.results?.filter((v: any) => v.site === 'YouTube') || [];
                          const hasSeasonTrailer = ytVideos.length > 0;
                          if (!hasSeasonTrailer) return null;
                          return (
                            <div className="p-3">
                              <button
                                onClick={() => setTrailerModalVideos(ytVideos)}
                                className="w-full py-2.5 px-4 bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-amber-600/15 border border-amber-500/30 rounded-xl flex items-center justify-center gap-2 text-amber-300 hover:text-amber-200 hover:bg-amber-500/20 hover:border-amber-400/40 transition-all cursor-pointer font-bold text-xs shadow-[0_0_15px_rgba(245,158,11,0.15)] active:scale-[0.98]"
                              >
                                <Clapperboard size={16} className="text-amber-400 stroke-[2.2]" />
                                <span>Bande-annonce de la saison {seasonNum}</span>
                              </button>
                            </div>
                          );
                        })()}
                        {(!seasonsCache[season.season_number].episodes || seasonsCache[season.season_number].episodes.length === 0) ? (
                          <div className="p-6 flex flex-col items-center justify-center gap-2 text-center border-t border-white/5 bg-[#1a1b26]/50">
                            <span className="text-sm font-bold text-zinc-300">Saison annoncée</span>
                            <span className="text-xs text-zinc-500 font-medium max-w-[200px]">
                              Les épisodes de cette saison seront disponibles prochainement.
                            </span>
                          </div>
                        ) : (
                          seasonsCache[season.season_number].episodes.map((ep: any, epIdx: number) => {
                            const epKey = `${season.season_number}x${ep.episode_number}`;
                            const isSeen = show?.seenEpisodes?.includes(epKey);
                            const isFutureEp = ep.air_date ? ep.air_date > todayStr : false;
                            const epDownload = getEpisodeDownload(effectiveTmdbId, tmdbDetails?.external_ids?.tvdb_id || (show as any)?.tvdbId, season.season_number, ep.episode_number);
                            const isDownloadingThis = is1ClickDownloading[`S${season.season_number}E${ep.episode_number}`];

                            return (
                              <div 
                                key={`ep_${ep.id || ep.episode_number}_${epIdx}`} 
                                onClick={() => openEpisodeModal(season.season_number, ep)}
                                className={cn("p-3 flex items-center gap-3 hover:bg-white/5 transition-colors cursor-pointer active:bg-white/10 relative", isFutureEp && "opacity-50")}
                              >
                                <div className="relative w-24 h-16 rounded-xl overflow-hidden bg-zinc-800 shrink-0 border border-white/5">
                                   {ep.still_path && (
                                     <img loading="lazy" decoding="async" src={`https://image.tmdb.org/t/p/w300${ep.still_path}`} className="w-full h-full object-cover" alt="" />
                                   )}
                                   <div className="absolute inset-0 bg-black/20" />
                                </div>
                                
                                <div className="flex-1 min-w-0">
                                   <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                     {(() => {
                                       const airDateLabel = getEpisodeAirDateLabel(ep.air_date);
                                       if (!airDateLabel) return null;

                                       return (
                                         <span className="inline-block bg-amber-500/20 border border-amber-500/30 text-amber-400 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md mb-1 w-max">
                                           {airDateLabel}
                                         </span>
                                       );
                                     })()}
                                   </div>
                                   <p className={cn("text-[14px] font-bold truncate leading-tight", isSeen ? "text-zinc-500 line-through" : "text-zinc-200")}>{ep.name}</p>
                                   <p className="text-[12px] font-semibold text-zinc-500 mt-1">
                                     E{(ep.episode_number ?? 1).toString().padStart(2, '0')} • {ep.runtime ? `${ep.runtime}min` : '45min'}
                                   </p>
                                </div>

                                <div className="flex flex-col gap-2 shrink-0 items-end">
                                  {epDownload ? (
                                    <div className="scale-[0.85] origin-right" onClick={(e) => e.stopPropagation()}>
                                      <LiveDownloadBanner items={[epDownload]} compact={true} />
                                    </div>
                                  ) : isDownloadMode ? (
                                    /* Mode Téléchargement : la coche est remplacée par le bouton Télécharger 1-clic direct */
                                    <button
                                      type="button"
                                      onClick={(e) => handle1ClickDownloadEpisode(e, season.season_number, ep.episode_number)}
                                      disabled={isDownloadingThis}
                                      className="p-2.5 rounded-xl border border-blue-500/40 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 transition-all active:scale-90 touch-manipulation cursor-pointer shadow-[0_0_12px_rgba(59,130,246,0.3)] disabled:opacity-50"
                                      title="Télécharger l'épisode en 1 clic dans Sonarr"
                                    >
                                      <Download size={16} className={cn("text-blue-300 stroke-[2.5]", isDownloadingThis && "animate-spin")} />
                                    </button>
                                  ) : (
                                    /* Mode Standard : bouton 1-clic discret + coche Vu */
                                    <div className="flex items-center gap-1">
                                      {!isFutureEp && (
                                        <button
                                          type="button"
                                          onClick={(e) => handle1ClickDownloadEpisode(e, season.season_number, ep.episode_number)}
                                          disabled={isDownloadingThis}
                                          className="p-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-colors active:scale-95 touch-manipulation cursor-pointer disabled:opacity-50"
                                          title="Télécharger en 1 clic dans Sonarr"
                                        >
                                          <Download size={13} className={cn("text-blue-400", isDownloadingThis && "animate-spin")} />
                                        </button>
                                      )}

                                      {!isFutureEp && (
                                        <button 
                                          onClick={(e) => toggleEpisodeSeen(e, season.season_number, ep.episode_number)}
                                          className="p-1.5 touch-manipulation active:scale-90 transition-transform"
                                        >
                                          {isSeen ? (
                                            <div className="w-5 h-5 rounded-full border border-emerald-500 flex items-center justify-center bg-emerald-500/15">
                                              <Check size={12} className="text-emerald-400 stroke-[3]" />
                                            </div>
                                          ) : (
                                            <div className="w-5 h-5 rounded-full border border-zinc-700" />
                                          )}
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })
                      )}
                      </>
                    )}
                  </div>
                )}
              </div>
              );
            })}
            
            {tmdbDetails?.seasons?.filter((s: any) => s.season_number > 0).length > visibleSeasons && (
              <div ref={seasonObserverRef} className="h-10 w-full flex items-center justify-center">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#E5A93D]" />
              </div>
            )}
          </div>
        )}

        {((tmdbDetails?.aggregate_credits?.cast || tmdbDetails?.credits?.cast)?.length > 0) && (
          <div id="section-casting" className="scroll-mt-40 mt-12 animate-in fade-in duration-200">
            <h3 className="text-xs font-bold uppercase text-zinc-500 tracking-wider mb-3">Casting</h3>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-4 py-2">
              {(tmdbDetails?.aggregate_credits?.cast || tmdbDetails?.credits?.cast)?.map((actor: any, actorIdx: number) => (
                <div 
                  key={`actor_${actor.id}_${actorIdx}`}
                  onClick={() => openPersonModal(actor.id)}
                  className="flex flex-col items-center cursor-pointer group active:scale-95 transition-transform"
                >
                  {/* Avatar rond */}
                  <div className="relative mb-2">
                    <div className="w-20 h-20 rounded-full overflow-hidden bg-zinc-800 border border-white/10 shadow-md">
                      {actor.profile_path ? (
                        <img loading="lazy" decoding="async" 
                          src={`https://image.tmdb.org/t/p/w185${actor.profile_path}`} 
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" 
                          alt={actor.name} 
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs font-bold text-zinc-600">
                          {actor.name?.charAt(0)}
                        </div>
                      )}
                    </div>
                    {(actor.total_episode_count || actor.episode_count) ? (
                      <div className="absolute bottom-0 left-0 bg-black/70 backdrop-blur-md px-1.5 py-0.5 rounded-full text-[9px] font-bold text-white border border-white/10 shadow-sm pointer-events-none">
                        {actor.total_episode_count || actor.episode_count} ép.
                      </div>
                    ) : null}
                  </div>
                  
                  {/* Nom Acteur */}
                  <p className="text-xs font-bold text-zinc-100 text-center line-clamp-1 w-full">
                    {actor.name}
                  </p>

                  {/* Personnage */}
                  <p className="text-[10px] text-zinc-500 text-center line-clamp-1 w-full mt-0.5">
                    {actor.roles && actor.roles.length > 0 
                      ? actor.roles.map((r: any) => r.character).filter(Boolean).join(' / ') || 'Rôle inconnu'
                      : (actor.character || 'Rôle inconnu')}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Episode Modal */}
      {selectedEpisode && (
        <EpisodeDetailModal 
          show={show}
          season={selectedEpisode.season}
          episode={selectedEpisode.episode}
          tmdbShowTitle={tmdbDetails?.name || tmdbDetails?.title}
          tmdbShowId={effectiveTmdbId}
          onShowClick={(tmdbId) => {
            setSelectedEpisode(null);
            if (window.history.state?.isEpisodeDetailModal || window.history.state?.isModal) {
              window.history.back();
            }
            const isSameShow = (effectiveTmdbId && Number(effectiveTmdbId) === Number(tmdbId)) ||
                               (show?.tmdbId && Number(show.tmdbId) === Number(tmdbId)) ||
                               (show?.id && String(show.id) === String(tmdbId));
            if (!isSameShow && onShowClick) {
              setTimeout(() => {
                onShowClick(tmdbId, show?.mediaType || 'tv');
              }, 50);
            }
          }}
          onClose={() => {
            setSelectedEpisode(null);
            if (window.history.state?.isEpisodeDetailModal || window.history.state?.isModal) {
              window.history.back();
            }
          }}
          onLoadSeason={async (seasonNum) => {
            if (!effectiveTmdbId) return null;
            if (seasonsCache[seasonNum]) return seasonsCache[seasonNum]?.episodes || seasonsCache[seasonNum];
            const res = await tmdb.getSeasonDetails(effectiveTmdbId, seasonNum);
            if (res.ok && res.value) {
              setSeasonsCache(prev => ({ ...prev, [seasonNum]: res.value }));
              return res.value.episodes || res.value;
            }
            return null;
          }}
        />
      )}

      {/* Person Modal */}
      {selectedPersonId && (
        <PersonDetailModal
          personId={selectedPersonId}
          onClose={() => {
            setSelectedPersonId(null);
            if (window.history.state?.isPersonDetailModal || window.history.state?.isModal) {
              window.history.back();
            }
          }}
          onShowClick={(tmdbId, type) => {
            setSelectedPersonId(null);
            if (window.history.state?.isPersonDetailModal || window.history.state?.isModal) {
              window.history.back();
            }
            const isSameShow = (effectiveTmdbId && Number(effectiveTmdbId) === Number(tmdbId)) ||
                               (show?.tmdbId && Number(show.tmdbId) === Number(tmdbId)) ||
                               (show?.id && String(show.id) === String(tmdbId));
            if (!isSameShow && onShowClick) {
              setTimeout(() => {
                onShowClick(tmdbId, type || 'movie');
              }, 50);
            }
          }}
        />
      )}

      {/* Trailer Modal */}
      {trailerModalVideos && (
        <TrailerModal
          videos={trailerModalVideos}
          onClose={() => setTrailerModalVideos(null)}
        />
      )}

      {/* Download C411 / Sonarr / Radarr Modal */}
      {isDownloadModalOpen && (
        <DownloadModal
          isOpen={isDownloadModalOpen}
          onClose={() => {
            setIsDownloadModalOpen(false);
            setDownloadTargetSeason(undefined);
            setDownloadTargetEpisode(undefined);
          }}
          title={title}
          originalTitle={tmdbDetails?.original_title || tmdbDetails?.original_name || (show as any)?.originalTitle}
          year={(tmdbDetails?.release_date || tmdbDetails?.first_air_date || show?.firstAirDate)?.slice(0, 4)}
          mediaType={isSeries ? 'tv' : 'movie'}
          tmdbId={effectiveTmdbId}
          imdbId={tmdbDetails?.external_ids?.imdb_id || (show as any)?.imdbId}
          initialSeason={downloadTargetSeason}
          initialEpisode={downloadTargetEpisode}
          totalSeasons={tmdbDetails?.number_of_seasons || tmdbDetails?.seasons?.filter((s: any) => s.season_number > 0)?.length || 1}
          seasonsData={tmdbDetails?.seasons}
          onSuccessToast={(msg) => showToast(msg, 'success', show || undefined)}
        />
      )}
    </div>
  );
}
