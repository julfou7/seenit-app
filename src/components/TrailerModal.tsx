import { DialogLayer } from './ui/DialogLayer';
import React, { useLayoutEffect, useRef, useState, useMemo } from 'react';
import { X, Clapperboard, Maximize } from 'lucide-react';
import { prepareTrailerVideos, trailerEmbedUrl, type TrailerVideo } from '../features/trailers/trailerPolicy';
import { startTrailerPresentation } from '../features/trailers/trailerPresentation';
import { isNativeTrailer, trailerPresentationAdapter } from '../features/trailers/trailerPlatform';

export type { TrailerVideo } from '../features/trailers/trailerPolicy';

interface TrailerModalProps {
  videos: TrailerVideo[];
  onClose: () => void;
}

export function TrailerModal({ videos, onClose }: TrailerModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const presentationRef = useRef<ReturnType<typeof startTrailerPresentation> | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const choices = useMemo(() => prepareTrailerVideos(videos), [videos]);
  const [selectedKey, setSelectedKey] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [nativeImmersive, setNativeImmersive] = useState(false);
  const currentVideo = choices.find(video => video.key === selectedKey) || choices[0];
  const hasVideo = Boolean(currentVideo);
  const native = isNativeTrailer();
  const immersive = fullscreen || nativeImmersive;

  const present = () => {
    const element = overlayRef.current;
    if (!element || presentationRef.current) return;
    if (native) setNativeImmersive(true);
    const session = startTrailerPresentation(trailerPresentationAdapter(element));
    presentationRef.current = session;
    void session.ready.then(() => {
      if (!native && document.fullscreenElement !== element && presentationRef.current === session) {
        presentationRef.current = null;
      }
    });
  };

  useLayoutEffect(() => {
    if (!hasVideo) return;
    let wasFullscreen = false;
    const onFullscreen = () => {
      const active = document.fullscreenElement === overlayRef.current;
      setFullscreen(active);
      if (wasFullscreen && !active) closeRef.current();
      wasFullscreen = active;
    };
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreen);
      void presentationRef.current?.close();
      presentationRef.current = null;
    };
  }, [hasVideo]);

  if (!currentVideo) return null;

  const handleOverlayClick = (event: React.MouseEvent) => {
    if (event.target === overlayRef.current) onClose();
  };
  const selector = <select aria-label="Choisir une vidéo" value={currentVideo.key} onChange={event => setSelectedKey(event.target.value)}
    className="w-full min-w-0 flex-1 min-h-11 bg-zinc-900 rounded-lg px-2 text-xs text-white focus-visible:outline-amber-400">
    {choices.map(video => <option key={video.key} value={video.key}>{video.name} — {video.typeLabel} · {video.languageLabel}</option>)}
  </select>;

  return (
    <DialogLayer onDismiss={onClose} label="Bande-annonce" historyMode="local" ref={overlayRef}
      onClick={handleOverlayClick}
      style={immersive ? {
        paddingTop: 'var(--seenit-safe-area-top, env(safe-area-inset-top, 0px))',
        paddingBottom: 'var(--seenit-safe-area-bottom, env(safe-area-inset-bottom, 0px))',
        paddingLeft: 'var(--seenit-safe-area-left, env(safe-area-inset-left, 0px))',
        paddingRight: 'var(--seenit-safe-area-right, env(safe-area-inset-right, 0px))',
      } : undefined}
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-black/92 backdrop-blur-xl overflow-y-auto ${immersive ? 'p-0' : 'p-3 sm:p-5 landscape:p-1'}`}>
      <div className={`w-full bg-gradient-to-b from-zinc-900 to-black overflow-hidden shadow-xl flex flex-col mx-auto my-auto ${immersive ? 'h-full' : 'max-w-4xl rounded-3xl border border-amber-500/25 max-h-[95dvh]'}`}>
        <div className="flex items-center justify-between px-3 py-2 bg-zinc-950/90 border-b border-amber-500/15 gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Clapperboard size={20} className="text-amber-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <h3 className="text-white font-bold text-sm truncate">{currentVideo.name}</h3>
              <p className="text-xs text-zinc-400 truncate">{currentVideo.typeLabel} · {currentVideo.languageLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!immersive && <button type="button" onClick={present} aria-label="Plein écran" className="w-11 h-11 flex items-center justify-center rounded-full text-zinc-300 hover:bg-white/10 focus-visible:outline-amber-400"><Maximize size={19} /></button>}
            <button type="button" onClick={onClose} aria-label="Fermer" className="w-11 h-11 flex items-center justify-center rounded-full text-zinc-300 hover:bg-white/10 focus-visible:outline-amber-400"><X size={20} /></button>
          </div>
        </div>
        {choices.length > 1 && <label className="flex items-center gap-2 px-3 py-1 text-xs text-zinc-400 bg-zinc-950/70 border-b border-white/5 shrink-0">
          <span className="shrink-0">Vidéo</span>
          {selector}
        </label>}
        <div className={`relative w-full bg-black overflow-hidden ${immersive ? 'flex-1 min-h-0' : 'aspect-video'}`}>
          <iframe key={currentVideo.key} className="absolute inset-0 w-full h-full border-0"
            src={trailerEmbedUrl(currentVideo)} title={`${currentVideo.typeLabel} : ${currentVideo.name}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen" allowFullScreen />
        </div>
      </div>
    </DialogLayer>
  );
}
