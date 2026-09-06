import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useUpdateStore } from '../store/updateStore';
import { downloadAndInstallApk, UpdateProgress } from '../services/appUpdater';
import { ReleaseChangelogViewer } from './ChangelogViewer';
import { 
  Download, 
  Sparkles, 
  X, 
  Loader2, 
  CheckCircle2, 
  AlertCircle, 
  ExternalLink,
  RefreshCw,
  ArrowRight
} from 'lucide-react';
import { cn } from '../lib/utils';

export function AppUpdateBanner() {
  const { latestRelease, hasUpdate, checkForUpdates, dismissUpdate, updateModalRequestId } = useUpdateStore();
  const [showModal, setShowModal] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<UpdateProgress | null>(null);

  // Swipe up gesture state
  const [startY, setStartY] = useState<number | null>(null);
  const [dragY, setDragY] = useState(0);
  const [isDismissing, setIsDismissing] = useState(false);

  // Automatically check for updates on app startup (force fetch bypassing 10 min cache)
  useEffect(() => {
    checkForUpdates(true);
  }, [checkForUpdates]);

  useEffect(() => {
    if (updateModalRequestId > 0 && hasUpdate && latestRelease) {
      setShowModal(true);
    }
  }, [hasUpdate, latestRelease, updateModalRequestId]);

  if (!hasUpdate || !latestRelease) {
    return null;
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    setStartY(e.touches[0].clientY);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startY === null) return;
    const currentY = e.touches[0].clientY;
    const deltaY = currentY - startY;
    // Only drag upwards
    if (deltaY < 0) {
      setDragY(deltaY);
    }
  };

  const handleTouchEnd = () => {
    if (startY === null) return;
    if (dragY < -30) {
      // Swiped up sufficiently -> dismiss
      setIsDismissing(true);
      setTimeout(() => {
        dismissUpdate(latestRelease.version);
        setDragY(0);
        setIsDismissing(false);
      }, 200);
    } else {
      setDragY(0);
    }
    setStartY(null);
  };

  const handleBannerClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isDismissing) {
      setShowModal(true);
    }
  };

  const handleStartUpdate = async () => {
    setDownloadProgress({
      percent: 5,
      status: 'downloading',
      message: 'Initialisation du téléchargement...'
    });

    const result = await downloadAndInstallApk(
      latestRelease,
      (progress) => setDownloadProgress(progress)
    );

    if (!result.success) {
      setDownloadProgress({
        percent: 0,
        status: 'error',
        message: result.error || 'Erreur lors du téléchargement'
      });
    }
  };

  return (
    <>
      {/* Top Floating Discreet Notification Capsule */}
      <div 
        id="seenit-update-banner"
        className="fixed left-4 right-4 z-50 animate-in slide-in-from-top duration-300 max-w-md mx-auto cursor-pointer select-none"
        style={{ 
          top: 'calc(env(safe-area-inset-top, 32px) + 12px)',
          transform: `translateY(${dragY}px)`,
          opacity: isDismissing ? 0 : 1,
          transition: startY !== null ? 'none' : 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease-out'
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleBannerClick}
      >
        <div className="bg-[#181822]/95 backdrop-blur-md border border-amber-500/30 rounded-2xl p-3 shadow-xl shadow-amber-500/10 flex items-center justify-between gap-2.5 relative overflow-hidden active:scale-[0.99] transition-transform">
          {/* Subtle Swipe indicator bar */}
          <div className="absolute top-1 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-white/20 rounded-full pointer-events-none" />

          <div className="flex items-center gap-2.5 min-w-0 pt-0.5 flex-1">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 border border-amber-500/30">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-white flex items-center gap-1.5">
                <span>Version {latestRelease.version}</span>
                <span className="px-1.5 py-0.5 text-[9px] bg-amber-500 text-black font-extrabold rounded-full shrink-0">
                  NEW
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 whitespace-nowrap overflow-hidden text-ellipsis">
                Découvrez les nouveautés
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowModal(true);
              }}
              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 active:scale-95 text-black text-xs font-bold rounded-xl flex items-center gap-1 shadow-md shadow-amber-500/20 transition-all cursor-pointer"
            >
              <span>Mettre à jour</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Detailed Changelog Modal - Rendered via Portal directly to document.body to stay above all navigation bars */}
      {showModal && createPortal(
        <div 
          className="fixed inset-0 z-[99999] bg-black/85 backdrop-blur-md flex items-center justify-center p-2.5 pb-6 sm:p-4 animate-in fade-in duration-200"
          onClick={() => {
            if (downloadProgress?.status !== 'downloading') {
              setShowModal(false);
            }
          }}
        >
          <div 
            className="bg-[#121218] border border-white/10 rounded-3xl w-full max-w-lg sm:max-w-2xl overflow-hidden shadow-[0_25px_60px_-15px_rgba(0,0,0,0.95)] flex flex-col my-auto animate-in zoom-in-95 duration-200 shrink-0"
            onClick={(e) => e.stopPropagation()}
            style={{ maxHeight: 'min(94vh, calc(100dvh - 16px))' }}
          >
            {/* Header - Fixed */}
            <div className="p-4 sm:p-5 pb-3 bg-gradient-to-b from-amber-500/10 to-transparent border-b border-white/5 flex items-start justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-500 flex items-center justify-center text-black shadow-lg shadow-amber-500/30 shrink-0">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                    Mise à jour disponible !
                  </h3>
                  <p className="text-xs text-amber-400/90 font-medium">
                    SeenIt v{latestRelease.version} est prête
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  if (downloadProgress?.status !== 'downloading') {
                    setShowModal(false);
                  }
                }}
                className="text-zinc-400 hover:text-white p-1.5 rounded-full hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Body Content */}
            <div 
              className="p-4 sm:p-5 overflow-y-auto min-h-0 space-y-4 flex-1 text-sm text-zinc-300 custom-scrollbar overscroll-contain touch-pan-y"
              style={{ 
                WebkitOverflowScrolling: 'touch',
                touchAction: 'pan-y',
                overscrollBehavior: 'contain'
              }}
            >
              <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Notes de version
              </div>
              
              <div className="bg-black/40 border border-white/5 rounded-2xl p-4 max-h-80 sm:max-h-[28rem] md:max-h-[32rem] overflow-y-auto custom-scrollbar">
                <ReleaseChangelogViewer release={latestRelease} />
              </div>

              {/* Download Progress / Status Bar if active */}
              {downloadProgress && downloadProgress.status !== 'idle' && (
                <div className={cn(
                  "border rounded-2xl p-3.5 space-y-2 animate-in fade-in duration-200",
                  downloadProgress.status === 'error' 
                    ? "bg-red-500/10 border-red-500/30" 
                    : "bg-amber-500/10 border-amber-500/30"
                )}>
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className={cn(
                      "flex items-center gap-2",
                      downloadProgress.status === 'error' ? "text-red-300" : "text-amber-300"
                    )}>
                      {downloadProgress.status === 'downloading' && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400 shrink-0" />
                      )}
                      {downloadProgress.status === 'installing' && (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      )}
                      {downloadProgress.status === 'done' && (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      )}
                      {downloadProgress.status === 'error' && (
                        <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      )}
                      <span className="break-words line-clamp-2">{downloadProgress.message}</span>
                    </span>
                    <span className={downloadProgress.status === 'error' ? "text-red-400 font-mono" : "text-amber-400 font-mono"}>
                      {downloadProgress.percent}%
                    </span>
                  </div>

                  <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
                    <div 
                      className={cn(
                        "h-full rounded-full transition-all duration-300",
                        downloadProgress.status === 'error' ? "bg-red-500" : "bg-gradient-to-r from-amber-400 to-amber-500"
                      )}
                      style={{ width: `${downloadProgress.percent}%` }}
                    />
                  </div>

                  {downloadProgress.status === 'error' && (
                    <div className="pt-1 flex items-center justify-between text-[11px]">
                      <span className="text-zinc-400">Besoin d'aide ?</span>
                      <a
                        href={latestRelease.browserDownloadUrl || latestRelease.htmlUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-amber-400 hover:text-amber-300 underline flex items-center gap-1 font-medium"
                      >
                        <span>Ouvrir dans le navigateur</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-1.5 text-xs text-zinc-400">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Installation automatique sans perte de vos données</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Ouverture directe de l'installeur Android</span>
                </div>
              </div>
            </div>

            {/* Actions - Fixed at Bottom */}
            <div className="p-3.5 sm:p-4 bg-black/60 border-t border-white/5 flex gap-2.5 shrink-0 z-10">
              <button
                disabled={downloadProgress?.status === 'downloading'}
                onClick={() => {
                  dismissUpdate(latestRelease.version);
                  setShowModal(false);
                }}
                className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 active:scale-98 disabled:opacity-50 text-zinc-300 text-xs font-semibold rounded-xl transition-all cursor-pointer"
              >
                Plus tard
              </button>
              <button
                disabled={downloadProgress?.status === 'downloading'}
                onClick={handleStartUpdate}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 active:scale-98 disabled:opacity-50 text-black text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-lg shadow-amber-500/25 transition-all cursor-pointer"
              >
                {downloadProgress?.status === 'downloading' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Téléchargement...</span>
                  </>
                ) : downloadProgress?.status === 'error' ? (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    <span>Réessayer</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Installer maintenant</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
