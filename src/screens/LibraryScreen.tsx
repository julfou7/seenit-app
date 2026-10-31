import { removeTrackedMedia } from '../features/shows/removeTrackedMedia';
import React, { startTransition, useCallback, useEffect, useMemo, useState } from 'react';
import { useShows } from '../hooks/useShows';
import { GridMediaCard, PreviewModal } from '../components/GridMediaCard';
import { HomeLoadMore } from '../components/cards/HomeLoadMore';
import { type TMDBMedia, isMovieAtCinema } from '../features/shows/tmdb';
import { orderWatchMovies } from '../features/watchlist/watchNext18c';
import { Inbox } from 'lucide-react';
import { checkIsUpToDate, getTodayStr } from '../lib/utils';
import { useShowsStore } from '../store/showsStore';
import { useToastStore } from '../store/toastStore';
import { Show } from '../types';
import { SeenItLogo } from '../components/SeenItLogo';
import { cn } from '../lib/utils';
import { buildLibraryMedia } from './libraryPresentation';
import './watchListHome.css';

interface Props {
  onShowClick: (id: string, mediaType?: 'tv' | 'movie') => void;
  isEmbedded?: boolean;
}

const LIBRARY_GRID_BATCH_SIZE = 12;

const getMediaKey = (mediaType: string | undefined, id: string | number) =>
  `${mediaType === 'movie' ? 'movie' : 'tv'}:${Number(id)}`;

interface LibraryItem {
  media: TMDBMedia;
  show: Show;
}

interface LibrarySectionData {
  id: string;
  title: string;
  data: LibraryItem[];
}

const libraryItemCache = new WeakMap<Show, LibraryItem>();

function getLibraryItem(show: Show): LibraryItem {
  const cached = libraryItemCache.get(show);
  if (cached) return cached;

  const item: LibraryItem = {
    show,
    media: buildLibraryMedia(show),
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

interface LibraryGridProps {
  data: LibraryItem[];
  onShowClick: (id: string | number, mediaType?: 'tv' | 'movie') => void;
  onToggleWatched: (media: TMDBMedia) => void;
  onLongPress: (media: TMDBMedia) => void;
  onAddClick: (media: TMDBMedia) => void;
}

const LibrarySectionGrid = React.memo(function LibrarySectionGrid(props: LibraryGridProps) {
  const { data, onShowClick, onToggleWatched, onLongPress, onAddClick } = props;
  const [visibleCount, setVisibleCount] = useState(() => Math.min(LIBRARY_GRID_BATCH_SIZE, data.length));

  useEffect(() => {
    setVisibleCount(current => Math.min(Math.max(current, LIBRARY_GRID_BATCH_SIZE), data.length));
  }, [data.length]);

  return (
    <div className="moi-grid">
      {data.slice(0, visibleCount).map(({ media, show }) => (
        <GridMediaCard
          key={getMediaKey(media.media_type, media.id)}
          media={media}
          show={show}
          showProgress={true}
          onShowClick={onShowClick}
          onToggleWatched={onToggleWatched}
          onLongPress={onLongPress}
          onAddClick={onAddClick}
        />
      ))}
      {visibleCount < data.length && (
        <div className="col-span-full">
          <HomeLoadMore
            items={data.slice(visibleCount).map(item => item.show)}
            step={LIBRARY_GRID_BATCH_SIZE}
            onLoad={() => startTransition(() => {
              setVisibleCount(current => Math.min(data.length, current + LIBRARY_GRID_BATCH_SIZE));
            })}
          />
        </div>
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

export const LibraryScreen = React.memo(function LibraryScreen({ onShowClick, isEmbedded = false }: Props) {
  const { shows, addShow, deleteShow } = useShows();
  const updateShow = useShowsStore(state => state.updateShowOptimistic);
  const showToast = useToastStore(state => state.showToast);

  const [previewMedia, setPreviewMedia] = useState<TMDBMedia | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);

  const handleShowClick = useCallback((id: string | number, mediaType?: 'tv' | 'movie') => {
    onShowClick(String(id), mediaType);
  }, [onShowClick]);

  const handleLongPress = useCallback((media: TMDBMedia) => {
    setPreviewMedia(media);
  }, []);

  const handleAddMedia = useCallback(async (media: TMDBMedia) => {
    const isTv = media.media_type === 'tv' || media.first_air_date !== undefined;
    const mediaType = isTv ? 'tv' : 'movie';
    const existing = findCurrentShow(media);
    if (existing) return;

    const titleToUse = media.name || media.title || media.original_name || media.original_title || '';

    const newShowData: Omit<Show, 'id' | 'userId'> & { year: string; rating?: number; seasonRecords: Record<string, never> } = {
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

    const isTvUpcoming = (s: Show) => {
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

    const isCinemaMovie = (s: Show) => {
      if (s.mediaType !== 'movie') return false;
      if (s.status === 'completed' || s.seenEpisodes?.includes('movie')) return false;
      return isMovieAtCinema(s) || isMovieAtCinema(getLibraryItem(s).media);
    };

    const toWatchCinema = shows.filter(isCinemaMovie);

    const toWatchMovie = orderWatchMovies(shows.filter(
      s => s.mediaType === 'movie' &&
      s.status !== 'completed' &&
      !(s.seenEpisodes?.includes('movie')) &&
      !isCinemaMovie(s)
    ));

    const upToDate = shows.filter(
      s => s.mediaType === 'tv' &&
      (checkIsUpToDate(s) || s.status === 'completed') &&
      s.status !== 'dropped'
    );

    const completedMovies = shows.filter(
      s => s.mediaType === 'movie' &&
      (s.status === 'completed' || s.seenEpisodes?.includes('movie'))
    );

    const result: LibrarySectionData[] = [
      { id: 'favorites', title: 'Favoris', data: favorites.map(getLibraryItem) },
      { id: 'watching', title: 'En cours', data: watching.map(getLibraryItem) },
      { id: 'toStartTv', title: 'À commencer', data: toStartTv.map(getLibraryItem) },
      { id: 'upcomingTv', title: 'À venir', data: upcomingTv.map(getLibraryItem) },
      { id: 'toWatchCinema', title: 'Au cinéma', data: toWatchCinema.map(getLibraryItem) },
      { id: 'toWatchMovie', title: 'Films à voir', data: toWatchMovie.map(getLibraryItem) },
      { id: 'upToDate', title: 'À jour', data: upToDate.map(getLibraryItem) },
      { id: 'completedMovies', title: 'Films vus', data: completedMovies.map(getLibraryItem) },
    ];
    return result.filter(s => s.data.length > 0);
  }, [shows]);

  // Une section vidée entre-temps laisse la place à En cours, puis à la première restante.
  const activeSection = sections.find(section => section.id === selectedSectionId)
    ?? sections.find(section => section.id === 'watching')
    ?? sections[0];

  const previewShow = previewMedia ? findCurrentShow(previewMedia) : undefined;

  const closePreview = useCallback(() => {
    setPreviewMedia(null);
  }, []);

  const handlePreviewShowClick = useCallback((id: string | number, mediaType?: 'tv' | 'movie') => {
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
        <div className={cn("moi-empty", !isEmbedded && "pt-20")}>
          <Inbox size={32} className="text-zinc-600" aria-hidden="true" />
          <strong>Ta liste est vide</strong>
          <span>Ajoute une série ou un film depuis Explorer pour le retrouver ici.</span>
        </div>
      ) : (
        <div className="pb-2">
          <div className="moi-chips" role="group" aria-label="Sections de Ma liste">
            {sections.map(section => {
              const selected = section.id === activeSection?.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  className="moi-chip"
                  aria-pressed={selected}
                  onClick={() => startTransition(() => setSelectedSectionId(section.id))}
                >
                  {section.title}
                  <span className="moi-chip-count">{section.data.length}</span>
                </button>
              );
            })}
          </div>
          {activeSection && (
            <LibrarySectionGrid
              key={activeSection.id}
              data={activeSection.data}
              onShowClick={handleShowClick}
              onToggleWatched={handleToggleWatched}
              onLongPress={handleLongPress}
              onAddClick={handleAddMedia}
            />
          )}
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
          onRemoveClick={media => { const show = findCurrentShow(media); if (show) return removeTrackedMedia(show, deleteShow); }}
          onToggleWatched={handleToggleWatched}
          onShowClick={handlePreviewShowClick}
        />
      )}
    </div>
  );
});
