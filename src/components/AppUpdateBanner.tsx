import React, { useState, useEffect } from 'react';
import { Download, Sparkles, X, ChevronRight, CheckCircle2, ArrowUpRight } from 'lucide-react';
import { useUpdateStore } from '../store/updateStore';
import { cn } from '../lib/utils';

export function AppUpdateBanner() {
  const { hasUpdate, latestRelease, dismissedVersion, dismissUpdate, checkForUpdates } = useUpdateStore();
  const [showModal, setShowModal] = useState(false);

  // Check for updates on startup
  useEffect(() => {
    checkForUpdates(false);
  }, [checkForUpdates]);

  // Automatically show modal on startup when an update is available (unless dismissed for this version)
  useEffect(() => {
    if (hasUpdate && latestRelease && dismissedVersion !== latestRelease.version) {
      setShowModal(true);
    }
  }, [hasUpdate, latestRelease, dismissedVersion]);

  if (!hasUpdate || !latestRelease) return null;
  if (dismissedVersion === latestRelease.version && !showModal) return null;

  const handleDownload = () => {
    if (latestRelease.apkDownloadUrl) {
      window.open(latestRelease.apkDownloadUrl, '_system');
    }
  };

  return (
    <>
      {/* Floating Discrete Update Bar */}
      <div className="relative mx-4 mt-2 mb-1 z-40 animate-in fade-in slide-in-from-top-2 duration-300">
        <div className="bg-gradient-to-r from-amber-500/20 via-amber-600/15 to-purple-600/20 border border-amber-500/30 backdrop-blur-md rounded-2xl p-3.5 shadow-xl shadow-black/40 flex items-center justify-between gap-3">
          <div 
            onClick={() => setShowModal(true)}
            className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/25 shrink-0">
              <Sparkles className="w-5 h-5 text-black animate-pulse" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-amber-300">
                  Mise à jour v{latestRelease.version} disponible
                </span>
                <span className="bg-amber-400/20 text-amber-300 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border border-amber-400/30">
                  Nouveau
                </span>
              </div>
              <p className="text-[11px] text-zinc-300 truncate">
                Appuyez pour voir les nouveautés et installer
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={handleDownload}
              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 active:scale-95 text-black text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-md shadow-amber-500/20 transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Installer</span>
            </button>
            <button
              onClick={() => dismissUpdate(latestRelease.version)}
              className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
              title="Ignorer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Detailed Changelog Modal */}
      {showModal && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div 
            className="bg-[#121218] border border-white/10 rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-5 pb-4 bg-gradient-to-b from-amber-500/10 to-transparent border-b border-white/5 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-amber-500 flex items-center justify-center text-black shadow-lg shadow-amber-500/30">
                  <Sparkles className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    Une nouvelle version est disponible !
                  </h3>
                  <p className="text-xs text-amber-400/90 font-medium">
                    SeenIt v{latestRelease.version} est prête à être installée
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="text-zinc-400 hover:text-white p-1 rounded-full hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Release Notes */}
            <div className="p-5 overflow-y-auto space-y-4 flex-1 text-sm text-zinc-300">
              <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Notes de version
              </div>
              
              <div className="bg-black/30 border border-white/5 rounded-2xl p-4 text-xs font-sans text-zinc-300 whitespace-pre-wrap leading-relaxed">
                {latestRelease.releaseNotes || "Améliorations des performances et corrections de bugs."}
              </div>

              <div className="space-y-2 text-xs text-zinc-400">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Installation rapide sans perte de vos données</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Téléchargement direct du fichier APK sécurisé</span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="p-4 bg-black/40 border-t border-white/5 flex gap-2.5">
              <button
                onClick={() => {
                  dismissUpdate(latestRelease.version);
                  setShowModal(false);
                }}
                className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold rounded-xl transition-colors"
              >
                Plus tard
              </button>
              <button
                onClick={() => {
                  handleDownload();
                  setShowModal(false);
                }}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-lg shadow-amber-500/25 transition-all"
              >
                <Download className="w-4 h-4" />
                <span>Télécharger l'APK</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
