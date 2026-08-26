import React, { useState, useEffect } from 'react';
import { 
  Download, 
  Trash2, 
  Search, 
  CheckCircle2, 
  Clock, 
  Zap, 
  ArrowDown, 
  Settings, 
  Film, 
  Tv, 
  RefreshCw, 
  HardDrive,
  X,
  AlertCircle,
  AlertTriangle,
  Play,
  Filter,
  Check
} from 'lucide-react';
import { useLiveDownloadStore } from '../store/liveDownloadStore';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { formatBytes, formatSpeed, formatSecondsToETA, LiveDownloadItem } from '../services/sonarrRadarr';
import { useToastStore } from '../store/toastStore';
import { FreeDownloadScreen } from './FreeDownloadScreen';
import { SeenItLogo } from '../components/SeenItLogo';
import { cn } from '../lib/utils';

interface Props {
  onShowClick?: (id: any, mediaType?: 'tv' | 'movie') => void;
  onOpenSettings?: () => void;
}

export function DownloadsScreen({ onShowClick, onOpenSettings }: Props) {
  const { downloads, isLoading, lastUpdated, fetchDownloads, startPolling, stopPolling, removeDownload, clearAllDownloads } = useLiveDownloadStore();
  const { sonarrUrl, radarrUrl, qbittorrentUrl } = useDownloadConfigStore();
  const showToast = useToastStore(s => s.showToast);

  const [isFreeDownloadOpen, setIsFreeDownloadOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isConfigured = Boolean(sonarrUrl || radarrUrl || qbittorrentUrl);

  useEffect(() => {
    startPolling(1000);
    return () => {
      stopPolling();
    };
  }, [startPolling, stopPolling]);

  const handleRemoveItem = async (e: React.MouseEvent, item: LiveDownloadItem) => {
    e.stopPropagation();
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
      showToast('Liste des téléchargements nettoyée', 'success');
    } catch {
      showToast('Erreur lors du nettoyage', 'error');
    } finally {
      setIsClearing(false);
    }
  };

  if (isFreeDownloadOpen) {
    return (
      <FreeDownloadScreen 
        onBack={() => setIsFreeDownloadOpen(false)} 
        onShowClick={onShowClick}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-premium-ambient text-white overflow-hidden select-none">
      {/* Header */}
      <div className="shrink-0 px-4 sm:px-6 pt-4 pb-3 border-b border-white/5 bg-zinc-950/60 backdrop-blur-xl flex items-center justify-between z-10">
        <div>
          <div className="flex items-center gap-2">
            <SeenItLogo variant="horizontal" size={28} symbol="download" animated />
            <span className="text-[10px] font-extrabold text-zinc-400 bg-white/5 border border-white/10 px-2 py-0.5 rounded-full uppercase tracking-wider">Téléchargements</span>
            {downloads.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-blue-500/20 border border-blue-500/30 text-blue-400 text-xs font-bold animate-pulse">
                {downloads.length}
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Suivi en temps réel Sonarr, Radarr & qBittorrent
          </p>
        </div>

        <div className="flex items-center gap-2">
          {downloads.length > 0 && (
            <button
              type="button"
              onClick={handleClearAll}
              disabled={isClearing}
              className="px-2.5 py-1.5 rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer disabled:opacity-50"
              title="Nettoyer / Vider la liste"
            >
              <Trash2 size={13} className={cn(isClearing && "animate-spin")} />
              <span className="hidden sm:inline">Nettoyer</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsFreeDownloadOpen(true)}
            className="px-3 py-1.5 rounded-xl border border-zinc-700/80 bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
            title="Téléchargement libre de torrents"
          >
            <Search size={13} className="text-[#E5A93D]" />
            <span>Recherche libre</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto px-3.5 sm:px-6 py-4 space-y-3 pb-24">
        {!isConfigured && (
          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-start gap-3 mb-3">
            <AlertCircle size={18} className="shrink-0 mt-0.5 text-amber-400" />
            <div className="flex-1">
              <p className="font-bold text-amber-200">Serveurs de téléchargement non configurés</p>
              <p className="mt-0.5 text-amber-300/80 leading-relaxed">
                Renseignez vos identifiants Sonarr, Radarr ou qBittorrent dans les Paramètres pour activer les téléchargements automatiques 1-clic.
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

        {downloads.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 my-auto min-h-[360px]">
            <div className="w-16 h-16 rounded-3xl bg-zinc-900 border border-white/10 flex items-center justify-center text-zinc-500 mb-4 shadow-xl">
              <Download size={28} className="text-zinc-500" />
            </div>
            <h3 className="text-base font-bold text-white mb-1">Aucun téléchargement en cours</h3>
            <p className="text-xs text-zinc-400 max-w-xs mb-5 leading-relaxed">
              Dès qu'un téléchargement est lancé depuis une fiche ou un épisode, son avancement et sa vitesse apparaîtront ici toutes les secondes.
            </p>
            <button
              type="button"
              onClick={() => setIsFreeDownloadOpen(true)}
              className="px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white font-bold text-xs flex items-center gap-2 transition-all active:scale-95 cursor-pointer shadow-md"
            >
              <Search size={14} className="text-[#E5A93D]" />
              <span>Recherche libre de torrents</span>
            </button>
          </div>
        ) : (
          <div className="space-y-2.5">
            {downloads.map((item) => {
              const isDeleting = deletingId === item.id;
              const isDone = item.progress >= 100;
              const isError = item.status === 'error' || Boolean(item.errorMessage);
              const isWarning = item.status === 'warning';

              return (
                <div
                  key={item.id}
                  onClick={() => {
                    if (item.tmdbId && onShowClick) {
                      onShowClick(item.tmdbId, item.mediaType);
                    }
                  }}
                  className={cn(
                    "p-3.5 rounded-2xl border transition-all backdrop-blur-sm relative overflow-hidden group",
                    isError
                      ? "bg-gradient-to-r from-red-950/30 via-zinc-900 to-zinc-900 border-red-500/40"
                      : isWarning
                      ? "bg-gradient-to-r from-amber-950/30 via-zinc-900 to-zinc-900 border-amber-500/40"
                      : "bg-zinc-900/80 border-white/10 hover:border-white/20",
                    item.tmdbId && onShowClick ? "cursor-pointer" : ""
                  )}
                >
                  {/* Background progress tint */}
                  <div 
                    className={cn(
                      "absolute inset-y-0 left-0 transition-all duration-300 pointer-events-none",
                      isError
                        ? "bg-red-500/10"
                        : isWarning
                        ? "bg-amber-500/10"
                        : "bg-gradient-to-r from-blue-500/10 to-cyan-500/5"
                    )}
                    style={{ width: `${Math.min(100, item.progress)}%` }}
                  />

                  <div className="relative z-10 flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border",
                        isError
                          ? "bg-red-500/15 border-red-500/30 text-red-400"
                          : isWarning
                          ? "bg-amber-500/15 border-amber-500/30 text-amber-400"
                          : item.mediaType === 'tv'
                          ? "bg-purple-500/10 border-purple-500/20 text-purple-400"
                          : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                      )}>
                        {isError ? (
                          <AlertCircle size={18} />
                        ) : item.mediaType === 'tv' ? (
                          <Tv size={18} />
                        ) : (
                          <Film size={18} />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                          <span className="font-bold text-sm text-white truncate max-w-[200px] sm:max-w-xs">
                            {item.title}
                          </span>
                          <span className={cn(
                            "px-1.5 py-0.2 rounded text-[9px] font-extrabold uppercase",
                            item.downloadClient === 'Sonarr' ? "bg-sky-500/20 text-sky-300 border border-sky-500/30" :
                            item.downloadClient === 'Radarr' ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" :
                            "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                          )}>
                            {item.downloadClient || 'Client'}
                          </span>
                        </div>

                        {item.releaseTitle && item.releaseTitle !== item.title && (
                          <p className="text-[10px] sm:text-[11px] text-zinc-400 truncate mb-1 font-mono">
                            {item.releaseTitle}
                          </p>
                        )}

                        {/* Error Message Details if present (e.g. disk space full) */}
                        {item.errorMessage && (
                          <div className="my-1.5 p-1.5 px-2 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300 text-[11px] font-bold flex items-center gap-1.5">
                            <AlertTriangle size={13} className="shrink-0 text-red-400" />
                            <span className="leading-tight">{item.errorMessage}</span>
                          </div>
                        )}

                        {/* Stats Bar */}
                        <div className="flex items-center gap-2.5 text-[11px] font-semibold text-zinc-400 flex-wrap mt-1">
                          {item.speedFormatted && !isError ? (
                            <span className="text-cyan-300 font-bold flex items-center gap-1">
                              <Zap size={11} className="fill-cyan-300" />
                              {item.speedFormatted}
                            </span>
                          ) : null}

                          {item.timeleft && item.timeleft !== '--' && !isError ? (
                            <span className="flex items-center gap-1 text-zinc-400">
                              <Clock size={11} />
                              {item.timeleft}
                            </span>
                          ) : null}

                          {item.size > 0 && (
                            <span className="text-zinc-400">
                              {formatBytes(item.size - item.sizeleft)} / {formatBytes(item.size)}
                            </span>
                          )}

                          {item.statusText && (
                            <span className={cn(
                              "text-[10px] font-bold uppercase",
                              isError ? "text-red-400" : isWarning ? "text-amber-400" : "text-zinc-500"
                            )}>
                              • {item.statusText}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right side status & remove */}
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => handleRemoveItem(e, item)}
                        disabled={isDeleting}
                        className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                        title="Annuler / Retirer"
                      >
                        <X size={15} className={cn(isDeleting && "animate-spin")} />
                      </button>

                      <span className={cn(
                        "text-xs font-black",
                        isError ? "text-red-400" : isDone ? "text-emerald-400" : "text-cyan-400"
                      )}>
                        {isError ? 'Erreur' : `${item.progress}%`}
                      </span>
                    </div>
                  </div>

                  {/* Linear Progress Bar */}
                  <div className="relative w-full h-1.5 bg-zinc-800 rounded-full mt-2.5 overflow-hidden">
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
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

