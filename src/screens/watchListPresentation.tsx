import React, { startTransition, useState, useEffect, useRef, useMemo, useCallback, type RefObject } from 'react';
import { type Show } from '../types';
import { cn, getNextEpisodeNumber, scrollAllCarouselsToStart, checkIsUpToDate, getAiredProgress } from '../lib/utils';
import { ContinueWatchingCard } from '../components/cards/ContinueWatchingCard';
import { MovieWatchCard } from '../components/cards/MovieWatchCard';
import { ShowNewsFeed } from '../components/ShowNewsFeed';
import { UpToDateShowCard, getUpToDateOrNewSeasonCategory } from '../components/cards/UpToDateShowCard';
import { UpcomingShowCard, getUpcomingEpisodeInfo } from '../components/cards/UpcomingShowCard';
import { HistoryFeed } from '../components/HistoryFeed';
import { EpisodeDetailModal } from './EpisodeDetailModal';
import { PersonDetailModal } from './PersonDetailModal';
import { tmdb } from '../features/shows/tmdb';
import { markEpisodeWatched } from '../features/shows/markEpisodeWatched';
import { getFormattedProviderLogo } from '../utils/providerLogos';
import { User, Circle, CheckCircle2, Trash2, Archive, X, Clock, Ban } from 'lucide-react';
import { auth, db } from '../lib/firebase';
import { doc, setDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { SyncStatusIndicator } from '../components/SyncStatusIndicator';
import { useShows } from '../hooks/useShows';
import { useToastStore } from '../store/toastStore';
import { useSyncStore } from '../store/syncStore';
import { useShowsStore } from '../store/showsStore';
import { useLogStore } from '../store/logStore';
import { SwipeableCard } from '../components/cards/SwipeableCard';
import { SeenItLogo } from '../components/SeenItLogo';
import { SeenItCheckButton } from '../components/SeenItCheckButton';
import { useHorizontalVirtualWindow } from '../hooks/useBoundedVirtualWindow';
import { usePassiveWatchProvider } from '../hooks/usePassiveWatchProvider';
import { createWatchProviderRequestLimiter } from '../features/providers/watchProviderRequestPolicy';
import { createPassiveCardEnrichmentGate } from '../features/providers/passiveCardEnrichmentPolicy';
import { hasAiredEpisodeEvidence } from '../features/watchlist/watchAvailability';

const watchlistMovieDetailLimiter = createWatchProviderRequestLimiter(2);
const watchlistMovieDetailGate = createPassiveCardEnrichmentGate(240);

interface ExpandedItemCardProps {
  key?: React.Key;
  show: Show;
  sectionType: 'watchNext' | 'notWatched' | 'upToDate';
  onShowClick: (id: string, mediaType?: 'tv' | 'movie') => void;
  onEpisodeClick: (show: Show, seasonNumber: number, episodeNumber: number) => void;
  onMarkAsSeen: (show: Show) => void;
  onPersonClick?: (personId: number) => void;
}

function formatRuntime(minutes?: number) {
  if (!minutes || isNaN(minutes) || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h${m > 0 ? (m < 10 ? `0${m}` : m) : ''}`;
  return `${m}min`;
}

export function ExpandedItemCard({ show, sectionType, onShowClick, onEpisodeClick, onMarkAsSeen, onPersonClick }: ExpandedItemCardProps) {
  const isMovie = show.mediaType === 'movie';
  const cachedMovieDetails = isMovie && show.tmdbId
    ? tmdb.peekMediaDetails(show.tmdbId, 'movie')
    : null;
  const [movieRuntime, setMovieRuntime] = useState<number | null>((show as any).runtime || cachedMovieDetails?.runtime || null);
  const [movieDetails, setMovieDetails] = useState<any>(cachedMovieDetails);
  const isMountedRef = useRef(true);
  const requestedMovieDetailsRef = useRef<number | null>(cachedMovieDetails ? show.tmdbId : null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const enrichMovieDetails = useCallback(() => {
    if (!isMovie || !show.tmdbId || requestedMovieDetailsRef.current === show.tmdbId) return;
    const requestKey = `movie:${show.tmdbId}`;
    if (!watchlistMovieDetailGate.tryStart(requestKey)) return;
    requestedMovieDetailsRef.current = show.tmdbId;
    void watchlistMovieDetailLimiter.run(() => tmdb.getMovieDetails(show.tmdbId)).then(res => {
      if (!res.ok || !res.value) {
        watchlistMovieDetailGate.fail(requestKey);
        if (isMountedRef.current) requestedMovieDetailsRef.current = null;
        return;
      }
      watchlistMovieDetailGate.succeed(requestKey);
      if (!isMountedRef.current) return;
      setMovieDetails(res.value);
      if (res.value.runtime) {
        setMovieRuntime(current => current || res.value.runtime);
      }
    }).catch(() => {
      watchlistMovieDetailGate.fail(requestKey);
      if (isMountedRef.current) requestedMovieDetailsRef.current = null;
    });
  }, [isMovie, show.tmdbId]);

  const { cardRef, providerLogo, providerName } = usePassiveWatchProvider({
    tmdbId: show.tmdbId,
    mediaType: isMovie ? 'movie' : 'tv',
    title: show.title,
    originalTitle: (show as any).originalTitle || (show as any).original_title,
    year: show.firstAirDate?.slice(0, 4),
    hasKnownProvider: Boolean(show.networks?.length),
    retainInLibraryCache: true,
    onEnrich: enrichMovieDetails,
  });

  let nextEp = show.nextEpisodeToWatch;
  const seen = show.seenEpisodes || [];
  const isCurrentNextSeen = Boolean(nextEp && seen.includes(`${nextEp.season_number}x${nextEp.episode_number}`));

  if (!isMovie && (!nextEp || isCurrentNextSeen) && sectionType !== 'upToDate') {
    if (seen.length > 0) {
      let maxS = 1;
      let maxE = 0;
      seen.forEach(epKey => {
        const [s, e] = epKey.split('x').map(Number);
        if (!isNaN(s) && !isNaN(e)) {
          if (s > maxS || (s === maxS && e > maxE)) {
            maxS = s;
            maxE = e;
          }
        }
      });
      nextEp = { season_number: maxS, episode_number: maxE + 1 };
    } else {
      nextEp = { season_number: 1, episode_number: 1 };
    }
  }

  let sNum = nextEp?.season_number ?? 1;
  let eNum = nextEp?.episode_number ?? 1;

  let categoryInfo = null;
  if (!isMovie && sectionType === 'upToDate') {
    categoryInfo = getUpToDateOrNewSeasonCategory(show);
    sNum = show.nextEpisodeToWatch?.season_number
      ?? categoryInfo?.nextEpisodeToAir?.season_number
      ?? categoryInfo?.seasonNumber
      ?? 1;
    eNum = show.nextEpisodeToWatch?.episode_number
      ?? categoryInfo?.nextEpisodeToAir?.episode_number
      ?? 1;
  }

  const poster = show.posterPath || show.backdropPath;
  const imgSrc = poster
    ? (poster.startsWith('http') ? poster : `https://image.tmdb.org/t/p/w300${poster}`)
    : null;

  const networkLogo = getFormattedProviderLogo(
    providerLogo || (show.networks && show.networks.length > 0 ? show.networks[0].logo_path : null),
    providerName || (show.networks && show.networks.length > 0 ? show.networks[0].name : (show as any).network || (show as any).platform)
  );

  let subtitleText = '';
  if (!isMovie) {
    if (sectionType === 'upToDate' && categoryInfo) {
      if (categoryInfo.type === 'NEW_SEASON') {
        subtitleText = `Nouvelle Saison ${categoryInfo.seasonNumber || 1} dispo`;
      } else if (categoryInfo.nextEpisodeToAir?.air_date) {
        const airFormatted = new Date(categoryInfo.nextEpisodeToAir.air_date + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
        subtitleText = `Ép. ${categoryInfo.nextEpisodeToAir.episode_number} le ${airFormatted}`;
      } else {
        subtitleText = 'À jour';
      }
    } else {
      if (show.episodeRecords && Object.keys(show.episodeRecords).length > 0) {
        const entries = Object.entries(show.episodeRecords)
          .map(([key, val]) => ({
            key,
            val,
            time: val && val.watchedAt ? parseTimestamp(val.watchedAt) : 0
          }))
          .filter(item => item.time > 0)
          .sort((a, b) => b.time - a.time);

        if (entries.length > 0) {
          const { key, time } = entries[0];
          let s = '', e = '';
          if (key.includes('x')) {
            const parts = key.split('x');
            s = parts[0];
            e = parts[1];
          } else {
            const match = key.match(/S(\d+)E(\d+)/i);
            if (match) {
              s = match[1];
              e = match[2];
            }
          }
          if (s && e && time > 0) {
            const diff = Date.now() - time;
            const h = Math.floor(diff / (1000 * 60 * 60));
            let timeAgoStr = "";
            if (h < 1) timeAgoStr = "il y a < 1h";
            else if (h < 24) timeAgoStr = `il y a ${h}h`;
            else {
              const d = Math.floor(h / 24);
              timeAgoStr = `il y a ${d}j`;
            }
            subtitleText = `Vu S${s.padStart(2, '0')}E${e.padStart(2, '0')} • ${timeAgoStr}`;
          }
        }
      }
      if (!subtitleText) {
        subtitleText = 'Pas encore commencé';
      }
    }
  }

  const episodeTitle = show.nextEpisodeToWatch?.name
    || (sectionType === 'upToDate' ? categoryInfo?.nextEpisodeToAir?.name : undefined)
    || nextEp?.name;

  const handleCardClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isMovie) {
      if (onShowClick && show.id) {
        onShowClick(show.id, 'movie');
      }
    } else if (onEpisodeClick) {
      onEpisodeClick(show, sNum, eNum);
    } else if (onShowClick && show.id) {
      onShowClick(show.id, show.mediaType);
    }
  };

  const movieYear = show.firstAirDate?.slice(0, 4)
    || movieDetails?.release_date?.slice(0, 4)
    || (show as any).release_date?.slice(0, 4)
    || (show as any).releaseDate?.slice(0, 4)
    || ((show as any).year ? String((show as any).year) : null);

  const movieMetaParts: string[] = [];
  if (movieYear) movieMetaParts.push(movieYear);
  const formattedMovieRuntime = formatRuntime(movieRuntime || undefined);
  if (formattedMovieRuntime) movieMetaParts.push(formattedMovieRuntime);
  const movieMetaStr = movieMetaParts.join(' • ') || 'Film';

  // Genre / Thème du film (un seul style au lieu de deux)
  const movieGenres: string[] = [];
  if (movieDetails?.genres && Array.isArray(movieDetails.genres)) {
    movieDetails.genres.forEach((g: any) => {
      if (g?.name) movieGenres.push(g.name);
    });
  } else if ((show as any).genres && Array.isArray((show as any).genres)) {
    (show as any).genres.forEach((g: any) => {
      if (typeof g === 'string') movieGenres.push(g);
      else if (g?.name) movieGenres.push(g.name);
    });
  }
  const singleGenre = movieGenres[0] || '';

  // 3 Acteurs principaux
  const topCast: any[] = (movieDetails?.credits?.cast || []).slice(0, 3);

  return (
    <div
      ref={cardRef}
      onClick={handleCardClick}
      className="w-full flex items-stretch justify-between gap-3 bg-zinc-900/60 hover:bg-zinc-900/80 rounded-2xl overflow-hidden relative isolate transition-all active:scale-[0.98] cursor-pointer group"
    >
      {/* OVERLAY PREMIUM : Bordure interne parfaite + Effet lumière */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10 group-hover:ring-white/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.12)] transition-all z-20" />
      <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-white/[0.04] to-transparent opacity-0 group-hover:opacity-100 transition-opacity z-10" />

      {networkLogo && (
        <div className="absolute top-0 right-0 z-30 bg-white/95 backdrop-blur-md w-7 h-7 rounded-bl-xl p-1 flex items-center justify-center shrink-0 shadow-sm pointer-events-none">
          <img src={networkLogo} alt="" className="w-5 h-5 object-contain rounded-[3px]" />
        </div>
      )}

      <div className="w-[65px] sm:w-[75px] shrink-0 bg-zinc-950 rounded-l-2xl overflow-hidden flex items-center justify-center relative z-20 min-h-[90px]">
        {imgSrc ? (
          <img
            loading="lazy"
            decoding="async"
            src={imgSrc}
            alt={show.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] text-zinc-600 p-1 text-center font-bold">
            {show.title}
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 py-2.5 px-0.5 flex flex-col justify-center relative z-20">
        <div className={cn("flex items-center gap-2 min-w-0", networkLogo ? "pr-10" : "pr-1")}>
          <h4
            onClick={(e) => { e.stopPropagation(); if (show.id) onShowClick(show.id, show.mediaType); }}
            className="text-[#E5A93D] font-extrabold text-xs sm:text-[13px] uppercase tracking-wider line-clamp-2 cursor-pointer hover:underline text-left leading-tight"
          >
            {show.title}
          </h4>
        </div>

        {isMovie ? (
          <div className="flex flex-col gap-0.5 my-0.5 min-w-0">
            {/* Année • Durée • Style (1 genre) sur UNE SEULE LIGNE avec couleurs distinctes */}
            <div className="flex items-center gap-1.5 text-xs min-w-0 leading-tight truncate">
              {movieYear && (
                <span className="text-indigo-400 font-bold shrink-0">
                  {movieYear}
                </span>
              )}
              {movieYear && formattedMovieRuntime && (
                <span className="text-zinc-600 shrink-0">•</span>
              )}
              {formattedMovieRuntime && (
                <span className="text-sky-400 font-semibold shrink-0">
                  {formattedMovieRuntime}
                </span>
              )}
              {(movieYear || formattedMovieRuntime) && singleGenre && (
                <span className="text-zinc-600 shrink-0">•</span>
              )}
              {singleGenre && (
                <span className="text-zinc-300 font-normal truncate">
                  {singleGenre}
                </span>
              )}
            </div>

            {/* 3 Acteurs principaux pouvant aller sur 2 lignes */}
            {topCast.length > 0 && (
              <div className="text-[11px] text-zinc-400 font-medium line-clamp-2 mt-0.5 min-w-0 leading-snug" onClick={(e) => e.stopPropagation()}>
                <span className="text-zinc-500 mr-1 font-normal">Avec</span>
                {topCast.map((actor: any, idx: number) => (
                  <span key={`actor_${actor.id}_${idx}`}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (actor.id && onPersonClick) {
                          onPersonClick(actor.id);
                        }
                      }}
                      className="text-zinc-300 hover:text-[#E5A93D] hover:underline cursor-pointer transition-colors"
                      title={`Voir la filmographie de ${actor.name}`}
                    >
                      {actor.name}
                    </button>
                    {idx < topCast.length - 1 && <span className="text-zinc-500 mr-1">, </span>}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <p className="text-white font-bold text-sm line-clamp-1 leading-snug my-0.5">
              S{String(sNum).padStart(2, '0')} | E{String(eNum).padStart(2, '0')}
              {episodeTitle ? ` • ${episodeTitle}` : ''}
            </p>

            <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
              <span className="text-emerald-400 text-xs font-semibold flex items-center gap-1 truncate">
                <Clock size={12} className="shrink-0" />
                <span className="truncate">{subtitleText}</span>
              </span>
            </div>
          </>
        )}
      </div>

      <div className={cn("pr-2 flex items-center justify-center shrink-0 relative z-20", networkLogo && "pt-3.5")}>
        <SeenItCheckButton
          onClick={(e) => {
            e.stopPropagation();
            onMarkAsSeen(show);
          }}
          size={30}
          title="Marquer comme vu"
        />
      </div>
    </div>
  );
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
export const WATCHLIST_BATCH_SIZE = 8;
const WATCHLIST_CAROUSEL_OVERSCAN = 3;

interface ProgressiveWatchlistCarouselProps {
  id: string;
  data: Show[];
  renderCard: (show: Show) => React.ReactNode;
}

export function ProgressiveWatchlistCarousel({ id, data, renderCard }: ProgressiveWatchlistCarouselProps) {
  const {
    containerRef: scrollContainerRef,
    itemMeasureRef,
    range,
    leadingSpacerSize,
    trailingSpacerSize,
  } = useHorizontalVirtualWindow(data.length, WATCHLIST_BATCH_SIZE, WATCHLIST_CAROUSEL_OVERSCAN);
  const visibleItems = data.slice(range.start, range.end);

  return (
    <div
      ref={scrollContainerRef}
      id={id}
      className="flex overflow-x-auto gap-4 px-4 sm:px-6 scrollbar-none pb-1"
    >
      {leadingSpacerSize > 0 && (
        <div aria-hidden="true" className="shrink-0" style={{ width: leadingSpacerSize }} />
      )}
      {visibleItems.map((show, index) => (
        <div key={show.id || `${show.mediaType}_${show.tmdbId}`} ref={index === 0 ? itemMeasureRef : undefined} className="shrink-0">
          {renderCard(show)}
        </div>
      ))}
      {trailingSpacerSize > 0 && (
        <div aria-hidden="true" className="shrink-0" style={{ width: trailingSpacerSize }} />
      )}
    </div>
  );
}

export const parseTimestamp = (val: any): number => {
  if (!val) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const num = Number(val);
  if (!isNaN(num) && num > 1000000000) return num;
  const parsed = Date.parse(val);
  return isNaN(parsed) ? 0 : parsed;
};

export const getExplicitLastWatchedTime = (s: Show): number => {
  const seenSet = new Set(s.seenEpisodes || []);
  if (seenSet.size === 0) return 0;

  let maxTime = 0;
  if (s.episodeRecords && Object.keys(s.episodeRecords).length > 0) {
    for (const [key, record] of Object.entries(s.episodeRecords)) {
      if (!record || !record.watchedAt) continue;

      let isSeen = seenSet.has(key);
      if (!isSeen && key.includes('x')) {
        const [season, ep] = key.split('x');
        const formattedKey = `S${season.padStart(2, '0')}E${ep.padStart(2, '0')}`;
        if (seenSet.has(formattedKey)) isSeen = true;
      } else if (!isSeen && key.match(/S(\d+)E(\d+)/i)) {
        const match = key.match(/S(\d+)E(\d+)/i);
        if (match) {
          const normKey = `${parseInt(match[1])}x${parseInt(match[2])}`;
          if (seenSet.has(normKey)) isSeen = true;
        }
      }

      if (isSeen) {
        const t = parseTimestamp(record.watchedAt);
        if (t > maxTime) maxTime = t;
      }
    }
  }

  if (maxTime > 0) return maxTime;

  if (s.lastWatchedAt) {
    const t = parseTimestamp(s.lastWatchedAt);
    if (t > 0) return t;
  }

  return 0;
};

export const getShowLastWatchedTime = (s: Show): number => {
  const explicit = getExplicitLastWatchedTime(s);
  if (explicit > 0) return explicit;

  const lw = parseTimestamp(s.lastWatchedAt);
  if (lw > 0) return lw;

  return parseTimestamp(s.createdAt) || 0;
};

export const getLastWatchedOrUpdatedTime = (s: Show): number => {
  const explicit = getExplicitLastWatchedTime(s);
  const lw = parseTimestamp(s.lastWatchedAt);
  const up = parseTimestamp(s.updatedAt);
  const cr = parseTimestamp(s.createdAt) || 0;
  return Math.max(explicit, lw, up, cr);
};

export const getAddedTime = (s: Show): number => {
  return parseTimestamp(s.createdAt) || 0;
};
