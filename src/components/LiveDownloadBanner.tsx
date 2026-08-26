import React from 'react';
import { Download, Zap, Clock, HardDrive, CheckCircle2, ArrowDownCircle, AlertTriangle, AlertCircle } from 'lucide-react';
import { LiveDownloadItem, formatBytes } from '../services/sonarrRadarr';

interface LiveDownloadBannerProps {
  items: LiveDownloadItem[];
  compact?: boolean;
}

export const LiveDownloadBanner: React.FC<LiveDownloadBannerProps> = ({ items, compact = false }) => {
  if (!items || items.length === 0) return null;

  // Si compact (par exemple dans une carte d'épisode ou en badge)
  if (compact) {
    const item = items[0];
    const isError = item.status === 'error' || Boolean(item.errorMessage);
    const isWarning = item.status === 'warning';

    return (
      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold shadow-md backdrop-blur-sm ${
        isError 
          ? 'bg-red-950/80 border border-red-500/60 text-red-200' 
          : isWarning
          ? 'bg-amber-950/80 border border-amber-500/60 text-amber-200'
          : 'bg-blue-950/80 border border-blue-500/50 text-blue-200 animate-pulse'
      }`}>
        {isError ? (
          <AlertCircle size={13} className="text-red-400 shrink-0" />
        ) : isWarning ? (
          <AlertTriangle size={13} className="text-amber-400 shrink-0" />
        ) : (
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400"></span>
          </span>
        )}
        <span className="text-white font-extrabold">{isError ? 'Erreur' : `${item.progress}%`}</span>
        {item.speedFormatted && !isError && (
          <span className="text-cyan-300 font-semibold border-l border-blue-700/60 pl-1.5">{item.speedFormatted}</span>
        )}
        {item.timeleft && item.timeleft !== '--' && !isError && (
          <span className="text-zinc-300 text-[10px] border-l border-blue-700/60 pl-1.5">{item.timeleft}</span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2.5 my-3">
      {items.map((item) => {
        const isError = item.status === 'error' || Boolean(item.errorMessage);
        const isWarning = item.status === 'warning';
        const downloadedBytes = item.size > 0 ? Math.max(0, item.size - item.sizeleft) : 0;
        const totalSizeFormatted = item.size > 0 ? formatBytes(item.size) : '';
        const downloadedFormatted = item.size > 0 ? formatBytes(downloadedBytes) : '';

        return (
          <div
            key={item.id}
            className={`relative overflow-hidden border rounded-2xl p-3.5 sm:p-4 shadow-xl backdrop-blur-md transition-all animate-in fade-in duration-200 ${
              isError
                ? 'bg-gradient-to-r from-red-950/40 via-zinc-900 to-red-950/30 border-red-500/50'
                : isWarning
                ? 'bg-gradient-to-r from-amber-950/40 via-zinc-900 to-amber-950/30 border-amber-500/50'
                : 'bg-gradient-to-r from-zinc-900 via-blue-950/40 to-zinc-900 border-blue-500/40'
            }`}
          >
            {/* Ligne d'animation lumineuse au sommet */}
            <div className={`absolute top-0 left-0 right-0 h-[2px] ${
              isError
                ? 'bg-gradient-to-r from-red-600 via-red-400 to-rose-600'
                : isWarning
                ? 'bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600'
                : 'bg-gradient-to-r from-blue-500 via-cyan-400 to-indigo-500 animate-pulse'
            }`} />

            {/* En-tête : Badge d'état + Client / Vitesse */}
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                {isError ? (
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                  </span>
                ) : isWarning ? (
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-400"></span>
                  </span>
                ) : (
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-400"></span>
                  </span>
                )}
                
                <span className={`text-[11px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border flex items-center gap-1 ${
                  isError
                    ? 'text-red-300 bg-red-950/80 border-red-500/40'
                    : isWarning
                    ? 'text-amber-300 bg-amber-950/80 border-amber-500/40'
                    : 'text-cyan-300 bg-blue-950/80 border-blue-500/30'
                }`}>
                  {isError ? (
                    <AlertCircle size={12} className="text-red-400" />
                  ) : isWarning ? (
                    <AlertTriangle size={12} className="text-amber-400" />
                  ) : (
                    <ArrowDownCircle size={12} className="text-cyan-400" />
                  )}
                  {item.statusText || (isError ? 'Erreur' : 'Téléchargement')}
                </span>

                {item.downloadClient && (
                  <span className="hidden sm:inline-block text-[10px] font-bold text-zinc-400 bg-zinc-800/80 px-2 py-0.5 rounded-md border border-zinc-700/50">
                    via {item.downloadClient}
                  </span>
                )}
              </div>

              {item.speedFormatted && !isError && (
                <div className="flex items-center gap-1 text-xs font-black text-cyan-300 bg-cyan-950/60 border border-cyan-500/30 px-2.5 py-0.5 rounded-full shadow-sm">
                  <Zap size={13} className="text-cyan-400 animate-bounce" />
                  <span>{item.speedFormatted}</span>
                </div>
              )}
            </div>

            {/* Message d'erreur détaillé si présent (ex: Disque plein) */}
            {item.errorMessage && (
              <div className="mb-2.5 p-2 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center gap-2 text-xs font-bold text-red-300">
                <AlertTriangle size={14} className="shrink-0 text-red-400" />
                <span className="leading-snug">{item.errorMessage}</span>
              </div>
            )}

            {/* Titre de la release ou épisode */}
            <div className="text-xs sm:text-sm font-bold text-white line-clamp-1 mb-2.5 flex items-center gap-1.5">
              <span className={isError ? "text-red-400 shrink-0" : "text-blue-400 shrink-0"}>❖</span>
              <span className="truncate">{item.releaseTitle || item.title}</span>
            </div>

            {/* Barre de progression avec effet néon */}
            <div className="space-y-1.5">
              <div className="relative w-full h-3 bg-zinc-950/80 rounded-full overflow-hidden p-0.5 border border-zinc-700/60 shadow-inner">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    isError
                      ? 'bg-gradient-to-r from-red-600 to-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.6)]'
                      : isWarning
                      ? 'bg-gradient-to-r from-amber-600 to-yellow-400 shadow-[0_0_12px_rgba(251,191,36,0.6)]'
                      : 'bg-gradient-to-r from-blue-600 via-cyan-400 to-emerald-400 shadow-[0_0_12px_rgba(34,211,238,0.7)]'
                  }`}
                  style={{ width: `${Math.max(2, Math.min(100, item.progress))}%` }}
                />
              </div>

              {/* Détails : Pourcentage, Taille téléchargée, Temps restant */}
              <div className="flex items-center justify-between text-[11px] sm:text-xs font-bold text-zinc-300 pt-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-white font-black text-xs sm:text-sm">{item.progress}%</span>
                  {totalSizeFormatted && (
                    <span className="text-zinc-400 font-medium text-[10px] sm:text-[11px] flex items-center gap-1">
                      <HardDrive size={12} className="text-zinc-500" />
                      {downloadedFormatted} / {totalSizeFormatted}
                    </span>
                  )}
                </div>

                {item.timeleft && item.timeleft !== '--' && !isError && (
                  <div className="flex items-center gap-1 text-cyan-200 font-bold bg-zinc-900/90 px-2 py-0.5 rounded-md border border-zinc-800">
                    <Clock size={12} className="text-blue-400" />
                    <span>Restant : {item.timeleft}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
