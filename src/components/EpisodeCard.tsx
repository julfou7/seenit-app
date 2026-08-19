import React, { useState, useEffect } from 'react';
import type { MouseEvent } from 'react';
import { Check, Calendar, Circle } from 'lucide-react';
import { SeenItCheckButton } from './SeenItCheckButton';
import { cn } from '../lib/utils';
import type { Show } from '../types';
import { tmdb } from '../features/shows/tmdb';

interface EpisodeCardProps {
  key?: React.Key;
  show: Show;
  type: 'watch_next' | 'upcoming';
  onShowClick: (id: any) => void;
  onMarkAsSeen?: (show: Show) => void | Promise<void>;
}

export function EpisodeCard({ show, type, onShowClick, onMarkAsSeen }: EpisodeCardProps) {
  const [isAnimating, setIsAnimating] = useState(false);

  const expectedNext = type === 'watch_next' ? show.nextEpisodeToWatch : null;
  const nextAir = type === 'upcoming' ? show.nextEpisodeToAir : null;

  // Handle case where expected next or next air is missing
  if (type === 'watch_next' && !expectedNext) return null;
  if (type === 'upcoming' && !nextAir) return null;

  const handleActionClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (type === 'watch_next' && onMarkAsSeen) {
      setIsAnimating(true);
      setTimeout(() => {
        onMarkAsSeen(show);
      }, 300);
    }
  };

  let title = show.title;
  let subtitle = '';
  let contextualText = '';
  let ContextIcon = null;
  let contextualClass = '';
  
  const poster = show.posterPath || show.backdropPath;
  const imgSrc = poster ? (poster.startsWith('http') ? poster : `https://image.tmdb.org/t/p/w300${poster}`) : null;

  if (type === 'watch_next' && expectedNext) {
    const epName = expectedNext.name || `Épisode ${expectedNext.episode_number}`;
    subtitle = `S${(expectedNext.season_number ?? 1).toString().padStart(2, '0')} | E${(expectedNext.episode_number ?? 1).toString().padStart(2, '0')} • ${epName}`;
    
    const totalEps = show.totalEpisodes || 0;
    const seenEpsCount = show.seenEpisodes?.length || 0;
    const remaining = Math.max(0, totalEps - seenEpsCount - 1);
    
    if (remaining > 0) {
       contextualText = `+${remaining} restants`;
       contextualClass = "text-zinc-400";
    } else {
       contextualText = 'À voir';
       contextualClass = "text-emerald-400";
    }
  } else if (type === 'upcoming' && nextAir) {
    subtitle = `S${(nextAir.season_number ?? 1).toString().padStart(2, '0')} | E${(nextAir.episode_number ?? 1).toString().padStart(2, '0')} • ${nextAir.name}`;
    
    const airDateStr = nextAir.air_date;
    const [year, month, day] = airDateStr.split('-').map(Number);
    const airDate = new Date(year, month - 1, day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysDiff = Math.ceil((airDate.getTime() - today.getTime()) / (1000 * 3600 * 24));
    
    if (daysDiff === 0) contextualText = "Aujourd'hui";
    else if (daysDiff === 1) contextualText = 'Demain';
    else if (daysDiff > 1 && daysDiff < 7) contextualText = `Dans ${daysDiff} jours`;
    else if (daysDiff === -1) contextualText = 'Hier';
    else if (daysDiff < -1) contextualText = `Il y a ${Math.abs(daysDiff)} jours`;
    else contextualText = airDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    
    ContextIcon = Calendar;
    contextualClass = "text-emerald-400 font-semibold";
  }

  const [providerLogo, setProviderLogo] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (show.tmdbId) {
      tmdb.getWatchProviders(show.tmdbId, show.mediaType === 'movie' ? 'movie' : 'tv').then(res => {
        if (isMounted && res.ok && res.value?.results) {
          const fr = res.value.results.FR || res.value.results.US || res.value.results.BE || res.value.results.CH || res.value.results.CA || Object.values(res.value.results)[0];
          const topProv = fr?.flatrate?.[0] || fr?.free?.[0] || fr?.ads?.[0] || fr?.buy?.[0] || fr?.rent?.[0];
          if (topProv?.logo_path) {
            setProviderLogo(topProv.logo_path);
          }
        }
      }).catch(() => {});
    }
    return () => { isMounted = false; };
  }, [show.tmdbId, show.mediaType]);

  const networkLogo = providerLogo
    ? (providerLogo.startsWith('http') ? providerLogo : `https://image.tmdb.org/t/p/w92${providerLogo}`)
    : (show.networks && show.networks.length > 0 && show.networks[0].logo_path
        ? `https://image.tmdb.org/t/p/w92${show.networks[0].logo_path}`
        : null);

  return (
    <div 
      onClick={() => show.id && onShowClick(show.id)}
      className="w-full flex items-stretch justify-between gap-3 bg-zinc-900/60 hover:bg-zinc-900/80 rounded-2xl overflow-hidden relative isolate transition-all active:scale-[0.98] cursor-pointer mb-3 group shadow-xl"
    >
      {/* OVERLAY PREMIUM : Bordure interne parfaite + Effet lumière */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10 group-hover:ring-white/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.12)] transition-all z-20" />
      <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-white/[0.04] to-transparent opacity-0 group-hover:opacity-100 transition-opacity z-10" />

      {networkLogo && (
        <div className="absolute top-0 right-0 z-30 bg-white/95 backdrop-blur-md px-2 py-1 rounded-bl-xl flex items-center justify-center shrink-0 max-h-[28px] shadow-sm pointer-events-none">
          <img src={networkLogo} alt="" className="h-4.5 w-auto max-w-[60px] max-h-[20px] object-contain rounded-[2px]" />
        </div>
      )}

      {/* AFFICHE */}
      <div className="w-[76px] sm:w-[88px] min-h-[114px] sm:min-h-[132px] shrink-0 bg-zinc-950 rounded-l-2xl overflow-hidden flex items-center justify-center relative z-20">
        {imgSrc ? (
          <img 
            loading="lazy" 
            decoding="async" 
            src={imgSrc} 
            alt={show.title} 
            className="w-full h-auto block object-cover transition-transform duration-500 group-hover:scale-105" 
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] text-zinc-600 p-1 text-center font-bold">
            {show.title}
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 py-3 px-0.5 flex flex-col justify-center relative z-20">
        <div className={cn("flex items-center gap-2 min-w-0", networkLogo ? "pr-10" : "pr-1")}>
          <h4 
            className="text-[#E5A93D] font-extrabold text-xs sm:text-[13px] uppercase tracking-wider line-clamp-2 text-left leading-tight"
          >
            {title}
          </h4>
        </div>
        
        <p className="text-white font-bold text-sm line-clamp-1 leading-snug my-0.5">
          {subtitle}
        </p>
        
        <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
          <span className={cn("text-xs font-semibold flex items-center gap-1 truncate", contextualClass)}>
            {ContextIcon && <ContextIcon size={12} className="shrink-0" />}
            <span className="truncate">{contextualText}</span>
          </span>
        </div>
      </div>

      <div className={cn("pr-2 flex items-center justify-center shrink-0 relative z-20", networkLogo && "pt-3.5")}>
        <SeenItCheckButton 
          onClick={handleActionClick}
          isWatched={isAnimating}
          size={30}
          title={type === 'watch_next' ? "Marquer comme vu" : "Épisode à venir"}
        />
      </div>
    </div>
  );
}
