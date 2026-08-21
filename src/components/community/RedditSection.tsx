import React, { useEffect, useState } from 'react';
import { MessageCircle, ExternalLink, Lock, Flame } from 'lucide-react';
import { openExternalUrl } from '../../lib/utils';

export interface RedditPost {
  id: string;
  title: string;
  subreddit: string;
  score: number;
  numComments: number;
  url: string;
  text: string;
  created: number;
}

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
  const [posts, setPosts] = useState<RedditPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isLocked) return;
    
    let isMounted = true;
    setLoading(true);
    
    fetch(`/api/reddit/search?q=${encodeURIComponent(query)}&limit=10`)
      .then(res => {
        if (!res.ok) throw new Error('Erreur de chargement des discussions');
        return res.json();
      })
      .then(data => {
        if (isMounted) {
          // Filter to top 5 posts, preferring those with some engagement
          const validPosts = (data.posts || [])
            .sort((a: RedditPost, b: RedditPost) => b.score - a.score)
            .slice(0, 5);
          setPosts(validPosts);
          setLoading(false);
        }
      })
      .catch(err => {
        if (isMounted) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => { isMounted = false; };
  }, [query, isLocked]);

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

      {loading ? (
        <div className="flex justify-center p-8">
          <div className="w-6 h-6 border-2 border-[#E5A93D] border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : error ? (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center">
          {error}
        </div>
      ) : posts.length === 0 ? (
        <div className="p-8 rounded-2xl border border-zinc-800/50 bg-zinc-900/30 text-center text-zinc-500 text-sm">
          Aucune discussion trouvée pour le moment.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {posts.map(post => (
            <div 
              key={post.id}
              onClick={() => openExternalUrl(post.url)}
              className="group cursor-pointer rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 transition-all hover:bg-zinc-800/60 hover:border-zinc-700 active:scale-[0.98]"
            >
              <div className="flex items-start justify-between gap-4 mb-2">
                <h3 className="text-white font-semibold text-sm leading-snug line-clamp-2 group-hover:text-[#E5A93D] transition-colors">
                  {post.title}
                </h3>
                <ExternalLink size={16} className="text-zinc-600 shrink-0 group-hover:text-[#E5A93D] mt-0.5" />
              </div>
              
              {post.text && (
                <p className="text-zinc-400 text-xs line-clamp-3 mb-4 leading-relaxed opacity-80 whitespace-pre-wrap">
                  {post.text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')}
                </p>
              )}
              
              <div className="flex items-center flex-wrap gap-3 text-xs font-medium text-zinc-500">
                <div className="flex items-center gap-1.5 bg-zinc-950/50 px-2 py-1 rounded-md">
                  <span className="text-orange-500 text-[10px] uppercase font-bold tracking-wider">{post.subreddit}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Flame size={14} className="text-red-400" />
                  <span>{post.score}</span>
                </div>
                <div className="flex items-center gap-1">
                  <MessageCircle size={14} className="text-zinc-400" />
                  <span>{post.numComments}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
