import React, { useEffect, useState } from 'react';
import { MessageCircle, ExternalLink, Lock } from 'lucide-react';
import { Browser } from '@capacitor/browser';
import { searchRedditDiscussions, RedditPost, RedditResponse } from '../../services/reddit';

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
  const [status, setStatus] = useState<'loading' | 'success' | 'fallback'>('loading');
  const [posts, setPosts] = useState<RedditPost[]>([]);

  useEffect(() => {
    if (isLocked) return;
    
    let isMounted = true;
    setStatus('loading');
    
    searchRedditDiscussions(query).then((res: RedditResponse) => {
      if (isMounted) {
        setStatus(res.status);
        setPosts(res.posts);
      }
    });

    return () => { isMounted = false; };
  }, [query, isLocked]);

  const openLink = async (url: string) => {
    await Browser.open({ url });
  };

  const searchUrl = `https://www.reddit.com/search/?q=${encodeURIComponent(query)}&sort=relevance`;

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

      {status === 'loading' ? (
        <div className="flex justify-center p-8 border border-zinc-800/50 rounded-2xl bg-zinc-900/20">
          <div className="w-6 h-6 border-2 border-[#E5A93D] border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : status === 'success' && posts.length > 0 ? (
        <div className="flex flex-col gap-3">
          {posts.map(post => (
            <div 
              key={post.id}
              onClick={() => openLink(post.url)}
              className="group cursor-pointer rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 transition-all hover:bg-zinc-800/60 hover:border-zinc-700 active:scale-[0.98]"
            >
              <div className="flex items-start justify-between gap-4 mb-3">
                <h3 className="text-white font-semibold text-sm leading-snug line-clamp-2 group-hover:text-[#E5A93D] transition-colors">
                  {post.title}
                </h3>
                <ExternalLink size={14} className="text-zinc-600 shrink-0 group-hover:text-[#E5A93D] mt-0.5" />
              </div>
              
              <div className="flex items-center flex-wrap gap-4 text-xs font-medium text-zinc-500">
                <div className="flex items-center gap-1">
                  <span className="text-red-400 font-bold">↑</span>
                  <span>{post.score}</span>
                </div>
                <div className="flex items-center gap-1">
                  <MessageCircle size={12} className="text-zinc-400" />
                  <span>{post.numComments} réponses</span>
                </div>
              </div>
            </div>
          ))}
          <div 
            onClick={() => openLink(searchUrl)}
            className="mt-2 text-center py-3 text-xs text-zinc-400 hover:text-white transition-colors cursor-pointer font-medium"
          >
            Voir plus de discussions sur Reddit
          </div>
        </div>
      ) : (
        <div 
          onClick={() => openLink(searchUrl)}
          className="group cursor-pointer rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 transition-all hover:bg-zinc-800/60 hover:border-[#E5A93D]/50 active:scale-[0.98] flex items-center justify-between"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-[#ff4500]/10 flex items-center justify-center">
              <MessageCircle size={24} className="text-[#ff4500]" />
            </div>
            <div>
              <h3 className="text-white font-bold text-sm mb-1 group-hover:text-[#E5A93D] transition-colors">
                Ouvrir la discussion de l'épisode sur Reddit
              </h3>
              <p className="text-zinc-500 text-xs">
                Lancer la recherche directement sur Reddit
              </p>
            </div>
          </div>
          <ExternalLink size={20} className="text-zinc-600 group-hover:text-[#E5A93D] transition-colors" />
        </div>
      )}
    </div>
  );
}

