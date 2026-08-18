import React, { useState, useEffect, useRef } from 'react';
import { 
  Star, Tv, Film, Ticket, Calendar, Plus, CheckCircle2, XCircle, 
  Archive, Play, X, Loader2, CheckCircle, Info, RotateCcw, Check
} from 'lucide-react';
import { tmdb, isMovieAtCinema, isMovieUpcoming, type TMDBMedia } from '../features/shows/tmdb';
import { cn, checkIsUpToDate, computeAutoArchiveStatus, getTodayStr, formatAirDateSafe } from '../lib/utils';
import { useShowsStore } from '../store/showsStore';

export interface GridMediaCardProps {
  media: TMDBMedia;
  onShowClick: (id: any, mediaType?: 'tv' | 'movie') => void;
  isNewlyLoaded?: boolean;
  show?: any;
  onAddClick?: (media: TMDBMedia) => void;
  onToggleWatched?: (media: TMDBMedia) => void;
  onLongPress?: (media: TMDBMedia) => void;
  hideBadges?: boolean;
  showProgress?: boolean;
}

export const GridMediaCard = React.memo(function GridMediaCard({ 
  media, 
  onShowClick, 
  isNewlyLoaded, 
  show, 
  onAddClick, 
  onToggleWatched,
  onLongPress,
  hideBadges,
  showProgress = false
}: GridMediaCardProps) {
  const isUpToDate = checkIsUpToDate(show);

  const displayTitle = media.title || media.name || media.original_title || media.original_name || '';
  const year = (media.first_air_date || media.release_date || '').substring(0, 4);

  const isTv = media.media_type === 'tv' || show?.mediaType === 'tv' || (!media.media_type && media.first_air_date !== undefined);
  const mediaType = isTv ? 'tv' : 'movie';

  const rating = media.vote_average && media.vote_average > 0 ? media.vote_average.toFixed(1) : null;
  const characterOrJob = (media as any).character || (media as any).job;

  const isAtCinema = !isTv && (isMovieAtCinema(media) || isMovieAtCinema(show));
  const isUpcoming = !isTv && !isAtCinema && (isMovieUpcoming(media) || isMovieUpcoming(show));

  const seenCount = isTv ? (show?.seenEpisodes?.length || 0) : 0;
  const totalEpisodes = show?.totalAiredEpisodes || show?.totalEpisodes || (media as any).number_of_episodes || 0;
  const progressPercentage = isUpToDate 
    ? 100 
    : totalEpisodes > 0 
      ? Math.min(100, Math.round((seenCount / totalEpisodes) * 100)) 
      : (seenCount > 0 ? 50 : 0);

  let actionInfo: { text: string; icon: React.ReactNode; className: string } | null = null;
  if (show) {
    if (show.status === 'dropped') {
      actionInfo = {
        text: 'Abandonnée',
        icon: <XCircle size={10} className="text-rose-400" />,
        className: 'bg-rose-950/40 text-rose-300 border-rose-500/20'
      };
    } else if (show.isArchived) {
      actionInfo = {
        text: 'Archivée',
        icon: <Archive size={10} className="text-amber-300" />,
        className: 'bg-zinc-900 text-amber-200 border-amber-500/20'
      };
    } else if (!isTv) {
      if (isUpToDate) {
        actionInfo = {
          text: 'Vu',
          icon: <CheckCircle2 size={10} className="text-emerald-400" />,
          className: 'bg-emerald-950/40 text-emerald-200 border-emerald-500/20'
        };
      } else {
        actionInfo = {
          text: 'À voir',
          icon: <CheckCircle2 size={10} className="text-blue-400" />,
          className: 'bg-blue-950/40 text-blue-200 border-blue-500/20'
        };
      }
    } else if (isUpToDate) {
      actionInfo = {
        text: 'À jour',
        icon: <CheckCircle2 size={10} className="text-emerald-400" />,
        className: 'bg-emerald-950/40 text-emerald-200 border-emerald-500/20'
      };
    } else if (show.seenEpisodes && show.seenEpisodes.length > 0) {
      actionInfo = {
        text: 'Continuer',
        icon: <Play size={10} className="fill-amber-100 text-amber-100" />,
        className: 'bg-amber-500/40 text-amber-100 border-amber-400/30'
      };
    } else {
      actionInfo = {
        text: 'Commencer',
        icon: <Play size={10} className="fill-amber-100 text-amber-100" />,
        className: 'bg-amber-500/40 text-amber-100 border-amber-400/30'
      };
    }
  }

  const longPressTimer = useRef<NodeJS.Timeout>();
  const isLongPressRef = useRef(false);

  const handleTouchStart = () => {
    isLongPressRef.current = false;
    if (onLongPress) {
      longPressTimer.current = setTimeout(() => {
        isLongPressRef.current = true;
        onLongPress(media);
      }, 500);
    }
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    if (isLongPressRef.current) {
      e.preventDefault();
      e.stopPropagation();
      isLongPressRef.current = false;
      return;
    }
    onShowClick(media.id, mediaType);
  };

  return (
    <div 
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchEnd}
      onMouseDown={handleTouchStart}
      onMouseUp={handleTouchEnd}
      onMouseLeave={handleTouchEnd}
      onContextMenu={(e) => {
        if (onLongPress) {
          e.preventDefault();
          onLongPress(media);
        }
      }}
      className={cn("flex flex-col gap-2 w-full cursor-pointer group transition-all duration-300 touch-manipulation active:scale-[0.98]", isNewlyLoaded && "animate-in fade-in slide-in-from-bottom-2 duration-500")}
    >
      {/* 1. BLOC AFFICHE AVEC BANDEAU OU BARRE DE PROGRESSION */}
      <div className="w-full rounded-xl overflow-hidden bg-[#1C1C1E] border border-white/5 shadow-md group-hover:scale-[1.02] transition-transform duration-200">
        <div className="relative aspect-[2/3] w-full bg-zinc-800">
          {media.poster_path ? (
            <img 
              loading="lazy" 
              decoding="async" 
              src={`https://image.tmdb.org/t/p/w342${media.poster_path}`} 
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" 
              alt={displayTitle} 
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-600 bg-zinc-900/50 text-xs text-center p-2">
              {displayTitle}
            </div>
          )}

          {/* Dégradé très léger juste en haut pour lire les notes */}
          <div className="absolute inset-x-0 top-0 h-1/4 bg-gradient-to-b from-black/60 to-transparent pointer-events-none" />

          {/* En-tête : Note en haut à gauche */}
          {rating && (
            <div className="absolute top-0 left-0 bg-black/60 backdrop-blur-md px-1.5 py-1 rounded-br-lg text-[10px] font-bold text-white flex items-center gap-1 shadow-sm border-b border-r border-white/10">
              <Star size={10} className="text-[#E5A93D] fill-[#E5A93D]" />
              <span>{rating}</span>
            </div>
          )}

          {/* Barre d'avancement pour les séries dans Ma Liste */}
          {(hideBadges || showProgress) && isTv && show && (
            <div className="absolute bottom-0 inset-x-0 h-1.5 bg-black/70 backdrop-blur-xs z-10 overflow-hidden">
              <div 
                className={cn(
                  "h-full transition-all duration-500", 
                  isUpToDate ? "bg-emerald-500" : "bg-[#E5A93D]"
                )} 
                style={{ width: `${progressPercentage}%` }} 
              />
            </div>
          )}
        </div>

        {/* Bandeau d'action sous l'image (masqué si hideBadges) */}
        {!hideBadges && (
          <div 
            onClick={(e) => {
              e.stopPropagation();
              if (!show && onAddClick) {
                onAddClick(media);
              } else if (show && onToggleWatched) {
                if (isTv && (actionInfo?.text === 'Continuer' || actionInfo?.text === 'Commencer')) {
                  onShowClick(media.id, mediaType);
                } else {
                  onToggleWatched(media);
                }
              }
            }}
            className={cn(
              "w-full py-1 text-center flex items-center justify-center gap-1 border-t text-[9px] font-extrabold uppercase tracking-wide cursor-pointer hover:opacity-90 active:scale-95 transition-all", 
              actionInfo ? actionInfo.className : "bg-[#1C1C1E] text-zinc-500 border-white/5 hover:text-zinc-300 transition-colors hover:bg-white/5"
            )}
          >
            {actionInfo ? (
              <>
                {actionInfo.icon}
                <span>{actionInfo.text}</span>
              </>
            ) : (
              <>
                <Plus size={10} className="text-zinc-500" />
                <span>Ajouter</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* 2. BLOC INFOS */}
      <div className="flex flex-col px-0.5 min-w-0">
        <h3 className="text-xs font-bold text-white truncate w-full" title={displayTitle}>
          {displayTitle}
        </h3>

        {characterOrJob && (
          <p className="text-[10px] font-semibold text-zinc-400 truncate w-full uppercase tracking-tight">
            {characterOrJob}
          </p>
        )}

        {hideBadges ? (
          /* Mode épuré sans badges avec progression précise */
          <div className="mt-0.5">
            {isTv ? (
              <div className="flex items-center justify-between text-[10px] min-w-0 text-zinc-400">
                {isUpToDate ? (
                  <span className="text-emerald-400 font-semibold flex items-center gap-1 truncate">
                    <CheckCircle2 size={10} className="shrink-0" />
                    <span>À jour</span>
                  </span>
                ) : seenCount > 0 ? (
                  <span className="text-zinc-300 font-medium truncate">
                    {seenCount}{totalEpisodes > 0 ? `/${totalEpisodes}` : ''} ép.
                  </span>
                ) : (
                  <span className="text-zinc-500 font-medium truncate">
                    {totalEpisodes > 0 ? `${totalEpisodes} épisodes` : 'À commencer'}
                  </span>
                )}
                
                {seenCount > 0 && !isUpToDate && (
                  <span className="text-[#E5A93D] font-bold text-[10px] shrink-0 ml-1">
                    {progressPercentage}%
                  </span>
                )}
                {seenCount === 0 && year && (
                  <span className="text-zinc-500 text-[10px] shrink-0 ml-auto">
                    {year}
                  </span>
                )}
                {isUpToDate && (
                  <span className="text-zinc-500 text-[10px] shrink-0 ml-auto">
                    {seenCount > 0 ? `${seenCount} ép.` : year || ''}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between text-[10px] text-zinc-400 font-medium min-w-0">
                {year && <span>{year}</span>}
                {show && (show.status === 'completed' || show.seenEpisodes?.includes('movie')) && (
                  <span className="text-emerald-400 font-semibold flex items-center gap-1 ml-auto">
                    <CheckCircle2 size={10} /> Vu
                  </span>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Mode standard avec badges */
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            {!isTv && isAtCinema ? (
              <span className="bg-[#E5A93D] text-black text-[9px] font-extrabold px-1.5 py-0.5 rounded flex items-center gap-1 uppercase tracking-wider shadow-sm">
                <Ticket size={10} className="text-black" />
                Au Cinéma
              </span>
            ) : !isTv && isUpcoming ? (
              <span className="bg-purple-600 text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded flex items-center gap-1 uppercase tracking-wider shadow-sm">
                <Calendar size={10} className="text-white" />
                À venir
              </span>
            ) : (
              <span className={cn(
                "text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 uppercase tracking-wider shadow-sm",
                isTv ? "bg-indigo-600 text-white" : "bg-rose-600 text-white"
              )}>
                {isTv ? <Tv size={10} /> : <Film size={10} />}
                {isTv ? 'Série' : 'Film'}
              </span>
            )}

            {year && (!(!isTv && isAtCinema)) && (
              <span className="text-zinc-400 text-[10px] font-semibold ml-auto">
                {year}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export interface PreviewModalProps {
  media: TMDBMedia;
  isAdded?: boolean;
  isWatched?: boolean;
  onClose: () => void;
  onAddClick: (m: TMDBMedia) => void;
  onToggleWatched?: (m: TMDBMedia) => void;
  onShowClick: (id: any, mediaType: 'tv' | 'movie') => void;
}

export function PreviewModal({ 
  media, 
  isAdded,
  isWatched,
  onClose, 
  onAddClick,
  onToggleWatched,
  onShowClick 
}: PreviewModalProps) {
  const isTv = media.media_type === 'tv' || (!media.media_type && media.first_air_date !== undefined);
  const type = isTv ? 'Série' : 'Film';
  const displayTitle = media.name || media.title || media.original_name || media.original_title || '';
  const year = (media.first_air_date || media.release_date || '').substring(0, 4);
  const isAtCinema = !isTv && isMovieAtCinema(media);
  const isUpcoming = !isTv && !isAtCinema && isMovieUpcoming(media);

  const [trailerKey, setTrailerKey] = useState<string | null>(null);
  const [loadingTrailer, setLoadingTrailer] = useState<boolean>(true);
  const [fullMedia, setFullMedia] = useState<TMDBMedia | null>(null);

  useEffect(() => {
    let active = true;
    setLoadingTrailer(true);
    setTrailerKey(null);

    async function fetchDetails() {
      try {
        const mediaId = Number(media.id);
        const res = await tmdb.getMediaDetails(mediaId, isTv ? 'tv' : 'movie');
        if (active && res.ok && res.value) {
          setFullMedia(res.value);
          if (res.value?.videos?.results) {
            const ytVideos = res.value.videos.results.filter((v: any) => v.site === 'YouTube' && v.key);
            if (ytVideos.length > 0) {
              const trailer = ytVideos.find((v: any) => v.type === 'Trailer' && v.iso_639_1 === 'fr') 
                || ytVideos.find((v: any) => v.type === 'Trailer')
                || ytVideos.find((v: any) => v.type === 'Teaser' && v.iso_639_1 === 'fr')
                || ytVideos.find((v: any) => v.type === 'Teaser') 
                || ytVideos[0];
              setTrailerKey(trailer.key);
            }
          }
        }
      } catch (err) {
        console.error("Erreur lors du chargement des détails pour la prévisualisation:", err);
      } finally {
        if (active) setLoadingTrailer(false);
      }
    }

    fetchDetails();

    return () => {
      active = false;
    };
  }, [media.id, isTv]);

  const activeMedia = fullMedia || media;
  const ratingVal = activeMedia.vote_average;
  const rating = ratingVal && ratingVal > 0 ? ratingVal.toFixed(1) : null;
  const overview = activeMedia.overview || media.overview;

  const shows = useShowsStore((state) => state.shows);
  const show = shows.find((s) => s.tmdbId === Number(media.id));

  // Determine main action button logic matching ShowDetailScreen
  let buttonLabel = isTv ? "Suivre la série" : "Ajouter aux films à voir";
  let ButtonIcon: React.ElementType = Plus;
  let buttonStyle = "bg-[#E5A93D] text-black hover:bg-[#F5B94D] shadow-lg";
  let handleAction = () => {
    onAddClick(media);
    onClose();
  };

  if (!show) {
    buttonLabel = isTv ? "Suivre la série" : "Ajouter aux films à voir";
    ButtonIcon = Plus;
    buttonStyle = "bg-[#E5A93D] text-black hover:bg-[#F5B94D] shadow-lg";
    handleAction = () => {
      onAddClick(media);
      onClose();
    };
  } else if (show.status === 'dropped') {
    buttonLabel = isTv ? "Reprendre la série" : "Ajouter à ma liste";
    ButtonIcon = RotateCcw;
    buttonStyle = "bg-[#E5A93D] text-black hover:bg-[#F5B94D] shadow-lg";
    handleAction = () => {
      onShowClick(media.id, isTv ? 'tv' : 'movie');
      onClose();
    };
  } else if (
    show.isArchived || 
    show.status === 'completed' || 
    computeAutoArchiveStatus(show) || 
    (isTv && Boolean(show.seenEpisodes && show.seenEpisodes.length > 0 && !show.nextEpisodeToWatch && !show.nextEpisodeToAir))
  ) {
    buttonLabel = isTv ? "Revoir la série" : "Revoir le film";
    ButtonIcon = RotateCcw;
    buttonStyle = "bg-[#E5A93D]/20 text-[#E5A93D] border border-[#E5A93D]/30 hover:bg-[#E5A93D]/30 shadow-sm";
    handleAction = () => {
      onShowClick(media.id, isTv ? 'tv' : 'movie');
      onClose();
    };
  } else if (isTv) {
    const hasSeenMedia = Boolean(show.seenEpisodes && show.seenEpisodes.length > 0);
    const fallbackNextEp = !hasSeenMedia ? { season_number: 1, episode_number: 1 } : null;
    const nextEp = show.nextEpisodeToWatch || fallbackNextEp || show.nextEpisodeToAir;

    const getEpStatus = () => {
      if (!nextEp) return null;
      const sCode = String(nextEp.season_number || 1).padStart(2, '0');
      const eCode = String(nextEp.episode_number || 1).padStart(2, '0');
      const fullEpCode = `S${sCode} | E${eCode}`;

      let airDate = nextEp.air_date;
      const todayStr = getTodayStr();

      if (airDate && airDate > todayStr) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const parts = airDate.split('-');
        if (parts.length >= 3) {
          const [year, month, day] = parts.map((p: string) => parseInt(p, 10));
          const airDateObj = new Date(Date.UTC(year, month - 1, day));
          const diffDays = Math.ceil((airDateObj.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays === 1) return { isUpcoming: true, label: `${fullEpCode} demain` };
          if (diffDays <= 7 && diffDays > 0) return { isUpcoming: true, label: `${fullEpCode} dans ${diffDays} jours` };
          if (diffDays > 0) return { isUpcoming: true, label: `${fullEpCode} le ${formatAirDateSafe(airDate, 'short')}` };
        }
        return { isUpcoming: true, label: `${fullEpCode} bientôt` };
      }

      const prefix = hasSeenMedia ? "Reprendre" : "Commencer";
      return { isUpcoming: false, label: `${prefix} • ${fullEpCode}` };
    };

    const epStatus = getEpStatus();

    if (epStatus) {
      if (epStatus.isUpcoming) {
        buttonLabel = epStatus.label;
        ButtonIcon = Calendar;
        buttonStyle = "bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-700";
      } else {
        buttonLabel = epStatus.label;
        ButtonIcon = CheckCircle2;
        buttonStyle = "bg-[#E5A93D] text-black hover:bg-[#F5B94D] shadow-lg";
      }
      handleAction = () => {
        onShowClick(media.id, 'tv');
        onClose();
      };
    } else if (checkIsUpToDate(show)) {
      buttonLabel = "À jour sur la diffusion";
      ButtonIcon = CheckCircle2;
      buttonStyle = "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30";
      handleAction = () => {
        onShowClick(media.id, 'tv');
        onClose();
      };
    } else {
      buttonLabel = "Voir les épisodes";
      ButtonIcon = CheckCircle2;
      buttonStyle = "bg-[#E5A93D] text-black hover:bg-[#F5B94D]";
      handleAction = () => {
        onShowClick(media.id, 'tv');
        onClose();
      };
    }
  } else {
    // Movie
    const isSeenMovie = show.seenEpisodes?.includes('movie') || (show.status as string) === 'completed' || isWatched;
    if (isSeenMovie) {
      buttonLabel = "Revoir le film";
      ButtonIcon = RotateCcw;
      buttonStyle = "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 shadow-sm";
      handleAction = () => {
        onShowClick(media.id, 'movie');
        onClose();
      };
    } else {
      buttonLabel = "Marquer comme vu";
      ButtonIcon = Check;
      buttonStyle = "bg-[#E5A93D] text-black hover:bg-[#F5B94D] shadow-lg";
      handleAction = () => {
        if (onToggleWatched) onToggleWatched(media);
        onClose();
      };
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm max-h-[85vh] bg-[#1a1a1a] rounded-[24px] overflow-hidden shadow-2xl border border-white/10 animate-in fade-in zoom-in-95 duration-200 flex flex-col">
        {/* En-tête Vidéo / Backdrop */}
        <div className="relative aspect-video w-full rounded-t-[24px] overflow-hidden bg-black shrink-0">
          {trailerKey ? (
            <iframe
              src={`https://www.youtube.com/embed/${trailerKey}?autoplay=1&mute=1&controls=1&loop=1&playlist=${trailerKey}&rel=0&modestbranding=1&origin=${window.location.origin}`}
              title={`Bande-annonce ${displayTitle}`}
              className="w-full h-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          ) : (
            <>
              {media.backdrop_path ? (
                <img 
                  src={`https://image.tmdb.org/t/p/w500${media.backdrop_path}`} 
                  className="w-full h-full object-cover"
                  alt={displayTitle}
                />
              ) : media.poster_path ? (
                <img 
                  src={`https://image.tmdb.org/t/p/w500${media.poster_path}`} 
                  className="w-full h-full object-cover opacity-50"
                  alt={displayTitle}
                />
              ) : null}
              <div className="absolute inset-0 bg-gradient-to-t from-[#1a1a1a] to-transparent pointer-events-none" />
              {loadingTrailer && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
                  <Loader2 className="w-6 h-6 text-[#E5A93D] animate-spin" />
                </div>
              )}
            </>
          )}
          <button 
            onClick={onClose}
            className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md hover:bg-black/80 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>
        
        {/* Corps d'informations & Synopsis */}
        <div className="p-6 bg-[#1a1a1a] rounded-b-[24px] flex flex-col gap-4 overflow-y-auto min-h-0">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className={cn(
                "text-[10px] font-bold px-2.5 py-1 rounded-md flex items-center gap-1.5 uppercase tracking-wider shadow-sm",
                isTv ? "bg-indigo-600 text-white" : isAtCinema ? "bg-[#E5A93D] text-black" : isUpcoming ? "bg-purple-600 text-white" : "bg-rose-600 text-white"
              )}>
                {isTv ? <Tv size={12} /> : isAtCinema ? <Ticket size={12} /> : isUpcoming ? <Calendar size={12} /> : <Film size={12} />}
                {isTv ? 'Série' : isAtCinema ? 'Au Cinéma' : isUpcoming ? 'À Venir' : 'Film'}
              </span>
              {year && (!(!isTv && isAtCinema)) && <span className="text-zinc-400 text-xs font-semibold">{year}</span>}
              {year && (!(!isTv && isAtCinema)) && rating && <span className="text-zinc-400 text-xs font-semibold">·</span>}
              {rating && (
                <div className="flex items-center gap-1 text-xs font-semibold">
                  <Star size={12} className="text-[#E5A93D] fill-[#E5A93D]" />
                  <span className="text-[#E5A93D]">{rating}</span>
                </div>
              )}
            </div>

            <h2 
              onClick={() => {
                onShowClick(media.id, isTv ? 'tv' : 'movie');
                onClose();
              }}
              className="text-2xl font-black text-white hover:text-[#E5A93D] tracking-tight leading-tight mb-2 cursor-pointer transition-colors"
            >
              {displayTitle}
            </h2>
            
            <div className="max-h-36 overflow-y-auto pr-1 text-sm text-zinc-300 leading-relaxed scrollbar-thin scrollbar-thumb-zinc-700">
              <p>
                {overview || "Aucun synopsis disponible."}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 mt-2 pt-2 shrink-0">
            <button 
              onClick={handleAction}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-xs uppercase tracking-wider transition-transform active:scale-95 cursor-pointer",
                buttonStyle
              )}
            >
              <ButtonIcon size={16} />
              <span className="truncate">{buttonLabel}</span>
            </button>

            <button 
              onClick={() => {
                onShowClick(media.id, isTv ? 'tv' : 'movie');
                onClose();
              }}
              className="w-11 h-11 flex items-center justify-center rounded-xl font-bold text-white bg-white/10 hover:bg-white/20 transition-transform active:scale-95 shrink-0 cursor-pointer"
              title="Détails"
            >
              <Info size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export const QuickPreviewModal = PreviewModal;
export default GridMediaCard;
