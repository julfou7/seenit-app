import React from 'react';
import { MessageCircle, ExternalLink, Lock } from 'lucide-react';
import { openExternalUrl } from '../../lib/utils';

interface RedditSectionProps {
  query: string;
  isLocked?: boolean;
  unlockMessage?: string;
  title?: string;
  description?: string;
}

export function RedditSection({ 
  query, 
  isLocked = false, 
  unlockMessage = "Débloquez les discussions en regardant cet épisode.",
  title = "Théories & Discussions",
  description = "Découvrez ce que la communauté Reddit pense."
}: RedditSectionProps) {

  if (isLocked) {
    return (
      <div className="mt-8 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <MessageCircle size={20} className="text-[#E5A93D]" />
          <h2 className="text-xl font-black text-white">{title}</h2>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50 p-8 flex flex-col items-center justify-center text-center">
          <div className="absolute inset-0 backdrop-blur-xl bg-zinc-950/60 z-0"></div>
          <div className="relative z-10 flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-zinc-800/80 flex items-center justify-center border border-zinc-700/50 shadow-lg">
              <Lock size={28} className="text-zinc-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white mb-2">Attention aux spoilers !</h3>
              <p className="text-zinc-400 text-sm max-w-[280px] mx-auto leading-relaxed">
                {unlockMessage}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const searchUrl = `https://www.reddit.com/search/?q=${encodeURIComponent(query)}&sort=relevance`;

  return (
    <div className="mt-8 mb-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <MessageCircle size={20} className="text-[#E5A93D]" />
          <h2 className="text-xl font-black text-white">{title}</h2>
        </div>
      </div>
      
      {description && (
        <p className="text-zinc-400 text-sm mb-6">{description}</p>
      )}

      <div 
        onClick={() => openExternalUrl(searchUrl)}
        className="group cursor-pointer rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 transition-all hover:bg-zinc-800/60 hover:border-[#E5A93D]/50 active:scale-[0.98] flex items-center justify-between"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-[#ff4500]/10 flex items-center justify-center">
            <MessageCircle size={24} className="text-[#ff4500]" />
          </div>
          <div>
            <h3 className="text-white font-bold text-sm mb-1 group-hover:text-[#E5A93D] transition-colors">
              Rechercher sur Reddit
            </h3>
            <p className="text-zinc-500 text-xs">
              Ouvrir l'application ou le site Reddit
            </p>
          </div>
        </div>
        <ExternalLink size={20} className="text-zinc-600 group-hover:text-[#E5A93D] transition-colors" />
      </div>
    </div>
  );
}
