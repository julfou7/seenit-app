import React from 'react';
import { ExternalLink, Lock } from 'lucide-react';
import { openExternalUrl } from '../../lib/utils';

interface RedditSectionProps {
  query: string;
  isLocked?: boolean;
  unlockMessage?: string;
  title?: string;
  description?: string;
}

export const REDDIT_ICON_SVG = (
  <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
    <path fill="#FF4500" d="M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286A1 1 0 0 0 1.936 24.47l4.57-1.143A11.94 11.94 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm5.88 13.88c.08.24.12.5.12.77 0 2.3-2.69 4.17-6 4.17s-6-1.87-6-4.17c0-.27.04-.53.12-.77-.73-.41-1.22-1.18-1.22-2.07 0-1.31 1.07-2.38 2.38-2.38.64 0 1.22.25 1.64.67 1.25-.87 2.91-1.42 4.74-1.47l.95-4.47a.5.5 0 0 1 .59-.38l3.1.66c.22-.39.64-.66 1.12-.66 1.04 0 1.88.84 1.88 1.88 0 1.04-.84 1.88-1.88 1.88-.93 0-1.7-.68-1.85-1.57l-2.65-.56-.81 3.82c1.78.06 3.4.61 4.63 1.46.42-.41 1-.65 1.63-.65 1.31 0 2.38 1.07 2.38 2.38 0 .89-.49 1.66-1.22 2.07zm-8.88-.07c-.69 0-1.25.56-1.25 1.25s.56 1.25 1.25 1.25 1.25-.56 1.25-1.25-.56-1.25-1.25-1.25zm6 0c-.69 0-1.25.56-1.25 1.25s.56 1.25 1.25 1.25 1.25-.56 1.25-1.25-.56-1.25-1.25-1.25zm-6.22 3.82a.5.5 0 0 0 .7.14c.82-.54 1.95-.87 3.22-.87s2.4.33 3.22.87a.5.5 0 1 0 .56-.83c-.98-.65-2.28-1.04-3.78-1.04s-2.8.39-3.78 1.04a.5.5 0 0 0-.14.69z"/>
  </svg>
);

export function RedditSection({ 
  query, 
  isLocked = false, 
  unlockMessage = "Débloquez les discussions en regardant cet épisode.",
  title = "Discussions Reddit",
  description = "Retrouvez les théories, avis et spoilers de la communauté."
}: RedditSectionProps) {
  const searchUrl = `https://www.reddit.com/search/?q=${encodeURIComponent(query)}&sort=relevance`;

  const handleOpenReddit = async () => {
    await openExternalUrl(searchUrl);
  };

  if (isLocked) {
    return (
      <div className="mt-6 mb-2">
        <div className="flex items-center gap-2 mb-3">
          {REDDIT_ICON_SVG}
          <h2 className="text-base font-extrabold text-white">{title}</h2>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-6 flex flex-col items-center justify-center text-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-zinc-800/80 flex items-center justify-center border border-zinc-700/50 shadow-md">
              <Lock size={22} className="text-zinc-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white mb-1">Attention aux spoilers !</h3>
              <p className="text-zinc-400 text-xs max-w-[280px] mx-auto leading-relaxed">
                {unlockMessage}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 mb-2">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {REDDIT_ICON_SVG}
          <h2 className="text-base font-extrabold text-white">{title}</h2>
        </div>
      </div>
      
      {description && (
        <p className="text-zinc-400 text-xs mb-3.5 leading-relaxed">{description}</p>
      )}

      <button
        type="button"
        onClick={handleOpenReddit}
        className="w-full group cursor-pointer rounded-2xl border border-[#FF4500]/30 bg-gradient-to-r from-[#FF4500]/15 via-zinc-900/90 to-zinc-900 p-4 transition-all hover:bg-[#FF4500]/20 hover:border-[#FF4500]/60 active:scale-[0.98] flex items-center justify-between shadow-lg touch-manipulation select-none"
      >
        <div className="flex items-center gap-3.5 text-left">
          <div className="w-11 h-11 rounded-xl bg-[#FF4500] flex items-center justify-center shrink-0 shadow-md shadow-[#FF4500]/30">
            <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286A1 1 0 0 0 1.936 24.47l4.57-1.143A11.94 11.94 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm5.88 13.88c.08.24.12.5.12.77 0 2.3-2.69 4.17-6 4.17s-6-1.87-6-4.17c0-.27.04-.53.12-.77-.73-.41-1.22-1.18-1.22-2.07 0-1.31 1.07-2.38 2.38-2.38.64 0 1.22.25 1.64.67 1.25-.87 2.91-1.42 4.74-1.47l.95-4.47a.5.5 0 0 1 .59-.38l3.1.66c.22-.39.64-.66 1.12-.66 1.04 0 1.88.84 1.88 1.88 0 1.04-.84 1.88-1.88 1.88-.93 0-1.7-.68-1.85-1.57l-2.65-.56-.81 3.82c1.78.06 3.4.61 4.63 1.46.42-.41 1-.65 1.63-.65 1.31 0 2.38 1.07 2.38 2.38 0 .89-.49 1.66-1.22 2.07zm-8.88-.07c-.69 0-1.25.56-1.25 1.25s.56 1.25 1.25 1.25 1.25-.56 1.25-1.25-.56-1.25-1.25-1.25zm6 0c-.69 0-1.25.56-1.25 1.25s.56 1.25 1.25 1.25 1.25-.56 1.25-1.25-.56-1.25-1.25-1.25zm-6.22 3.82a.5.5 0 0 0 .7.14c.82-.54 1.95-.87 3.22-.87s2.4.33 3.22.87a.5.5 0 1 0 .56-.83c-.98-.65-2.28-1.04-3.78-1.04s-2.8.39-3.78 1.04a.5.5 0 0 0-.14.69z"/>
            </svg>
          </div>
          <div>
            <h3 className="text-white font-bold text-sm leading-tight group-hover:text-amber-400 transition-colors">
              Ouvrir dans l'application Reddit
            </h3>
            <p className="text-zinc-400 text-[11px] mt-0.5">
              Rechercher les théories et avis de la communauté
            </p>
          </div>
        </div>
        <ExternalLink size={17} className="text-zinc-500 group-hover:text-[#FF4500] transition-colors shrink-0 ml-2" />
      </button>
    </div>
  );
}
