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
  Play,
  Filter,
  Check
} from 'lucide-react';
import { useLiveDownloadStore } from '../store/liveDownloadStore';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { formatBytes, formatSpeed, formatSecondsToETA, LiveDownloadItem } from '../services/sonarrRadarr';
import { useToastStore } from '../store/toastStore';
import { DownloadModal } from '../components/DownloadModal';
import { cn } from '../lib/utils';

interface Props {
  onShowClick?: (id: any, mediaType?: 'tv' | 'movie') => void;
  onOpenSettings?: () => void;
}

export function DownloadsScreen({ onShowClick, onOpenSettings }: Props) {
  const { downloads, isLoading, lastUpdated, fetchDownloads, startPolling, stopPolling, removeDownload, clearAllDownloads } = useLiveDownloadStore();
  const { sonarrUrl, radarrUrl, qbittorrentUrl } = useDownloadConfigStore();
  const showToast = useToastStore(s => s.showToast);

  const [isFreeDownloadModalOpen, setIsFreeDownloadModalOpen] = useState(false);
  const [freeQuery, setFreeQuery] = useState('');
  const [isClearing, setIsClearing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isConfigured = Boolean(sonarrUrl || radarrUrl || qbittorrentUrl);

  useEffect(() => {
    startPolling(2000);
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

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-premium-ambient text-white overflow-hidden select-none">
      {/* Header */}
      <div className="shrink-0 px-4 sm:px-6 pt-4 pb-3 border-b border-white/5 bg-zinc-950/60 backdrop-blur-xl flex items-center justify-between z-10">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
              Téléchargements
            </h1>
            {downloads.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-blue-500/20 border border-blue-500/30 text-blue-400 text-xs font-bold animate-pulse">
                {downloads.length} en cours
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Suivi en direct de Sonarr, Radarr et qBittorrent
          </p>
        </div>

        <div className="flex items-center gap-2">
          {downloads.length > 0 && (
            <button
              type="button"
              onClick={handleClearAll}
              disabled={isClearing}
              className="px-3 py-1.5 rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer disabled:opacity-50"
              title="Nettoyer / Vider la liste"
            >
              <Trash2 size={13} className={cn(isClearing && "animate-spin")} />
              <span>Nettoyer</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsFreeDownloadModalOpen(true)}
            className="px-3 py-1.5 rounded-xl border border-[#E5A93D]/30 bg-[#E5A93D]/10 hover:bg-[#E5A93D]/20 text-[#E5A93D] text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
            title="Téléchargement libre de torrents"
          >
            <Search size={13} />
            <span>Recherche libre</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-3 pb-24">
        {!isConfigured && (
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-start gap-3 mb-3">
            <AlertCircle size={18} className="shrink-0 mt-0.5 text-amber-400" />
            <div className="flex-1">
              <p className="font-bold text-amber-200">Aucun serveur de téléchargement configuré</p>
              <p className="mt-0.5 text-amber-300/80">
                Renseignez les adresses et clés de Sonarr, Radarr ou qBittorrent dans les Paramètres pour activer les téléchargements automatiques et le suivi en direct.
              </p>
            </div>
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-200 font-bold hover:bg-amber-500/30 transition-colors"
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
              Dès qu'un téléchargement est lancé depuis une fiche de série, un film ou en recherche libre, il apparaîtra ici avec sa vitesse et son temps restant.
            </p>
            <button
              type="button"
              onClick={() => setIsFreeDownloadModalOpen(true)}
              className="px-4 py-2.5 rounded-xl bg-[#E5A93D] hover:bg-[#F5C518] text-black font-bold text-xs flex items-center gap-2 transition-all shadow-lg shadow-[#E5A93D]/20 active:scale-95 cursor-pointer"
            >
              <Search size={14} className="stroke-[2.5]" />
              <span>Lancer un téléchargement libre</span>
            </button>
          </div>
        ) : (
          <div className="space-y-2.5">
            {downloads.map((item) => {
              const isDeleting = deletingId === item.id;
              const isDone = item.progress >= 100;

              return (
                <div
                  key={item.id}
                  onClick={() => {
                    if (item.tmdbId && onShowClick) {
                      onShowClick(item.tmdbId, item.mediaType);
                    }
                  }}
                  className={cn(
                    "p-3.5 rounded-2xl bg-zinc-900/80 border border-white/10 hover:border-white/20 transition-all backdrop-blur-sm relative overflow-hidden group",
                    item.tmdbId && onShowClick ? "cursor-pointer" : ""
                  )}
                >
                  {/* Background progress tint */}
                  <div 
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-500/10 to-blue-500/5 transition-all duration-300 pointer-events-none"
                    style={{ width: `${Math.min(100, item.progress)}%` }}
                  />

                  <div className="relative z-10 flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border",
                        item.mediaType === 'tv' ? "bg-purple-500/10 border-purple-500/20 text-purple-400" : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                      )}>
                        {item.mediaType === 'tv' ? <Tv size={18} /> : <Film size={18} />}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                          <span className="font-bold text-sm text-white truncate max-w-[220px]">
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
                          <p className="text-[11px] text-zinc-400 truncate mb-1.5 font-mono">
                            {item.releaseTitle}
                          </p>
                        )}

                        {/* Stats Bar */}
                        <div className="flex items-center gap-3 text-[11px] font-semibold text-zinc-400 flex-wrap">
                          {item.speedFormatted ? (
                            <span className="text-blue-400 font-bold flex items-center gap-1">
                              <Zap size={11} className="fill-blue-400" />
                              {item.speedFormatted}
                            </span>
                          ) : null}

                          {item.timeleft ? (
                            <span className="flex items-center gap-1 text-zinc-400">
                              <Clock size={11} />
                              {item.timeleft}
                            </span>
                          ) : null}

                          {item.size > 0 && (
                            <span>
                              {formatBytes(item.size - item.sizeleft)} / {formatBytes(item.size)}
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
                        <X size={14} className={cn(isDeleting && "animate-spin")} />
                      </button>

                      <span className={cn(
                        "text-xs font-black",
                        isDone ? "text-emerald-400" : "text-blue-400"
                      )}>
                        {item.progress}%
                      </span>
                    </div>
                  </div>

                  {/* Linear Progress Bar */}
                  <div className="relative w-full h-1.5 bg-zinc-800 rounded-full mt-3 overflow-hidden">
                    <div 
                      className={cn(
                        "h-full rounded-full transition-all duration-300",
                        isDone ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-gradient-to-r from-blue-600 via-sky-400 to-blue-500"
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

      {/* Free Download Modal */}
      {isFreeDownloadModalOpen && (
        <DownloadModal
          isOpen={isFreeDownloadModalOpen}
          onClose={() => setIsFreeDownloadModalOpen(false)}
          title={freeQuery || 'Recherche'}
          mediaType="tv"
          totalSeasons={1}
          onSuccessToast={(msg) => showToast(msg, 'success')}
        />
      )}
    </div>
  );
}
