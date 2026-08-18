import React, { useEffect, useRef, useState, useMemo } from 'react';
import { X, Clapperboard, Play } from 'lucide-react';

interface TrailerModalProps {
  videos: any[];
  onClose: () => void;
}

export function TrailerModal({ videos, onClose }: TrailerModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Extraire toutes les vidéos YouTube
  const youtubeVideos = useMemo(() => {
    if (!videos || !Array.isArray(videos)) return [];
    return videos.filter((v: any) => v.site === 'YouTube' && v.key);
  }, [videos]);

  // Détecter la vidéo VOSTFR (Priorité absolue)
  const vostfrVideo = useMemo(() => {
    if (youtubeVideos.length === 0) return null;
    // 1. Chercher un trailer avec "VOSTFR" ou "VOST" ou "VO" dans le nom
    const vostByName = youtubeVideos.find((v: any) => 
      /vostfr|vost|\bvo\b/i.test(v.name)
    );
    if (vostByName) return vostByName;
    
    // 2. Chercher la vidéo en langue originale ou en anglais ('en')
    const originalOrEn = youtubeVideos.find((v: any) => v.iso_639_1 === 'en' || v.iso_639_1 !== 'fr');
    if (originalOrEn) return originalOrEn;

    // 3. Fallback sur la première vidéo
    return youtubeVideos[0];
  }, [youtubeVideos]);

  // Détecter la vidéo VF
  const vfVideo = useMemo(() => {
    if (youtubeVideos.length === 0) return null;
    // Chercher une vidéo 'fr' qui NE contient PAS "VOST" dans le nom
    const vfByName = youtubeVideos.find((v: any) => 
      v.iso_639_1 === 'fr' && !/vostfr|vost/i.test(v.name)
    );
    if (vfByName) return vfByName;
    
    // Chercher n'importe quelle vidéo contenant "VF" ou "French"
    return youtubeVideos.find((v: any) => /\bvf\b|french/i.test(v.name)) || null;
  }, [youtubeVideos]);

  // Vérifier les doublons entre VF et VOSTFR
  const { finalVf, finalVostfr } = useMemo(() => {
    let vf = vfVideo;
    let vost = vostfrVideo;

    if (vf && vost && vf.key === vost.key) {
      if (/vostfr|vost|\bvo\b/i.test(vf.name) || vf.iso_639_1 !== 'fr') {
        vf = null;
      } else {
        vost = null;
      }
    }
    return { finalVf: vf, finalVostfr: vost };
  }, [vfVideo, vostfrVideo]);

  const [lang, setLang] = useState<'vf' | 'vostfr'>(() => (finalVf ? 'vf' : 'vostfr'));

  useEffect(() => {
    if (lang === 'vf' && !finalVf) {
      setLang('vostfr');
    } else if (lang === 'vostfr' && !finalVostfr && finalVf) {
      setLang('vf');
    }
  }, [finalVf, finalVostfr, lang]);

  const currentVideo = lang === 'vf' && finalVf ? finalVf : (finalVostfr || finalVf || youtubeVideos[0]);
  const videoId = currentVideo?.key;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      onClose();
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!videoId) return null;

  const baseParams = "rel=0&modestbranding=1&iv_load_policy=3&playsinline=1&controls=1";
  const urlParams = lang === 'vostfr' 
    ? `autoplay=1&cc_lang_pref=fr&cc_load_policy=1&${baseParams}` 
    : `autoplay=1&${baseParams}`;

  return (
    <div 
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/92 backdrop-blur-xl p-3 sm:p-5 landscape:p-1 overflow-y-auto animate-in fade-in duration-300"
    >
      <div className="w-full max-w-3xl sm:max-w-4xl bg-gradient-to-b from-zinc-900 to-black rounded-3xl overflow-hidden shadow-[0_0_50px_rgba(245,158,11,0.15)] border border-amber-500/25 flex flex-col mx-auto my-auto max-h-[95vh] landscape:max-h-[98vh]">
        {/* En-tête compact et haut de gamme */}
        <div className="flex items-center justify-between px-4 py-3 sm:px-5 sm:py-3.5 bg-zinc-950/90 border-b border-amber-500/15 relative z-10 gap-3 shrink-0">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 shadow-[0_0_12px_rgba(245,158,11,0.2)]">
              <Clapperboard size={19} className="stroke-[2.2]" />
            </div>
            <div className="flex flex-col min-w-0">
              <h3 className="text-white font-extrabold text-sm sm:text-base tracking-wide truncate">
                Bande-annonce
              </h3>
              {currentVideo?.name && (
                <span className="text-[11px] text-zinc-400 truncate max-w-[200px] sm:max-w-[320px]">
                  {currentVideo.name}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {(finalVf || finalVostfr) && (
              <div className="flex items-center bg-zinc-900/90 rounded-xl p-1 border border-white/10 shadow-inner">
                {finalVf && (
                  <button
                    type="button"
                    onClick={() => setLang('vf')}
                    className={`px-3 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
                      lang === 'vf' 
                        ? 'bg-gradient-to-r from-amber-500 to-amber-400 text-black shadow-md shadow-amber-500/25 scale-[1.02]' 
                        : 'text-zinc-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    VF
                  </button>
                )}
                {finalVostfr && (
                  <button
                    type="button"
                    onClick={() => setLang('vostfr')}
                    className={`px-3 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
                      lang === 'vostfr' 
                        ? 'bg-gradient-to-r from-amber-500 to-amber-400 text-black shadow-md shadow-amber-500/25 scale-[1.02]' 
                        : 'text-zinc-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    VOSTFR
                  </button>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/15 transition-all shrink-0 cursor-pointer active:scale-95"
              aria-label="Fermer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Conteneur vidéo propre au bon ratio */}
        <div className="relative w-full aspect-video bg-black overflow-hidden rounded-b-3xl">
          <iframe
            className="absolute inset-0 w-full h-full border-0"
            src={`https://www.youtube.com/embed/${videoId}?${urlParams}`}
            title="Bande-annonce"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
            allowFullScreen
          ></iframe>
        </div>
      </div>
    </div>
  );
}
