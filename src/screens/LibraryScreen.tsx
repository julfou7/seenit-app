import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useShows } from '../hooks/useShows';
import { GridMediaCard, PreviewModal } from '../components/GridMediaCard';
import { type TMDBMedia, isMovieAtCinema } from '../features/shows/tmdb';
import { Bookmark, Play, CheckCircle2, Heart, Inbox, Ticket, Calendar, Film } from 'lucide-react';
import { checkIsUpToDate, getTodayStr } from '../lib/utils';
import { useShowsStore } from '../store/showsStore';
import { useToastStore } from '../store/toastStore';
import { Show } from '../types';
import { SeenItLogo } from '../components/SeenItLogo';
import { cn } from '../lib/utils';

interface Props {
  onShowClick: (id: string, mediaType?: 'tv' | 'movie') => void;
  isEmbedded?: boolean;
}

const LIBRARY_ROW_BATCH_SIZE = 12;

const getMediaKey = (mediaType: string | undefined, id: string | number) =>
  `${mediaType === 'movie' ? 'movie' : 'tv'}:${Number(id)}`;

interface LibraryRowProps {
  data: TMDBMedia[];
  showsByMediaKey: Map<string, Show>;
  onShowClick: (id: any, mediaType?: 'tv' | 'movie') => void;
  onToggleWatched: (media: TMDBMedia) => void;
  onLongPress: (media: TMDBMedia) => void;
  onAddClick: (media: TMDBMedia) => void;
}

const LibraryRow = React.memo(function LibraryRow({
  data,
  showsByMediaKey,
  onShowClick,
  onToggleWatched,
  onLongPress,
  onAddClick,
}: LibraryRowProps) {
  const [visibleCount, setVisibleCount] = useState(() => Math.min(LIBRARY_ROW_BATCH_SIZE, data.length));

  useEffect(() => {
    setVisibleCount(current => Math.min(Math.max(current, LIBRARY_ROW_BATCH_SIZE), data.length));
  }, [data.length]);

  const handleHorizontalScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    if (visibleCount >= data.length) return;
    const element = event.currentTarget;
    const preloadDistance = Math.max(element.clientWidth, 1);
    if (element.scrollLeft + element.clientWidth >= element.scrollWidth - preloadDistance) {
      setVisibleCount(current => Math.min(data.length, current + LIBRARY_ROW_BATCH_SIZE));
    }
  }, [data.length, visibleCount]);

  return (
    <div
      className="flex overflow-x-auto hide-scrollbar px-4 sm:px-6 scroll-px-4 sm:scroll-px-6 gap-1.5 sm:gap-1.5 pb-2 snap-x snap-mandatory"
      onScroll={handleHorizontalScroll}
    >
      {data.slice(0, visibleCount).map(media => {
        const show = showsByMediaKey.get(getMediaKey(media.media_type, media.id));
        return (
          <div
            key={getMediaKey(media.media_type, media.id)}
            className="w-[calc((100vw-2rem-12px)/3)] sm:w-[calc((100vw-3rem-18px)/4)] md:w-[calc((100vw-3rem-24px)/5)] lg:w-[calc((100vw-3rem-30px)/6)] xl:w-[calc((100vw-3rem-36px)/7)] 2xl:w-[calc((100vw-3rem-42px)/8)] shrink-0 snap-start"
          >
            <GridMediaCard
              media={media}
              show={show}
              hideBadges={true}
              showProgress={true}
              onShowClick={onShowClick}
              onToggleWatched={onToggleWatched}
              onLongPress={onLongPress}
              onAddClick={onAddClick}
            />
          </div>
        );
      })}
      <div className="w-2 shrink-0" />
    </div>
  );
});

export function LibraryScreen({ onShowClick, isEmbedded = false }: Props) {
  const { shows, addShow, deleteShow } = useShows();
  const updateShow = useShowsStore(state => state.updateShowOptimistic);
  const showToast = useToastStore(state => state.showToast);

  const [previewMedia, setPreviewMedia] = useState<TMDBMedia | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const showsByMediaKey = useMemo(() => {
    const map = new Map<string, Show>();
    for (const show of shows) {
      if (show.tmdbId != null) {
        map.set(getMediaKey(show.mediaType, show.tmdbId), show);
      }
    }
    return map;
  }, [shows]);

  const handleShowClick = useCallback((id: any, mediaType?: 'tv' | 'movie') => {
    onShowClick(String(id), mediaType);
  }, [onShowClick]);

  const handleLongPress = useCallback((media: TMDBMedia) => {
    setPreviewMedia(media);
  }, []);

  const handleAddMedia = useCallback(async (media: TMDBMedia) => {
    const isTv = media.media_type === 'tv' || media.first_air_date !== undefined;
    const mediaType = isTv ? 'tv' : 'movie';
    const existing = showsByMediaKey.get(getMediaKey(mediaType, media.id));
    if (existing) return;

    const titleToUse = media.name || media.title || media.original_name || media.original_title || '';

    const newShowData: any = {
      tmdbId: Number(media.id),
      title: titleToUse,
      posterPath: media.poster_path,
      backdropPath: media.backdrop_path,
      year: (media.first_air_date || media.release_date || '').substring(0, 4),
      rating: media.vote_average,
      mediaType,
      seasonRecords: {},
      episodeRecords: {},
      status: isTv ? 'plan_to_watch' : 'watching',
      updatedAt: Date.now(),
      createdAt: Date.now(),
      seenEpisodes: [],
      isArchived: false,
    };

    const newId = await addShow(newShowData);
    const savedShow = { ...newShowData, id: newId, userId: '' } as Show;

    showToast(
      isTv ? `« ${titleToUse} » ajoutée à votre suivi` : `« ${titleToUse} » ajouté à vos films à voir`,
      'follow',
      savedShow,
      async () => {
        if (newId) {
          await deleteShow(newId);
        }
      }
    );
  }, [addShow, deleteShow, showToast, showsByMediaKey]);

  const handleToggleWatched = useCallback(async (media: TMDBMedia) => {
    const isTv = media.media_type === 'tv' || media.first_air_date !== undefined;
    const mediaType = isTv ? 'tv' : 'movie';
    const existingShow = showsByMediaKey.get(getMediaKey(mediaType, media.id));
    if (!existingShow) return;

    const titleToUse = media.name || media.title || '';

    if (isTv) {
      const isUpToDate = checkIsUpToDate(existingShow);
      const isDropped = existingShow.status === 'dropped';
      const isArchived = existingShow.isArchived;

      const oldStatus = existingShow.status;
      const oldSeenEpisodes = existingShow.seenEpisodes || [];
      const oldIsArchived = existingShow.isArchived;

      if (isUpToDate || isDropped || isArchived || existingShow.status === 'completed') {
        await updateShow(existingShow.id, {
          status: 'plan_to_watch',
          seenEpisodes: [],
          isArchived: false,
          updatedAt: Date.now()
        });
        showToast(
          `« ${titleToUse} » remis dans "À voir"`,
          'success',
          existingShow,
          async () => {
            await updateShow(existingShow.id, {
              status: oldStatus,
              seenEpisodes: oldSeenEpisodes,
              isArchived: oldIsArchived,
              updatedAt: Date.now()
            });
          }
        );
      } else {
        await updateShow(existingShow.id, {
          status: 'plan_to_watch',
          seenEpisodes: [],
          updatedAt: Date.now()
        });
        showToast(
          `« ${titleToUse} » remis dans "À voir"`,
          'success',
          existingShow,
          async () => {
            await updateShow(existingShow.id, {
              status: oldStatus,
              seenEpisodes: oldSeenEpisodes,
              updatedAt: Date.now()
            });
          }
        );
      }
    } else {
      const isCurrentlySeen = existingShow.status === 'completed' || existingShow.seenEpisodes?.includes('movie');
      const newStatus = isCurrentlySeen ? 'plan_to_watch' : 'completed';
      const newSeenEpisodes = isCurrentlySeen
        ? (existingShow.seenEpisodes || []).filter((e: string) => e !== 'movie')
        : Array.from(new Set([...(existingShow.seenEpisodes || []), 'movie']));

      const oldStatus = existingShow.status;
      const oldSeenEpisodes = existingShow.seenEpisodes || [];

      await updateShow(existingShow.id, {
        status: newStatus,
        seenEpisodes: newSeenEpisodes,
        updatedAt: Date.now()
      });
      showToast(
        isCurrentlySeen ? `« ${titleToUse} » marqué comme non vu` : `« ${titleToUse} » marqué comme vu`,
        'success',
        existingShow,
        async () => {
          await updateShow(existingShow.id, {
            status: oldStatus,
            seenEpisodes: oldSeenEpisodes,
            updatedAt: Date.now()
          });
        }
      );
    }
  }, [showToast, showsByMediaKey, updateShow]);

  const sections = useMemo(() => {
    const toMedia = (s: any): TMDBMedia => ({
      id: s.tmdbId,
      name: s.title,
      title: s.title,
      poster_path: s.posterPath,
      backdrop_path: s.backdropPath,
      first_air_date: s.mediaType === 'tv' ? (s.firstAirDate || '2000-01-01') : undefined,
      release_date: s.mediaType === 'movie' ? (s.firstAirDate || '2000-01-01') : undefined,
      media_type: s.mediaType,
      vote_average: s.userRating || 0,
    });

    const todayStr = getTodayStr();

    const favorites = shows.filter(s => s.isFavorite);

    const watching = shows.filter(
      s => s.mediaType === 'tv' &&
      (s.seenEpisodes?.length || 0) > 0 &&
      !checkIsUpToDate(s) &&
      s.status !== 'dropped'
    );

    const isTvUpcoming = (s: any) => {
      if (s.mediaType !== 'tv') return false;
      if ((s.seenEpisodes?.length || 0) > 0) return false;
      if (s.firstAirDate && s.firstAirDate > todayStr) return true;
      if (s.totalAiredEpisodes === 0 && s.nextEpisodeToAir?.air_date && s.nextEpisodeToAir.air_date > todayStr) return true;
      return false;
    };

    const toStartTv = shows.filter(
      s => s.mediaType === 'tv' &&
      (s.seenEpisodes?.length || 0) === 0 &&
      !checkIsUpToDate(s) &&
      !isTvUpcoming(s) &&
      s.status !== 'dropped'
    );

    const upcomingTv = shows.filter(
      s => isTvUpcoming(s) && s.status !== 'dropped'
    );

    const isCinemaMovie = (s: any) => {
      if (s.mediaType !== 'movie') return false;
      if (s.status === 'completed' || s.seenEpisodes?.includes('movie')) return false;
      return isMovieAtCinema(s) || isMovieAtCinema(toMedia(s));
    };

    const toWatchCinema = shows.filter(isCinemaMovie);

    const toWatchMovie = shows.filter(
      s => s.mediaType === 'movie' &&
      s.status !== 'completed' &&
      !(s.seenEpisodes?.includes('movie')) &&
      !isCinemaMovie(s)
    );

    const upToDate = shows.filter(
      s => s.mediaType === 'tv' &&
      (checkIsUpToDate(s) || s.status === 'completed') &&
      s.status !== 'dropped'
    );

    const completedMovies = shows.filter(
      s => s.mediaType === 'movie' &&
      (s.status === 'completed' || s.seenEpisodes?.includes('movie'))
    );

    return [
      { id: 'favorites', title: 'Mes Favoris', emoji: '❤️', icon: Heart, data: favorites.map(toMedia) },
      { id: 'watching', title: 'Séries en cours', emoji: '▶️', icon: Play, data: watching.map(toMedia) },
      { id: 'toStartTv', title: 'Séries à commencer', emoji: '🔖', icon: Bookmark, data: toStartTv.map(toMedia) },
      { id: 'upcomingTv', title: 'Séries à venir', emoji: '📅', icon: Calendar, data: upcomingTv.map(toMedia) },
      { id: 'toWatchCinema', title: 'Films au cinéma', emoji: '🎟️', icon: Ticket, data: toWatchCinema.map(toMedia) },
      { id: 'toWatchMovie', title: 'Films à voir', emoji: '🎬', icon: Film, data: toWatchMovie.map(toMedia) },
      { id: 'upToDate', title: 'Séries à jour', emoji: '✅', icon: CheckCircle2, data: upToDate.map(toMedia) },
      { id: 'completedMovies', title: 'Films vus', emoji: '🍿', icon: CheckCircle2, data: completedMovies.map(toMedia) },
    ].filter(s => s.data.length > 0);
  }, [shows]);

  return (
    <div className={cn("flex-1 text-white", !isEmbedded && "overflow-y-auto bg-transparent pb-nav")}>
      {!isEmbedded && (
        <div className="px-4 sm:px-6 pt-6 pb-4 relative">
          <div className="absolute top-0 left-0 w-72 h-40 bg-[#E5A93D]/15 blur-[120px] -z-10 rounded-full mix-blend-screen pointer-events-none" />
          <h1 className="text-3xl font-black tracking-tight text-white mb-1 flex items-center gap-3">
            <SeenItLogo size={34} symbol="library" animated />
            <span>Ma Liste</span>
          </h1>
          <p className="text-xs text-zinc-400 font-medium">Toutes vos œuvres sauvegardées au même endroit.</p>
        </div>
      )}

      {sections.length === 0 ? (
        <div className={cn("flex flex-col items-center justify-center px-6 text-center space-y-4", !isEmbedded && "pt-20")}>
          <div className="w-20 h-20 rounded-full bg-zinc-900 flex items-center justify-center border border-white/5">
            <Inbox size={32} className="text-zinc-600" />
          </div>
          <h2 className="text-lg font-bold text-zinc-300">Votre liste est vide</h2>
          <p className="text-xs text-zinc-500 max-w-[250px]">Vous n'avez pas encore ajouté de séries ou de films à votre liste.</p>
        </div>
      ) : (
        <div className="space-y-8 pb-2">
          {sections.map(section => (
            <div key={section.id} className="space-y-3">
              <div className="px-4 sm:px-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                    <span className="text-base">{section.emoji}</span>
                    <span>{section.title}</span>
                  </h2>
                </div>
                {section.data.length > 3 && (
                  <button
                    onClick={() => setExpandedSection(expandedSection === section.id ? null : section.id)}
                    className="text-xs font-bold text-[#E5A93D] hover:underline cursor-pointer"
                  >
                    {expandedSection === section.id ? 'Réduire' : 'Voir tout'}
                  </button>
                )}
              </div>

              {expandedSection === section.id ? (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-x-1.5 gap-y-4 px-4 sm:px-6">
                  {section.data.map(media => {
                    const show = showsByMediaKey.get(getMediaKey(media.media_type, media.id));
                    return (
                      <GridMediaCard
                        key={getMediaKey(media.media_type, media.id)}
                        media={media}
                        show={show}
                        hideBadges={true}
                        showProgress={true}
                        onShowClick={handleShowClick}
                        onToggleWatched={handleToggleWatched}
                        onLongPress={handleLongPress}
                        onAddClick={handleAddMedia}
                      />
                    );
                  })}
                </div>
              ) : (
                <LibraryRow
                  data={section.data}
                  showsByMediaKey={showsByMediaKey}
                  onShowClick={handleShowClick}
                  onToggleWatched={handleToggleWatched}
                  onLongPress={handleLongPress}
                  onAddClick={handleAddMedia}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {previewMedia && (
        <PreviewModal
          media={previewMedia}
          isAdded={showsByMediaKey.has(getMediaKey(previewMedia.media_type, previewMedia.id))}
          isWatched={(() => {
            const show = showsByMediaKey.get(getMediaKey(previewMedia.media_type, previewMedia.id));
            return Boolean(show && (show.status === 'completed' || checkIsUpToDate(show) || show.seenEpisodes?.includes('movie')));
          })()}
          onClose={() => setPreviewMedia(null)}
          onAddClick={handleAddMedia}
          onToggleWatched={handleToggleWatched}
          onShowClick={(id, mediaType) => {
            setPreviewMedia(null);
            handleShowClick(id, mediaType);
          }}
        />
      )}
    </div>
  );
}
