import React from 'react';
import {
  Calendar,
  CheckCircle2,
  Film,
  MonitorPlay,
  Play,
  Plus,
  Star,
  Ticket,
  Tv,
} from 'lucide-react';
import {
  isMovieAtCinema,
  isMovieUpcoming,
  type TMDBMedia,
} from '../features/shows/tmdb';
import { type Show } from '../types';
import { cn } from '../lib/utils';
import { useToastStore } from '../store/toastStore';
import { auth, db } from '../lib/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { useShowsStore } from '../store/showsStore';
import {
  buildHeroOverviewPreview,
  formatHeroEpisode,
  resolveHeroNextEpisode,
} from '../features/discover/heroPresentation';
import {
  DISCOVER_CRITICAL_GRID_ITEMS,
  HERO_PROGRESS_LAYOUT_CLASS,
} from './discoverPresentation';

export const HeroCard = React.memo(function HeroCard({
  media,
  details,
  onShowClick,
  onOpenTrailer,
  rank,
  activeCategory,
  show,
  addShow,
  deleteShow,
}: {
  key?: React.Key;
  media: TMDBMedia;
  details?: Partial<TMDBMedia> & {
    genres?: { name: string }[];
    networks?: { name: string }[];
    production_companies?: { name: string }[];
  };
  onShowClick: (id: number, mediaType?: 'tv' | 'movie') => void;
  onOpenTrailer?: (id: number, mediaType: 'tv' | 'movie') => void;
  rank: number;
  activeCategory?: string;
  show?: Show;
  addShow?: (showData: Omit<Show, 'id' | 'userId'>) => Promise<string>;
  deleteShow?: (id: string) => Promise<void>;
}) {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const { showToast } = useToastStore();

  const isTv = media.media_type === 'tv' || (!media.media_type && activeCategory !== 'Films');
  const isAtCinema = !isTv && (isMovieAtCinema(media) || isMovieAtCinema(details));
  const isUpcoming = !isTv && (isMovieUpcoming(media) || isMovieUpcoming(details));

  const title = media.name || media.title || '';
  const rating = media.vote_average
    ? media.vote_average.toFixed(1)
    : details?.vote_average
      ? details.vote_average.toFixed(1)
      : null;
  const genres = details?.genres?.slice(0, 2).map(genre => genre.name).join(' · ');
  const providerName = isTv
    ? details?.networks?.[0]?.name
    : details?.production_companies?.[0]?.name;
  const overview = media.overview || details?.overview || '';
  const overviewPreview = React.useMemo(
    () => buildHeroOverviewPreview(overview),
    [overview],
  );

  const handleFollowToggle = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!addShow || !deleteShow) return;

    if (show) {
      const savedShow = { ...show };
      await deleteShow(show.id);
      showToast(
        isTv ? 'Série retirée de votre suivi' : 'Film retiré de votre liste',
        'unfollow',
        savedShow,
        async () => {
          if (auth.currentUser && savedShow.id) {
            const docRef = doc(db, 'users', auth.currentUser.uid, 'shows', savedShow.id);
            useShowsStore.getState().addShowOptimistic(savedShow);
            await setDoc(docRef, savedShow);
          }
        },
      );
      return;
    }

    const newShowData = {
      tmdbId: Number(media.id),
      title,
      posterPath: media.poster_path || '',
      backdropPath: media.backdrop_path || details?.backdrop_path || '',
      year: (media.first_air_date || media.release_date || '').substring(0, 4),
      rating: rating ? parseFloat(rating) : undefined,
      mediaType: isTv ? 'tv' : 'movie' as 'tv' | 'movie',
      seasonRecords: {},
      episodeRecords: {},
      status: 'watching' as const,
      updatedAt: Date.now(),
      createdAt: Date.now(),
      seenEpisodes: [],
      isArchived: false,
    };

    const newId = await addShow(newShowData);
    const savedShow = { ...newShowData, id: newId, userId: '' } as Show;

    showToast(
      isTv ? 'Série ajoutée à votre suivi' : 'Film ajouté à votre liste',
      'follow',
      savedShow,
      async () => {
        if (newId) await deleteShow(newId);
      },
    );
  };

  let mainActionText = isTv ? 'Suivre la série' : 'Ajouter aux films';
  let MainActionIcon = Plus;
  let isTracked = false;
  let buttonStyleClass = 'bg-[#E5A93D] text-black hover:bg-[#f3b94c] shadow-[0_4px_15px_rgba(229,169,61,0.25)]';

  if (show && show.status !== 'dropped' && !show.isArchived) {
    isTracked = true;
    MainActionIcon = CheckCircle2;
    const seenCount = show.seenEpisodes?.length || 0;

    if (isTv) {
      const nextEpisode = resolveHeroNextEpisode(show);
      const isCompleted = show.status === 'completed' || (seenCount > 0 && !nextEpisode);

      if (isCompleted) {
        mainActionText = 'À jour sur la diffusion';
        buttonStyleClass = 'bg-emerald-500 text-black hover:bg-emerald-400 shadow-[0_4px_15px_rgba(16,185,129,0.25)]';
      } else {
        const episodeCode = formatHeroEpisode(nextEpisode || { season: 1, episode: 1 });
        mainActionText = seenCount > 0
          ? `Reprendre · ${episodeCode}`
          : `Commencer · ${episodeCode}`;
      }
    } else if (show.seenEpisodes?.length) {
      mainActionText = 'Film vu';
      buttonStyleClass = 'bg-emerald-500 text-black hover:bg-emerald-400 shadow-[0_4px_15px_rgba(16,185,129,0.25)]';
    } else {
      mainActionText = 'Marquer comme vu';
    }
  }

  const displayedOverview = isExpanded ? overview.trim() : overviewPreview.text;

  return (
    <div
      onClick={() => onShowClick(media.id, isTv ? 'tv' : 'movie')}
      className="relative w-full aspect-[4/3] sm:aspect-video overflow-hidden cursor-pointer group snap-center shrink-0 bg-zinc-900"
    >
      <img
        src={`https://image.tmdb.org/t/p/w780${media.backdrop_path || media.poster_path}`}
        alt={title}
        className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
      />
      <div className="absolute bottom-0 inset-x-0 h-[75%] bg-gradient-to-t from-black via-black/75 to-transparent pointer-events-none" />

      <div className="absolute top-0 right-0 bg-[#E5A93D] text-black px-4 py-2.5 rounded-bl-[24px] shadow-[-4px_4px_20px_rgba(229,169,61,0.3)] flex flex-col items-center justify-center z-20">
        <span className="text-xl sm:text-2xl font-black leading-none tracking-tighter">#{rank}</span>
      </div>

      <div className="absolute bottom-0 inset-x-0 px-5 pb-2 flex flex-col justify-end z-10 w-full">
        <div className="flex flex-wrap items-center gap-2 mb-1.5">
          <span
            className={cn(
              'text-[10px] font-bold px-2.5 py-1 rounded-md flex items-center gap-1.5 uppercase tracking-wider shadow-sm',
              isTv ? 'bg-indigo-600 text-white' : 'bg-rose-600 text-white',
            )}
          >
            {isTv ? <Tv size={12} /> : <Film size={12} />}
            {isTv ? 'Série' : 'Film'}
          </span>

          {!isTv && (
            <span
              className={cn(
                'text-[9px] font-extrabold px-2 py-1 rounded-md flex items-center gap-1 uppercase tracking-widest shadow-sm',
                isAtCinema
                  ? 'bg-[#E5A93D] text-black'
                  : isUpcoming
                    ? 'bg-purple-600 text-white'
                    : 'bg-emerald-600 text-white',
              )}
            >
              {isAtCinema
                ? <Ticket size={10} className="text-black" />
                : isUpcoming
                  ? <Calendar size={10} className="text-white" />
                  : <MonitorPlay size={10} />}
              {isAtCinema ? 'Au Cinéma' : isUpcoming ? 'À Venir' : 'Disponible'}
            </span>
          )}
        </div>

        <h2 className="text-2xl sm:text-3xl font-black text-white uppercase tracking-tight leading-[1.05] mb-1 line-clamp-2 drop-shadow-xl">
          {title}
        </h2>

        {overview && (
          <div
            onClick={(event) => {
              event.stopPropagation();
              setIsExpanded((expanded) => !expanded);
            }}
            className="mb-2 cursor-pointer group/synopsis"
          >
            <p className="text-[11.5px] text-zinc-300 leading-snug drop-shadow-md w-full">
              {displayedOverview}
              {!isExpanded && overviewPreview.truncated && '… '}
              {overviewPreview.truncated && (
                <span className="text-[#E5A93D] text-[10px] font-bold uppercase tracking-wide opacity-90 group-hover/synopsis:opacity-100 ml-1 whitespace-nowrap">
                  {isExpanded ? 'VOIR MOINS' : 'VOIR PLUS'}
                </span>
              )}
            </p>
          </div>
        )}

        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-400 mb-2 w-full overflow-hidden">
          {rating && (
            <div className="flex items-center gap-1 shrink-0">
              <Star size={11} className="text-[#E5A93D] fill-[#E5A93D]" />
              <span className="text-[#E5A93D]">{rating}</span>
            </div>
          )}
          {rating && <span className="shrink-0">·</span>}
          {genres && <span className="truncate min-w-0 shrink">{genres}</span>}
          {providerName && (
            <>
              <span className="shrink-0">·</span>
              <span className="text-zinc-300 truncate shrink-0 max-w-[40%]">{providerName}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2.5 w-full mt-1">
          <button
            type="button"
            title={mainActionText}
            onClick={(event) => {
              if (isTracked) {
                event.stopPropagation();
                onShowClick(media.id, isTv ? 'tv' : 'movie');
              } else {
                void handleFollowToggle(event);
              }
            }}
            className={cn(
              'flex-[1.16] min-h-[44px] min-w-0 flex items-center justify-center gap-1.5 py-3 px-2 rounded-xl font-extrabold text-[10.5px] sm:text-xs uppercase tracking-wide transition-transform active:scale-95 shadow-lg cursor-pointer',
              buttonStyleClass,
            )}
          >
            <MainActionIcon size={17} className="shrink-0" />
            <span className="whitespace-nowrap">{mainActionText}</span>
          </button>

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (onOpenTrailer) {
                onOpenTrailer(media.id, isTv ? 'tv' : 'movie');
              } else {
                onShowClick(media.id, isTv ? 'tv' : 'movie');
              }
            }}
            className="flex-[0.84] min-h-[44px] min-w-0 flex items-center justify-center gap-2 py-3 px-2 rounded-xl font-extrabold text-[11px] sm:text-xs uppercase tracking-wide text-white bg-white/10 backdrop-blur-md border border-white/10 hover:bg-white/20 transition-transform active:scale-95 shadow-lg cursor-pointer"
          >
            <Play size={16} className="fill-white shrink-0" />
            <span className="whitespace-nowrap">Trailer</span>
          </button>
        </div>
      </div>
    </div>
  );
});

export function HeroSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="relative w-full aspect-[4/3] sm:aspect-video overflow-hidden bg-zinc-900 animate-pulse">
        <div className="absolute inset-0 bg-zinc-900" />
        <div className="absolute bottom-0 inset-x-0 px-5 pb-4 space-y-3">
          <div className="h-5 w-16 rounded-md bg-zinc-800" />
          <div className="h-7 w-2/3 rounded-lg bg-zinc-800" />
          <div className="h-3 w-5/6 rounded bg-zinc-800" />
          <div className="flex gap-3 pt-1">
            <div className="h-10 flex-1 rounded-xl bg-zinc-800" />
            <div className="h-10 flex-1 rounded-xl bg-zinc-800" />
          </div>
        </div>
      </div>
      <HeroProgressSkeleton />
    </div>
  );
}

export function HeroProgressSkeleton() {
  return (
    <div aria-hidden="true" className={`${HERO_PROGRESS_LAYOUT_CLASS} animate-pulse`}>
      <span className="h-1.5 w-6 rounded-full bg-zinc-700" />
      {Array.from({ length: 9 }).map((_, index) => (
        <span key={index} className="h-1.5 w-1.5 rounded-full bg-zinc-800" />
      ))}
    </div>
  );
}

export function GridSkeletons() {
  return (
    <div aria-hidden="true" className="grid grid-cols-3 sm:grid-cols-4 gap-x-1.5 gap-y-4 px-1">
      {Array.from({ length: DISCOVER_CRITICAL_GRID_ITEMS }).map((_, index) => (
        <div key={index} className="animate-pulse space-y-2">
          <div className="w-full aspect-[2/3] bg-zinc-800 rounded-2xl" />
          <div className="h-3 bg-zinc-800 rounded w-3/4" />
          <div className="h-2.5 bg-zinc-800 rounded w-1/2" />
        </div>
      ))}
    </div>
  );
}
