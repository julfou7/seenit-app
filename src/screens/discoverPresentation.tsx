import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Search, Plus, Check, WifiOff, Star, X,
  SlidersHorizontal, ArrowUp, ArrowDown, Film, Tv, Users, User,
  Info, Sparkles, ChevronRight, ChevronDown, CheckCircle, CheckCircle2, Play, Archive, XCircle,
  Ticket, MonitorPlay, Flame, Loader2, Calendar
} from 'lucide-react';
import { tmdb, discoverSeenIt, isMovieAtCinema, isMovieUpcoming, type TMDBMedia } from '../features/shows/tmdb';
import { type Show } from '../types';
import { cn, getNextEpisodeNumber } from '../lib/utils';
import { useShows } from '../hooks/useShows';
import { useToastStore } from '../store/toastStore';
import { PersonCard } from '../components/cards/PersonCard';
import { GridMediaCard, PreviewModal } from '../components/GridMediaCard';
import { PersonDetailModal } from './PersonDetailModal';
import { FilterModal } from '../components/FilterModal';
import { TrailerModal } from '../components/TrailerModal';
import { auth, db } from '../lib/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { useShowsStore } from '../store/showsStore';
import { getRecommendations } from '../lib/recommendations';
import { SeenItGlyph } from '../components/SeenItLogo';
import { useGridVirtualWindow } from '../hooks/useBoundedVirtualWindow';
import { hasMoreTmdbPages } from '../features/discover/discoverPagination';
import {
  discoverTypeForCategory,
  isSearchCompatibleCategory,
  matchesSelectedGenres,
  parseMinimumRating,
} from '../features/discover/filterPolicy';

export function useDebounce<T>(value: T, delay: number): [T] {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return [debouncedValue];
}

export interface Props {
  onShowClick: (id: any, mediaType?: 'tv' | 'movie') => void;
}

export const DISCOVER_GRID_INITIAL_ITEMS = 30;
export const DISCOVER_GRID_OVERSCAN_ROWS = 3;
export const DISCOVER_CRITICAL_GRID_ITEMS = 6;
export const HERO_PROGRESS_LAYOUT_CLASS = "flex h-1.5 items-center justify-center gap-1.5 mt-3 mb-2";

interface BoundedDiscoverGridProps {
  items: TMDBMedia[];
  scrollRootRef: React.RefObject<HTMLDivElement | null>;
  showsByTmdbId: Map<number, Show>;
  onShowClick: Props['onShowClick'];
  onAddClick: (media: TMDBMedia) => void;
  onToggleWatched: (media: TMDBMedia) => void;
  onLongPress: (media: TMDBMedia) => void;
}

export const BoundedDiscoverGrid = React.memo(function BoundedDiscoverGrid({
  items,
  scrollRootRef,
  showsByTmdbId,
  onShowClick,
  onAddClick,
  onToggleWatched,
  onLongPress,
}: BoundedDiscoverGridProps) {
  const {
    gridRef,
    itemMeasureRef,
    range,
    leadingSpacerSize,
    trailingSpacerSize,
  } = useGridVirtualWindow(
    items.length,
    scrollRootRef,
    DISCOVER_GRID_INITIAL_ITEMS,
    DISCOVER_GRID_OVERSCAN_ROWS,
  );
  const visibleItems = items.slice(range.start, range.end);

  return (
    <div ref={gridRef} className="grid grid-cols-3 sm:grid-cols-4 gap-x-1.5 gap-y-4 px-1">
      {leadingSpacerSize > 0 && (
        <div aria-hidden="true" className="col-span-full" style={{ height: leadingSpacerSize }} />
      )}
      {visibleItems.map((item, index) => (
        <div
          key={`grid_${item.media_type || 'media'}_${item.id}`}
          ref={index === 0 ? itemMeasureRef : undefined}
          className="min-w-0"
        >
          <GridMediaCard
            media={item}
            onShowClick={onShowClick}
            show={showsByTmdbId.get(Number(item.id))}
            onAddClick={onAddClick}
            onToggleWatched={onToggleWatched}
            onLongPress={onLongPress}
          />
        </div>
      ))}
      {trailingSpacerSize > 0 && (
        <div aria-hidden="true" className="col-span-full" style={{ height: trailingSpacerSize }} />
      )}
    </div>
  );
});

export const CATEGORIES = [
  { id: "Tout", label: "Tout" },
  { id: "Séries", label: "Séries" },
  { id: "Films", label: "Films" },
  { id: "Top 100", label: "Top 100" },
  { id: "Pépites", label: "Pépites" },
  { id: "Au cinéma", label: "Au cinéma" },
  { id: "Documentaires", label: "Documentaires" },
  { id: "Personnes", label: "Personnes" }
];

export const SORT_OPTIONS = [
  { id: 'popular', label: 'Populaires' },
  { id: 'rating', label: 'Mieux notés' },
  { id: 'date', label: 'Plus récents' },
  { id: 'title', label: 'Ordre alphabétique' }
];

export interface GenreOption {
  id: string;
  label: string;
  tmdbIds: number[];
}

export const GENRE_OPTIONS: GenreOption[] = [
  { id: 'action', label: 'Action & Aventure', tmdbIds: [28, 12, 10759] },
  { id: 'animation', label: 'Animation', tmdbIds: [16] },
  { id: 'comedie', label: 'Comédie', tmdbIds: [35] },
  { id: 'crime', label: 'Crime & Thriller', tmdbIds: [80, 53] },
  { id: 'docu', label: 'Documentaire', tmdbIds: [99] },
  { id: 'drame', label: 'Drame', tmdbIds: [18] },
  { id: 'familial', label: 'Familial', tmdbIds: [10751, 10762] },
  { id: 'fantastique', label: 'Fantastique', tmdbIds: [14, 10765] },
  { id: 'horreur', label: 'Horreur', tmdbIds: [27] },
  { id: 'mystere', label: 'Mystère', tmdbIds: [9648] },
  { id: 'romance', label: 'Romance', tmdbIds: [10749] },
  { id: 'scifi', label: 'Science-Fiction', tmdbIds: [878, 10765] },
  { id: 'western', label: 'Western', tmdbIds: [37] },
  { id: 'guerre', label: 'Guerre & Histoire', tmdbIds: [10752, 36, 10768] }
];

export function checkIsUpToDate(show: any): boolean {
  if (!show || show.status === 'dropped') return false;
  if (show.isArchived) return true;
  if (show.mediaType === 'movie') {
    return show.status === 'completed' || show.seenEpisodes?.includes('movie');
  }
  if (show.status === 'up_to_date' || show.status === 'completed') return true;

  const watchedCount = show.seenEpisodes ? show.seenEpisodes.length : 0;
  if (watchedCount > 0) {
    if (!show.nextEpisodeToWatch) return true;
    if (show.nextEpisodeToWatch.air_date) {
      const airMs = new Date(show.nextEpisodeToWatch.air_date).getTime();
      if (!isNaN(airMs) && airMs > Date.now()) {
        return true;
      }
    }
    if (show.totalEpisodes && show.totalEpisodes > 0 && watchedCount >= show.totalEpisodes) {
      return true;
    }
  }
  return false;
}
