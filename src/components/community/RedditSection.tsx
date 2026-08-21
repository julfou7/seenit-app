import React, { useEffect, useState } from 'react';
import { MessageCircle, ExternalLink, Lock, Sparkles, AlertCircle } from 'lucide-react';
import { openExternalUrl } from '../../lib/utils';
import { CapacitorHttp } from '@capacitor/core';

interface RedditPost {
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
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isLocked) return;
    
    let isMounted = true;
    setLoading(true);
    
    const fetchRedditAndSummarize = async () => {
      try {
        const redditUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=relevance&limit=5`;
        
        let redditData;
        try {
          const response = await CapacitorHttp.get({
            url: redditUrl,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
            }
          });
          redditData = response.data;
        } catch (fetchErr) {
          console.warn("CapacitorHttp failed, trying fallback fetch", fetchErr);
          const fallbackResponse = await fetch(redditUrl);
          redditData = await fallbackResponse.json();
        }

        if (!isMounted) return;

        if (!redditData?.data?.children || redditData.data.children.length === 0) {
          setPosts([]);
          setLoading(false);
          return;
        }

        const validPosts = redditData.data.children.map((child: any) => ({
          id: child.data.id,
          title: child.data.title,
          subreddit: child.data.subreddit_name_prefixed,
          score: child.data.score,
          numComments: child.data.num_comments,
          url: `https://www.reddit.com${child.data.permalink}`,
          text: child.data.selftext || '',
          created: child.data.created_utc
        })).sort((a: RedditPost, b: RedditPost) => b.score - a.score).slice(0, 3);
        
        setPosts(validPosts);

        if (validPosts.length > 0) {
          try {
            const sumRes = await fetch('/api/ai/summarize-discussions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ threads: validPosts, queryContext: query })
            });
            const sumData = await sumRes.json();
            if (sumData.summary && isMounted) {
              setAiSummary(sumData.summary);
            }
          } catch (aiErr) {
            console.error("AI Summarization error", aiErr);
          }
        }
        
        if (isMounted) setLoading(false);
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || 'Impossible de récupérer les discussions.');
          setLoading(false);
        }
      }
    };

    fetchRedditAndSummarize();

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

      {loading ? (
        <div className="flex flex-col items-center justify-center p-8 border border-zinc-800/50 rounded-2xl bg-zinc-900/20">
          <div className="w-6 h-6 border-2 border-[#E5A93D] border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-zinc-500 text-xs animate-pulse">Exploration de Reddit & Analyse IA...</p>
        </div>
      ) : error ? (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      ) : posts.length === 0 ? (
        <div className="p-8 rounded-2xl border border-zinc-800/50 bg-zinc-900/30 text-center text-zinc-500 text-sm flex flex-col items-center justify-center gap-4">
          <p>Aucune discussion trouvée pour le moment.</p>
          <button 
            onClick={() => openExternalUrl(searchUrl)}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs transition-colors"
          >
            Chercher manuellement
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {aiSummary && (
            <div className="p-5 rounded-2xl bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-indigo-500/20 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-purple-500"></div>
              <div className="flex items-center gap-2 mb-3">
                <Sparkles size={16} className="text-indigo-400" />
                <h3 className="text-sm font-bold text-indigo-300 uppercase tracking-wider">Résumé IA des discussions</h3>
              </div>
              <div className="text-zinc-300 text-sm leading-relaxed whitespace-pre-wrap opacity-90 prose prose-invert prose-p:my-1 prose-li:my-0.5 max-w-none">
                {aiSummary.replace(/[*]/g, '')}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {posts.map(post => (
              <div 
                key={post.id}
                onClick={() => openExternalUrl(post.url)}
                className="group cursor-pointer rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 transition-all hover:bg-zinc-800/60 hover:border-zinc-700 active:scale-[0.98]"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="text-white font-semibold text-[11px] leading-snug line-clamp-2 group-hover:text-[#E5A93D] transition-colors">
                    {post.title}
                  </h3>
                  <ExternalLink size={12} className="text-zinc-600 shrink-0 group-hover:text-[#E5A93D] mt-0.5" />
                </div>
                <div className="flex items-center justify-between text-[10px] font-medium text-zinc-500">
                  <span className="text-orange-500 font-bold tracking-wider line-clamp-1 truncate w-[80px]">
                    {post.subreddit}
                  </span>
                  <div className="flex gap-2">
                    <span className="flex items-center gap-1"><span className="text-red-400">↑</span>{post.score}</span>
                    <span className="flex items-center gap-1"><MessageCircle size={10} className="text-zinc-400" />{post.numComments}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
