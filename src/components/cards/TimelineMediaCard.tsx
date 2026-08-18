import React from 'react';
import { cn } from '../../lib/utils';
import { Play } from 'lucide-react';

interface TimelineMediaCardProps {
  media: any;
  onClick: () => void;
  isActive: boolean;
}

export const TimelineMediaCard: React.FC<TimelineMediaCardProps> = ({ media, onClick, isActive }) => {
  const posterPath = media.poster_path;
  const title = media.title || media.name || media.original_title || media.original_name;
  const year = (media.release_date || media.first_air_date)?.substring(0, 4);
  const isTv = media.media_type === 'tv' || !!media.first_air_date;

  return (
    <div
      onClick={onClick}
      className={cn(
        "relative flex flex-col shrink-0 w-[120px] sm:w-[140px] transition-all duration-300 cursor-pointer touch-manipulation group",
        isActive ? "scale-[1.02]" : "hover:scale-[1.02]"
      )}
    >
      <div className={cn(
        "relative aspect-[2/3] w-full bg-zinc-800 rounded-xl overflow-hidden transition-all duration-300",
        isActive 
          ? "border-2 border-[#E5A93D] shadow-[0_0_16px_rgba(229,169,61,0.35)]" 
          : "border border-white/10 group-hover:border-white/25"
      )}>
        {posterPath ? (
          <img
            src={`https://image.tmdb.org/t/p/w342${posterPath}`}
            alt={title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-500 font-bold text-center p-2 text-xs">
            {title}
          </div>
        )}

        {/* Saga Order Badge */}
        {(media.sagaOrder || media.sagaOrderNumber) && (
          <div className={cn(
            "absolute top-2 left-2 z-10 text-[10px] font-black px-2 py-0.5 rounded-md backdrop-blur-md shadow-md",
            isActive 
              ? "bg-[#E5A93D] text-black font-extrabold" 
              : "bg-black/80 text-[#E5A93D] border border-white/10"
          )}>
            #{media.sagaOrder || media.sagaOrderNumber}
          </div>
        )}

        {/* Active item badge */}
        {isActive && (
          <div className="absolute bottom-2 left-2 right-2 z-10 bg-amber-500 text-black text-[9px] font-black uppercase tracking-wider py-0.5 rounded-md text-center shadow-lg truncate">
            {isTv ? 'Série actuelle' : 'Film actuel'}
          </div>
        )}

        {/* Overlay for hover */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <Play size={32} className="text-white drop-shadow-lg" fill="currentColor" />
        </div>
      </div>

      <div className="mt-2 flex flex-col px-0.5">
        <span className={cn(
          "text-xs font-semibold line-clamp-1 transition-colors",
          isActive ? "text-[#E5A93D] font-bold" : "text-zinc-200 group-hover:text-white"
        )}>
          {title}
        </span>
        {year && <span className="text-[10px] text-zinc-500 font-medium">{year}</span>}
      </div>
    </div>
  );
};
