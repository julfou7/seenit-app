import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShows } from '../hooks/useShows';
import { GridMediaCard, PreviewModal } from '../components/GridMediaCard';
import { type TMDBMedia, isMovieAtCinema } from '../features/shows/tmdb';
import { Inbox } from 'lucide-react';
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

const LIBRARY_ROW_BATCH_SIZE = 6;
const LIBRARY_GRID_BATCH_SIZE = 12;
const LIBRARY_ROW_ROOT_MARGIN = '320px 0px';

const getMediaKey = (mediaType: string | undefined, id: string | number) =>
  `${mediaType === 'movie' ? 'movie' : 'tv'}:${Number(id)}`;

interface LibraryItem {
  media: TMDBMedia;
  show: Show;
}

interface LibrarySectionData {
  id: string;
  title: string;
  emoji: string;
  data: LibraryItem[];
}

const libraryItemCache = new WeakMap<Show, LibraryItem>();

function getLibraryItem(show: Show): LibraryItem {
  const cached = libraryItemCache.get(show);
  if (cached) return cached;

  const item: LibraryItem = {
    show,
    media: {
      id: Number(show.tmdbId),
      name: show.title,
      title: show.title,
      poster_path: show.posterPath,
      backdrop_path: show.backdropPath,
      first_air_date: show.mediaType === 'tv' ? (show.firstAirDate || '2000-01-01') : undefined,
      release_date: show.mediaType === 'movie' ? (show.firstAirDate || '2000-01-01') : undefined,
      media_type: show.mediaType,
      vote_average: show.userRating || 0,
    },
  };
  libraryItemCache.set(show, item);
  return item;
}

function areLibraryItemsEqual(left: LibraryItem[], right: LibraryItem[]): boolean {
  return left === right || (
    left.length === right.length && left.every((item, index) => item === right[index])
  );
}

function findCurrentShow(media: TMDBMedia): Show | undefined {
  const mediaType = media.media_type === 'movie' ? 'movie' : 'tv';
  const mediaKey = getMediaKey(mediaType, media.id);
  return useShowsStore.getState().shows.find(show =>
    show.tmdbId != null && getMediaKey(show.mediaType, show.tmdbId) === mediaKey
  );
}

interface LibraryRowProps {
  data: LibraryItem[];
  onShowClick: (id: any, mediaType?: 'tv' | 'movie') => void;
  onToggleWatched: (media: TMDBMedia) => void;
  onLongPress: (media: TMDBMedia) => void;
  onAddClick: (media: TMDBMedia) => void;
}

const LibraryRow = React.memo(function LibraryRow({
  data,
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
      startTransition(() => {
        setVisibleCount(current => Math.min(data.length, current + LIBRARY_ROW_BATCH_SIZE));
      });
    }
  }, [data.length, visibleCount]);

  return (
    <div
      className="flex overflow-x-auto hide-scrollbar px-4 sm:px-6 scroll-px-4 sm:scroll-px-6 gap-1.5 sm:gap-1.5 pb-2 snap-x snap-mandatory"
      onScroll={handleHorizontalScroll}
    >
      {data.slice(0, visibleCount).map(({ media, show }) => {
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
}, (previous, next) =>
  areLibraryItemsEqual(previous.data, next.data) &&
  previous.onShowClick === next.onShowClick &&
  previous.onToggleWatched === next.onToggleWatched &&
  previous.onLongPress === next.onLongPress &&
  previous.onAddClick === next.onAddClick
);

interface DeferredLibraryRowProps extends LibraryRowProps {
  eager?: boolean;
}

const DeferredLibraryRow = React.memo(function DeferredLibraryRow({
  eager = false,
  ...rowProps
}: DeferredLibraryRowProps) {
  const [shouldRender, setShouldRender] = useState(eager);
  const placeholderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (shouldRender) return;
    const element = placeholderRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setShouldRender(true);
      return;
    }

    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      startTransition(() => setShouldRender(true));
    }, { rootMargin: LIBRARY_ROW_ROOT_MARGIN });
    observer.observe(element);
    return () => observer.disconnect();
  }, [shouldRender]);

  return (
    <div ref={placeholderRef} className={shouldRender ? undefined : 'min-h-[220px]'}>
      {shouldRender ? <LibraryRow {...rowProps} /> : null}
    </div>
  );
}, (previous, next) =>
  previous.eager === next.eager &&
  areLibraryItemsEqual(previous.data, next.data) &&
  previous.onShowClick === next.onShowClick &&
  previous.onToggleWatched === next.onToggleWatched &&
  previous.onLongPress === next.onLongPress &&
  previous.onAddClick === next.onAddClick
);

const ExpandedLibraryGrid = React.memo(function ExpandedLibraryGrid(props: LibraryRowProps) {
  const { data, onShowClick, onToggleWatched, onLongPress, onAddClick } = props;
  const [visibleCount, setVisibleCount] = useState(() => Math.min(LIBRARY_GRID_BATCH_SIZE, data.length));

  useEffect(() => {
    setVisibleCount(current => Math.min(Math.max(current, LIBRARY_GRID_BATCH_SIZE), data.length));
  }, [data.length]);

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-x-1.5 gap-y-4 px-4 sm:px-6">
      {data.slice(0, visibleCount).map(({ media, show }) => (
        <GridMediaCard
          key={getMediaKey(media.media_type, media.id)}
          media={media}
          show={show}
          hideBadges={true}
          showProgress={true}
          onShowClick={onShowClick}
          onToggleWatched={onToggleWatched}
          onLongPress={onLongPress}
          onAddClick={onAddClick}
        />
      ))}
      {visibleCount < data.length && (
        <button
          type="button"
          onClick={() => startTransition(() => {
            setVisibleCount(current => Math.min(data.length, current + LIBRARY_GRID_BATCH_SIZE));
          })}
          className="col-span-full w-full py-3 rounded-xl bg-zinc-900 border border-white/10 text-xs font-bold text-zinc-300 hover:bg-zinc-800 active:scale-[0.98] transition-transform"
        >
          Charger plus
        </button>
      )}
    </div>
  );
}, (previous, next) =>
  areLibraryItemsEqual(previous.data, next.data) &&
  previous.onShowClick === next.onShowClick &&
  previous.onToggleWatched === next.onToggleWatched &&
  previous.onLongPress === next.onLongPress &&
  previous.onAddClick === next.onAddClick
);

interface LibrarySectionProps extends Omit<LibraryRowProps, 'data'> {
  section: LibrarySectionData;
  expanded: boolean;
  eager?: boolean;
  onToggleExpanded: (sectionId: string) => void;
}

const LibrarySection = React.memo(function LibrarySection({
  section,
  expanded,
  eager,
  onToggleExpanded,
  ...rowProps
}: LibrarySectionProps) {
  const contentProps = { ...rowProps, data: section.data };

  return (
    <div className="space-y-3">
      <div className="px-4 sm:px-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
            <span className="text-base">{section.emoji}</span>
            <span>{section.title}</span>
          </h2>
        </div>
        {section.data.length > 3 && (
          <button
            type="button"
            onClick={() => onToggleExpanded(section.id)}
            className="text-xs font-bold text-[#E5A93D] hover:underline cursor-pointer"
          >
            {expanded ? 'Réduire' : 'Voir tout'}
          </button>
        )}
      </div>

      {expanded ? (
        <ExpandedLibraryGrid {...contentProps} />
      ) : (
        <DeferredLibraryRow {...contentProps} eager={eager} />
      )}
    </div>
  );
}, (previous, next) =>
  previous.section.id === next.section.id &&
  previous.section.title === next.section.title &&
  previous.section.emoji === next.section.emoji &&
  areLibraryItemsEqual(previous.section.data, next.section.data) &&
  previous.expanded === next.expanded &&
  previous.eager === next.eager &&
  previous.onToggleExpanded === next.onToggleExpanded &&
  previous.onShowClick === next.onShowClick &&
  previous.onToggleWatched === next.onToggleWatched &&
  previous.onLongPress === next.onLongPress &&
  previous.onAddClick === next.onAddClick
);

export const LibraryScreen = React.memo(function LibraryScreen({ onShowClick, isEmbedded = false }: Props) {
  const { shows, addShow, deleteShow } = useShows();
  const updateShow = useShowsStore(state => state.updateShowOptimistic);
  const showToast = useToastStore(state => state.showToast);

  const [previewMedia, setPreviewMedia] = useState<TMDBMedia | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const handleShowClick = useCallback((id: any, mediaType?: 'tv' | 'movie') => {
    onShowClick(String(id), mediaType);
  }, [onShowClick]);

  const handleLongPress = useCallback((media: TMDBMedia) => {
    setPreviewMedia(media);
  }, []);

  const handleToggleExpanded = useCallback((sectionId: string) => {
    setExpandedSection(current => current === sectionId ? null : sectionId);
  }, []);

  const handleAddMedia = useCallback(async (media: TMDBMedia) => {
    const isTv = media.media_type === 'tv' || media.first_air_date !== undefined;
    const mediaType = isTv ? 'tv' : 'movie';
    const existing = findCurrentShow(media);
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
  }, [addShow, deleteShow, showToast]);

  const handleToggleWatched = useCallback(async (media: TMDBMedia) => {
    const isTv = media.media_type === 'tv' || media.first_air_date !== undefined;
    const existingShow = findCurrentShow(media);
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
  }, [showToast, updateShow]);

  const sections = useMemo(() => {
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
      return isMovieAtCinema(s) || isMovieAtCinema(getLibraryItem(s).media);
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
      { id: 'favorites', title: 'Mes Favoris', emoji: '❤️', data: favorites.map(getLibraryItem) },
      { id: 'watching', title: 'Séries en cours', emoji: '▶️', data: watching.map(getLibraryItem) },
      { id: 'toStartTv', title: 'Séries à commencer', emoji: '🔖', data: toStartTv.map(getLibraryItem) },
      { id: 'upcomingTv', title: 'Séries à venir', emoji: '📅', data: upcomingTv.map(getLibraryItem) },
      { id: 'toWatchCinema', title: 'Films au cinéma', emoji: '🎟️', data: toWatchCinema.map(getLibraryItem) },
      { id: 'toWatchMovie', title: 'Films à voir', emoji: '🎬', data: toWatchMovie.map(getLibraryItem) },
      { id: 'upToDate', title: 'Séries à jour', emoji: '✅', data: upToDate.map(getLibraryItem) },
      { id: 'completedMovies', title: 'Films vus', emoji: '🍿', data: completedMovies.map(getLibraryItem) },
    ].filter(s => s.data.length > 0);
  }, [shows]);

  const previewShow = previewMedia ? findCurrentShow(previewMedia) : undefined;

  const closePreview = useCallback(() => {
    setPreviewMedia(null);
  }, []);

  const handlePreviewShowClick = useCallback((id: any, mediaType?: 'tv' | 'movie') => {
    setPreviewMedia(null);
    handleShowClick(id, mediaType);
  }, [handleShowClick]);

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
          {sections.map((section, index) => (
            <LibrarySection
              key={section.id}
              section={section}
              expanded={expandedSection === section.id}
              eager={index === 0}
              onToggleExpanded={handleToggleExpanded}
              onShowClick={handleShowClick}
              onToggleWatched={handleToggleWatched}
              onLongPress={handleLongPress}
              onAddClick={handleAddMedia}
            />
          ))}
        </div>
      )}

      {previewMedia && (
        <PreviewModal
          media={previewMedia}
          isAdded={Boolean(previewShow)}
          isWatched={Boolean(previewShow && (
            previewShow.status === 'completed' ||
            checkIsUpToDate(previewShow) ||
            previewShow.seenEpisodes?.includes('movie')
          ))}
          onClose={closePreview}
          onAddClick={handleAddMedia}
          onToggleWatched={handleToggleWatched}
          onShowClick={handlePreviewShowClick}
        />
      )}
    </div>
  );
});
