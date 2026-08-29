import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Download, 
  Trash2, 
  Search, 
  CheckCircle2, 
  Clock, 
  Zap, 
  Settings, 
  Film, 
  Tv, 
  RefreshCw, 
  X,
  AlertCircle,
  AlertTriangle,
  SlidersHorizontal,
  Loader2,
  Check,
  Copy,
  ArrowDown
} from 'lucide-react';
import { useLiveDownloadStore } from '../store/liveDownloadStore';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { formatBytes, formatSpeed, formatSecondsToETA, formatCleanMediaInfo, LiveDownloadItem, pushReleaseDirectly } from '../services/sonarrRadarr';
import { C411Torrent, searchC411Torrents, formatTorrentSize } from '../services/c411';
import { useToastStore } from '../store/toastStore';
import { SeenItLogo } from '../components/SeenItLogo';
import { cn } from '../lib/utils';

interface Props {
  onShowClick?: (id: any, mediaType?: 'tv' | 'movie') => void;
  onOpenSettings?: () => void;
}

interface SwipeableItemProps {
  item: LiveDownloadItem;
  onShowClick?: (id: any, mediaType?: 'tv' | 'movie') => void;
  onRemove: (item: LiveDownloadItem) => void;
  isDeleting: boolean;
}

function SwipeableItem({ item, onShowClick, onRemove, isDeleting }: SwipeableItemProps) {
  const [dragX, setDragX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const isHorizontalSwipe = useRef(false);

  const isDone = item.progress >= 100;
  const isError = item.status === 'error' || Boolean(item.errorMessage);
  const isWarning = item.status === 'warning';
  const { cleanTitle, subTitle, isTv } = formatCleanMediaInfo(item);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isHorizontalSwipe.current = false;
    setIsSwiping(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const deltaX = currentX - touchStartX.current;
    const deltaY = currentY - touchStartY.current;

    if (!isHorizontalSwipe.current) {
      if (Math.abs(deltaX) > 8 && Math.abs(deltaX) > Math.abs(deltaY)) {
        isHorizontalSwipe.current = true;
      } else if (Math.abs(deltaY) > 8) {
        setIsSwiping(false);
        return;
      }
    }

    if (isHorizontalSwipe.current) {
      // Autoriser le glissement vers la droite
      if (deltaX > 0) {
        setDragX(Math.min(160, deltaX));
      } else {
        setDragX(0);
      }
    }
  };

  const handleTouchEnd = () => {
    setIsSwiping(false);
    if (dragX > 90) {
      // Seuil de suppression atteint
      setDragX(200);
      setTimeout(() => {
        onRemove(item);
      }, 150);
    } else {
      setDragX(0);
    }
  };

  const posterSrc = item.posterPath
    ? (item.posterPath.startsWith('http') ? item.posterPath : `https://image.tmdb.org/t/p/w185${item.posterPath}`)
    : null;

  return (
    <div className="relative overflow-hidden rounded-2xl select-none">
      {/* Fond rouge révélé lors du swipe vers la droite */}
      <div 
        className={cn(
          "absolute inset-0 bg-red-600 rounded-2xl flex items-center justify-start pl-6 gap-2 text-white font-black text-xs transition-opacity",
          dragX > 20 ? "opacity-100" : "opacity-0"
        )}
      >
        <Trash2 size={20} className={cn(dragX > 90 ? "scale-125" : "scale-100", "transition-transform")} />
        <span>Supprimer</span>
      </div>

      {/* Carte principale */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={() => {
          if (dragX === 0 && item.tmdbId && onShowClick) {
            onShowClick(item.tmdbId, item.mediaType);
          }
        }}
        style={{
          transform: `translateX(${dragX}px)`,
          transition: isSwiping ? 'none' : 'transform 0.25s ease-out'
        }}
        className={cn(
          "rounded-2xl border transition-colors backdrop-blur-md relative overflow-hidden flex items-stretch min-h-[105px] sm:min-h-[115px] p-2.5 sm:p-3 gap-3",
          isError
            ? "bg-gradient-to-r from-red-950/40 via-zinc-900/90 to-zinc-900/90 border-red-500/40"
            : isWarning
            ? "bg-gradient-to-r from-amber-950/40 via-zinc-900/90 to-zinc-900/90 border-amber-500/40"
            : "bg-[#121214] border-white/10 hover:border-white/20",
          item.tmdbId && onShowClick ? "cursor-pointer" : ""
        )}
      >
        {/* Progress tint de fond subtil */}
        <div 
          className={cn(
            "absolute inset-y-0 left-0 transition-all duration-300 pointer-events-none opacity-15",
            isError
              ? "bg-red-500"
              : isWarning
              ? "bg-amber-500"
              : isDone
              ? "bg-emerald-500"
              : "bg-gradient-to-r from-cyan-500 to-blue-500"
          )}
          style={{ width: `${Math.min(100, item.progress)}%` }}
        />

        {/* 1. Image Affiche Poster à gauche (Format arrondi cinéma 2:3) */}
        <div className="w-14 sm:w-16 h-20 sm:h-22 shrink-0 rounded-xl overflow-hidden bg-zinc-950 border border-white/10 shadow-md relative flex items-center justify-center">
          {posterSrc ? (
            <img 
              src={posterSrc} 
              alt={cleanTitle}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={(e) => {
                e.currentTarget.onerror = null;
                e.currentTarget.style.display = 'none';
              }}
            />
          ) : (
            <div className={cn(
              "w-full h-full flex flex-col items-center justify-center gap-1 p-1 text-center",
              isTv
                ? "bg-gradient-to-b from-purple-950/50 to-zinc-950 text-purple-400"
                : "bg-gradient-to-b from-amber-950/40 to-zinc-950 text-[#E5A93D]"
            )}>
              {isTv ? <Tv size={20} /> : <Film size={20} />}
              <span className="text-[8px] font-black uppercase text-zinc-400 tracking-wider">
                {isTv ? 'Série' : 'Film'}
              </span>
            </div>
          )}
        </div>

        {/* 2. Centre : Titre EN ENTIER, Sous-titre, Qualité, Stats */}
        <div className="flex-1 flex flex-col justify-between min-w-0 py-0.5">
          <div>
            {/* Ligne 1 : Titre complet en or/jaune SeenIt sans truncate brutal */}
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-extrabold text-sm sm:text-base text-[#E5A93D] tracking-wide uppercase leading-tight line-clamp-2 break-words">
                {cleanTitle}
              </h3>

              {/* Statut ou Pourcentage en haut à droite */}
              <div className="flex items-center gap-1.5 shrink-0">
                <span className={cn(
                  "text-xs sm:text-sm font-black",
                  isError ? "text-red-400" : isDone ? "text-emerald-400" : "text-cyan-400"
                )}>
                  {isError ? 'Erreur' : isDone ? '100%' : `${item.progress}%`}
                </span>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(item);
                  }}
                  disabled={isDeleting}
                  className="p-1 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                  title="Supprimer le téléchargement"
                >
                  <X size={15} className={cn(isDeleting && "animate-spin")} />
                </button>
              </div>
            </div>

            {/* Ligne 2 : Sous-titre (ex: S03 | E09 ou Titre de l'épisode) */}
            {subTitle && (
              <p className="text-xs sm:text-sm font-bold text-white tracking-wide mt-0.5">
                {subTitle} {item.episodeTitle ? `• ${item.episodeTitle}` : ''}
              </p>
            )}

            {/* Ligne 3 : Badges Qualité + Vitesse / ETA / Taille */}
            <div className="flex items-center gap-2 flex-wrap mt-1.5 text-[10px] sm:text-[11px] font-semibold text-zinc-400">
              {/* Badge Qualité */}
              {item.quality && (
                <span className="px-1.5 py-0.5 rounded bg-zinc-800/90 border border-white/10 text-zinc-200 font-extrabold text-[10px] uppercase shrink-0">
                  {item.quality}
                </span>
              )}

              {/* Taille */}
              {item.size > 0 && (
                <span>
                  {formatBytes(item.size - item.sizeleft)} / {formatBytes(item.size)}
                </span>
              )}

              {/* Vitesse */}
              {item.speedFormatted && !isError && !isDone && (
                <span className="text-cyan-300 font-bold flex items-center gap-0.5">
                  <Zap size={10} className="fill-cyan-300 text-cyan-300" />
                  {item.speedFormatted}
                </span>
              )}

              {/* Temps restant */}
              {item.timeleft && item.timeleft !== '--' && !isError && !isDone && (
                <span className="flex items-center gap-0.5 text-zinc-300">
                  <Clock size={10} />
                  {item.timeleft}
                </span>
              )}

              {/* Téléchargement terminé */}
              {isDone && (
                <span className="text-emerald-400 font-bold flex items-center gap-1">
                  • TÉLÉCHARGEMENT TERMINÉ 🍿
                </span>
              )}
            </div>

            {/* Message d'erreur clair si applicable */}
            {item.errorMessage && (
              <div className="mt-1.5 p-1.5 px-2 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300 text-[11px] font-bold flex items-center gap-1.5">
                <AlertTriangle size={13} className="shrink-0 text-red-400" />
                <span className="leading-tight">{item.errorMessage}</span>
              </div>
            )}
          </div>

          {/* Barre de progression fine et nette en bas */}
          <div className="relative w-full h-1.5 bg-zinc-800/80 rounded-full overflow-hidden mt-2">
            <div 
              className={cn(
                "h-full rounded-full transition-all duration-300",
                isError
                  ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"
                  : isWarning
                  ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"
                  : isDone
                  ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                  : "bg-gradient-to-r from-blue-600 via-cyan-400 to-emerald-400"
              )}
              style={{ width: `${Math.max(2, Math.min(100, item.progress))}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function DownloadsScreen({ onShowClick, onOpenSettings }: Props) {
  const { downloads, lastUpdated, startPolling, stopPolling, removeDownload, clearAllDownloads } = useLiveDownloadStore();
  const { 
    sonarrUrl, 
    sonarrApiKey, 
    radarrUrl, 
    radarrApiKey, 
    qbittorrentUrl,
    qbittorrentUsername,
    qbittorrentPassword
  } = useDownloadConfigStore();
  const showToast = useToastStore(s => s.showToast);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMediaType, setSelectedMediaType] = useState<'all' | 'movie' | 'tv'>('all');
  const [selectedQuality, setSelectedQuality] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'seeders' | 'size' | 'date'>('seeders');
  const [torrents, setTorrents] = useState<C411Torrent[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [downloadingTorrentId, setDownloadingTorrentId] = useState<number | null>(null);
  const [isClearing, setIsClearing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isConfigured = Boolean(sonarrUrl || radarrUrl || qbittorrentUrl);

  useEffect(() => {
    startPolling(1000);
    return () => {
      stopPolling();
    };
  }, [startPolling, stopPolling]);

  // Recherche libre C411
  const performSearch = async (queryText: string) => {
    if (!queryText.trim()) {
      setTorrents([]);
      setHasSearched(false);
      return;
    }
    setIsSearching(true);
    try {
      const results = await searchC411Torrents({
        query: queryText.trim(),
        mediaType: selectedMediaType === 'all' ? undefined : selectedMediaType
      });
      setTorrents(results);
      setHasSearched(true);
    } catch (e) {
      console.error(e);
      setTorrents([]);
      setHasSearched(true);
      showToast('Erreur lors de la recherche de torrents', 'error');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSendTorrentToClient = async (torrent: C411Torrent) => {
    setDownloadingTorrentId(torrent.id);

    let clientToUse: 'sonarr' | 'radarr' | 'qbittorrent' | null = null;
    let url = '';
    let apiKey = '';
    let username = '';
    let password = '';

    const isTv = selectedMediaType === 'tv' || /(s\d+|saison|season|e\d+)/i.test(torrent.name);
    
    if (isTv && sonarrUrl && sonarrApiKey) {
      clientToUse = 'sonarr';
      url = sonarrUrl;
      apiKey = sonarrApiKey;
    } else if (!isTv && radarrUrl && radarrApiKey) {
      clientToUse = 'radarr';
      url = radarrUrl;
      apiKey = radarrApiKey;
    } else if (qbittorrentUrl) {
      clientToUse = 'qbittorrent';
      url = qbittorrentUrl;
      username = qbittorrentUsername;
      password = qbittorrentPassword;
    }

    if (!clientToUse) {
      if (torrent.magnetUri) {
        window.location.href = torrent.magnetUri;
        showToast('Ouverture du client BitTorrent local...', 'info');
      } else {
        showToast('Aucun client de téléchargement configuré.', 'error');
      }
      setDownloadingTorrentId(null);
      return;
    }

    // Ajout optimiste
    useLiveDownloadStore.getState().addOptimisticDownload({
      mediaType: isTv ? 'tv' : 'movie',
      title: torrent.name,
      releaseTitle: torrent.name,
      downloadClient: clientToUse === 'sonarr' ? 'Sonarr' : clientToUse === 'radarr' ? 'Radarr' : 'qBittorrent',
      statusText: `Envoi à ${clientToUse}...`
    });

    try {
      const result = await pushReleaseDirectly({
        service: clientToUse,
        url,
        apiKey,
        username,
        password,
        torrent,
        mediaType: isTv ? 'tv' : 'movie',
        mediaInfo: {
          title: torrent.name
        }
      });

      if (result.success) {
        showToast(result.message, 'success');
        setSearchQuery('');
        setTorrents([]);
        useLiveDownloadStore.getState().startPolling(1000);
        useLiveDownloadStore.getState().fetchDownloads();
      } else {
        showToast(result.message, 'error');
      }
    } catch (err: any) {
      showToast(err?.message || "Erreur lors de l'envoi au client", 'error');
    } finally {
      setDownloadingTorrentId(null);
    }
  };

  const handleRemoveItem = async (item: LiveDownloadItem) => {
    setDeletingId(item.id);
    try {
      const success = await removeDownload(item);
      if (success) {
        showToast(`Téléchargement « ${item.title} » retiré`, 'info');
      }
    } catch {
      showToast('Erreur lors de la suppression', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const handleClearAll = async () => {
    if (downloads.length === 0) return;
    setIsClearing(true);
    try {
      await clearAllDownloads();
      showToast('Historique des téléchargements nettoyé', 'success');
    } catch {
      showToast('Erreur lors du nettoyage', 'error');
    } finally {
      setIsClearing(false);
    }
  };

  const filteredTorrents = useMemo(() => {
    let list = [...torrents];

    if (selectedQuality !== 'all') {
      list = list.filter(t => {
        const q = (t.quality || '').toLowerCase();
        const n = t.name.toLowerCase();
        if (selectedQuality === '2160p' || selectedQuality === '4k') {
          return q.includes('2160') || q.includes('4k') || n.includes('2160p') || n.includes('4k') || n.includes('uhd');
        }
        if (selectedQuality === '1080p') {
          return q.includes('1080') || n.includes('1080p') || n.includes('1080i');
        }
        if (selectedQuality === '720p') {
          return q.includes('720') || n.includes('720p');
        }
        return true;
      });
    }

    list.sort((a, b) => {
      if (sortBy === 'seeders') return (b.seeders || 0) - (a.seeders || 0);
      if (sortBy === 'size') return (b.size || 0) - (a.size || 0);
      if (sortBy === 'date') return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      return 0;
    });

    return list;
  }, [torrents, selectedQuality, sortBy]);

  const hasActiveDownloads = downloads.length > 0;
  const isSearchActive = searchQuery.trim().length > 0;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-premium-ambient text-white overflow-hidden select-none">
      {/* 1. Header épuré sans boutons encombrants */}
      <div className="shrink-0 px-4 sm:px-6 pt-4 pb-3 border-b border-white/5 bg-zinc-950/70 backdrop-blur-xl flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <SeenItLogo className="w-8 h-8" />
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              Télécharger
            </h1>
            <p className="text-[11px] sm:text-xs text-zinc-400">
              {isSearchActive 
                ? 'Recherche libre de torrents' 
                : 'Suivi en temps réel Sonarr, Radarr & qBittorrent'}
            </p>
          </div>
        </div>

        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="w-9 h-9 rounded-xl bg-zinc-900/80 border border-white/10 hover:bg-zinc-800 text-zinc-400 hover:text-white flex items-center justify-center transition-colors active:scale-95 cursor-pointer"
            title="Paramètres des serveurs de téléchargement"
          >
            <Settings size={16} />
          </button>
        )}
      </div>

      {/* 2. Barre de recherche libre intégrée (comme dans Explorer) */}
      <div className="px-4 sm:px-6 py-3 bg-zinc-950/40 border-b border-white/5 shrink-0 space-y-2.5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            performSearch(searchQuery);
          }}
          className="flex gap-2"
        >
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (e.target.value.trim().length >= 3) {
                  performSearch(e.target.value);
                }
              }}
              placeholder="Rechercher un torrent libre, film, série (ex: Dexter S04, Dune)..."
              className="w-full pl-10 pr-9 py-2.5 bg-zinc-900/90 border border-white/10 focus:border-[#E5A93D] rounded-xl text-xs sm:text-sm text-white placeholder-zinc-500 focus:outline-none transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setTorrents([]);
                  setHasSearched(false);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 p-0.5"
              >
                <X size={15} />
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={isSearching || !searchQuery.trim()}
            className="px-4 py-2.5 bg-[#E5A93D] hover:bg-[#d4972e] disabled:opacity-50 text-zinc-950 font-black text-xs sm:text-sm rounded-xl flex items-center gap-1.5 transition-all active:scale-95 shrink-0 cursor-pointer shadow-md shadow-[#E5A93D]/10"
          >
            {isSearching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
            <span className="hidden sm:inline">Chercher</span>
          </button>
        </form>

        {/* Filtres contextuels de recherche si recherche active */}
        {isSearchActive && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
            {/* Média */}
            <div className="flex bg-zinc-900/80 p-0.5 rounded-lg border border-white/10 shrink-0">
              <button
                type="button"
                onClick={() => setSelectedMediaType('all')}
                className={cn("px-2.5 py-1 rounded-md font-bold transition-colors text-[11px]", selectedMediaType === 'all' ? "bg-[#E5A93D] text-zinc-950" : "text-zinc-400 hover:text-white")}
              >
                Tout
              </button>
              <button
                type="button"
                onClick={() => setSelectedMediaType('movie')}
                className={cn("px-2.5 py-1 rounded-md font-bold transition-colors text-[11px]", selectedMediaType === 'movie' ? "bg-[#E5A93D] text-zinc-950" : "text-zinc-400 hover:text-white")}
              >
                Films
              </button>
              <button
                type="button"
                onClick={() => setSelectedMediaType('tv')}
                className={cn("px-2.5 py-1 rounded-md font-bold transition-colors text-[11px]", selectedMediaType === 'tv' ? "bg-[#E5A93D] text-zinc-950" : "text-zinc-400 hover:text-white")}
              >
                Séries
              </button>
            </div>

            {/* Qualité */}
            <div className="flex bg-zinc-900/80 p-0.5 rounded-lg border border-white/10 shrink-0">
              {['all', '1080p', '4k', '720p'].map(q => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setSelectedQuality(q)}
                  className={cn("px-2 py-1 rounded-md font-bold transition-colors text-[11px] uppercase", selectedQuality === q ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-white")}
                >
                  {q === 'all' ? 'Toutes' : q}
                </button>
              ))}
            </div>

            {/* Tri */}
            <div className="flex bg-zinc-900/80 p-0.5 rounded-lg border border-white/10 shrink-0 ml-auto">
              <button
                type="button"
                onClick={() => setSortBy('seeders')}
                className={cn("px-2 py-1 rounded-md font-bold transition-colors text-[11px]", sortBy === 'seeders' ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-white")}
              >
                Seeds
              </button>
              <button
                type="button"
                onClick={() => setSortBy('size')}
                className={cn("px-2 py-1 rounded-md font-bold transition-colors text-[11px]", sortBy === 'size' ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-white")}
              >
                Taille
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 3. Corps principal : Liste de recherche OU Liste des Téléchargements */}
      <div className="flex-1 overflow-y-auto px-3.5 sm:px-6 py-4 space-y-3 pb-28">
        {!isConfigured && (
          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-start gap-3 mb-3">
            <AlertCircle size={18} className="shrink-0 mt-0.5 text-amber-400" />
            <div className="flex-1">
              <p className="font-bold text-amber-200">Serveurs de téléchargement non configurés</p>
              <p className="mt-0.5 text-amber-300/80 leading-relaxed">
                Renseignez vos identifiants Sonarr, Radarr ou qBittorrent dans les Paramètres pour activer les téléchargements 1-clic.
              </p>
            </div>
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-200 font-bold hover:bg-amber-500/30 transition-colors shrink-0"
              >
                Configurer
              </button>
            )}
          </div>
        )}

        {/* SI RECHERCHE ACTIVE : RÉSULTATS TORRENTS C411 */}
        {isSearchActive ? (
          <div>
            {isSearching ? (
              <div className="py-16 flex flex-col items-center justify-center gap-3 text-zinc-400">
                <Loader2 size={32} className="animate-spin text-[#E5A93D]" />
                <p className="text-xs font-bold">Recherche de torrents en cours...</p>
              </div>
            ) : filteredTorrents.length > 0 ? (
              <div className="space-y-2.5">
                <p className="text-xs font-bold text-zinc-400 px-1">
                  {filteredTorrents.length} torrent(s) trouvé(s) pour « {searchQuery} »
                </p>
                {filteredTorrents.map((torrent) => {
                  const isDownloading = downloadingTorrentId === torrent.id;
                  const isTv = selectedMediaType === 'tv' || /(s\d+|saison|season|e\d+)/i.test(torrent.name);

                  return (
                    <div
                      key={torrent.id}
                      className="p-3 sm:p-3.5 rounded-2xl bg-[#121214] border border-white/10 hover:border-white/20 transition-all flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={cn(
                            "px-1.5 py-0.5 rounded text-[9px] font-black uppercase shrink-0 border",
                            isTv ? "bg-purple-500/20 text-purple-300 border-purple-500/30" : "bg-amber-500/20 text-amber-300 border-amber-500/30"
                          )}>
                            {isTv ? 'Série' : 'Film'}
                          </span>

                          {torrent.quality && (
                            <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[9px] font-extrabold border border-white/10 uppercase shrink-0">
                              {torrent.quality}
                            </span>
                          )}

                          <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                            <ArrowDown size={11} /> {torrent.seeders || 0} seeds
                          </span>

                          <span className="text-[11px] font-medium text-zinc-400">
                            {formatTorrentSize(torrent.size)}
                          </span>
                        </div>

                        <h4 className="font-extrabold text-xs sm:text-sm text-white mt-1 leading-snug break-words">
                          {torrent.name}
                        </h4>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleSendTorrentToClient(torrent)}
                        disabled={isDownloading}
                        className="px-3 py-2 rounded-xl bg-[#E5A93D] hover:bg-[#d4972e] text-zinc-950 font-black text-xs flex items-center gap-1.5 transition-all active:scale-95 shrink-0 cursor-pointer shadow-md shadow-[#E5A93D]/10 disabled:opacity-50"
                      >
                        {isDownloading ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Download size={14} />
                        )}
                        <span className="hidden sm:inline">Télécharger</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : hasSearched ? (
              <div className="py-16 flex flex-col items-center justify-center text-center p-6 text-zinc-400">
                <Search size={32} className="text-zinc-600 mb-2" />
                <p className="text-sm font-bold text-white mb-1">Aucun torrent trouvé</p>
                <p className="text-xs text-zinc-500 max-w-xs">
                  Vérifiez l'orthographe ou essayez avec un titre plus court.
                </p>
              </div>
            ) : null}
          </div>
        ) : (
          /* SI PAS DE RECHERCHE : LISTE DES TÉLÉCHARGEMENTS EN DIRECT */
          <div className="space-y-3">
            {downloads.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 my-auto min-h-[320px]">
                <div className="w-16 h-16 rounded-3xl bg-zinc-900 border border-white/10 flex items-center justify-center text-zinc-500 mb-4 shadow-xl">
                  <Download size={28} className="text-zinc-500" />
                </div>
                <h3 className="text-base font-bold text-white mb-1">Aucun téléchargement en cours</h3>
                <p className="text-xs text-zinc-400 max-w-xs mb-5 leading-relaxed">
                  Lancez un téléchargement 1-clic depuis une fiche film ou épisode, ou utilisez la barre de recherche ci-dessus.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between px-1 mb-1 text-xs text-zinc-400">
                  <span className="font-bold">
                    {downloads.length} élément{downloads.length > 1 ? 's' : ''} en file d'attente
                  </span>
                  <span className="text-[11px] text-zinc-500">
                    Glisser vers la droite pour supprimer
                  </span>
                </div>

                <div className="space-y-3">
                  {downloads.map((item) => (
                    <SwipeableItem
                      key={item.id}
                      item={item}
                      onShowClick={onShowClick}
                      onRemove={handleRemoveItem}
                      isDeleting={deletingId === item.id}
                    />
                  ))}
                </div>

                {/* Bouton Nettoyer placé discrètement sous la liste */}
                <div className="pt-4 flex justify-center">
                  <button
                    type="button"
                    onClick={handleClearAll}
                    disabled={isClearing}
                    className="px-4 py-2 rounded-xl border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs font-bold flex items-center gap-2 transition-all active:scale-95 cursor-pointer disabled:opacity-50"
                  >
                    <Trash2 size={13} className={cn(isClearing && "animate-spin text-red-400")} />
                    <span>Nettoyer l'historique des téléchargements</span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
