import React, { useState, useEffect } from 'react';
import { Circle, CheckCircle2, Sparkles, Tv, Calendar } from 'lucide-react';
import { SeenItCheckButton } from '../SeenItCheckButton';
import { type Show } from '../../types';
import { getNextEpisodeNumber, getAiredProgress, cn, getTodayStr } from '../../lib/utils';
import { tmdb } from '../../features/shows/tmdb';

interface Props {
  key?: React.Key;
  show: Show;
  onShowClick?: (id: string) => void;
  onEpisodeClick?: (show: Show, seasonNumber: number, episodeNumber: number) => void;
  onMarkAsSeen: (show: Show) => void;
}

export interface UpToDateCategoryInfo {
  type: 'NEW_SEASON' | 'CURRENTLY_AIRING';
  seasonNumber?: number;
  nextEpisodeToAir?: {
    season_number: number;
    episode_number: number;
    air_date: string;
    name?: string;
    episode_count?: number;
    is_final_season?: boolean;
    series_ended?: boolean;
  };
}

export function getUpToDateOrNewSeasonCategory(show: Show): UpToDateCategoryInfo | null {
  if (!show || show.isArchived || show.status === 'dropped') {
    return null;
  }

  const now = Date.now();
  const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

  // --- CONDITION A : "Nouvelle Saison Récente" (-60 jours) ---
  let newSeasonNum: number | null = null;

  if (show.nextEpisodeToWatch) {
    if (show.nextEpisodeToWatch.episode_number === 1 && show.nextEpisodeToWatch.air_date) {
      const airMs = new Date(show.nextEpisodeToWatch.air_date).getTime();
      if (!isNaN(airMs)) {
        const diff = now - airMs;
        if (diff >= 0 && diff <= SIXTY_DAYS_MS) {
          newSeasonNum = show.nextEpisodeToWatch.season_number;
        }
      }
    }
  }

  if (newSeasonNum === null && show.firstAirDate) {
    const airMs = new Date(show.firstAirDate).getTime();
    if (!isNaN(airMs)) {
      const diff = now - airMs;
      if (diff >= 0 && diff <= SIXTY_DAYS_MS) {
        newSeasonNum = 1;
      }
    }
  }

  if (newSeasonNum !== null) {
    return {
      type: 'NEW_SEASON',
      seasonNumber: newSeasonNum
    };
  }

  // --- CONDITION B : "À jour sur une saison en cours de diffusion" ---
  // 1. Verification qu'il n'y a pas d'épisodes déjà sortis en retard
  if (show.nextEpisodeToWatch?.air_date) {
    const nextToWatchAirMs = new Date(show.nextEpisodeToWatch.air_date).getTime();
    if (!isNaN(nextToWatchAirMs) && nextToWatchAirMs <= now) {
      return null;
    }
  }

  // 2. Saison en cours de diffusion (un prochain épisode avec air_date future est programmé)
  if (show.nextEpisodeToAir && show.nextEpisodeToAir.air_date) {
    const airMs = new Date(show.nextEpisodeToAir.air_date).getTime();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    if (!isNaN(airMs) && airMs >= startOfToday.getTime()) {
      return {
        type: 'CURRENTLY_AIRING',
        seasonNumber: show.nextEpisodeToAir.season_number,
        nextEpisodeToAir: show.nextEpisodeToAir
      };
    }
  }

  // EXCLUSIONS : Saison 100% terminée sans épisode futur OU série bloquée sans sortie récente
  return null;
}

export function UpToDateShowCard({ show, onShowClick, onEpisodeClick, onMarkAsSeen }: Props) {
  const categoryInfo = getUpToDateOrNewSeasonCategory(show);

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

  if (!categoryInfo) return null;

  const seenCount = show.seenEpisodes ? show.seenEpisodes.length : 0;
  const progressPercent = getAiredProgress(show);
  const totalCount = show.totalAiredEpisodes || show.totalEpisodes || (show.seasonsCache ? show.seasonsCache.flatMap((s: any) => s.episodes || []).length : 0);
  const isFullyWatched = progressPercent >= 100 || (seenCount > 0 && totalCount > 0 && seenCount >= totalCount);

  const formattedSeasonNum = categoryInfo.seasonNumber 
    ? categoryInfo.seasonNumber.toString().padStart(2, '0')
    : '01';

  const nextEpisodeAirDate = categoryInfo.nextEpisodeToAir?.air_date;
  let isFutureRelease = false;
  let daysRemaining = 0;
  if (nextEpisodeAirDate) {
    const airDateObj = new Date(nextEpisodeAirDate + 'T00:00:00');
    const todayObj = new Date();
    todayObj.setHours(0, 0, 0, 0);
    isFutureRelease = airDateObj.getTime() > todayObj.getTime();
    daysRemaining = Math.ceil((airDateObj.getTime() - todayObj.getTime()) / (1000 * 60 * 60 * 24));
  }

  const formattedAirDateShort = nextEpisodeAirDate
    ? new Date(nextEpisodeAirDate + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
    : 'Prochainement';

  const handleCardClick = () => {
    const sNum = show.nextEpisodeToWatch?.season_number
      ?? categoryInfo.nextEpisodeToAir?.season_number
      ?? categoryInfo.seasonNumber
      ?? 1;
    const eNum = show.nextEpisodeToWatch?.episode_number
      ?? categoryInfo.nextEpisodeToAir?.episode_number
      ?? 1;
    if (onEpisodeClick) {
      onEpisodeClick(show, sNum, eNum);
    } else if (onShowClick && show.id) {
      onShowClick(show.id);
    }
  };

  const networkLogo = providerLogo
    ? (providerLogo.startsWith('http') ? providerLogo : `https://image.tmdb.org/t/p/w92${providerLogo}`)
    : (show.networks && show.networks.length > 0 && show.networks[0].logo_path
        ? `https://image.tmdb.org/t/p/w92${show.networks[0].logo_path}`
        : null);

  return (
    <div 
      className="flex-shrink-0 w-64 flex flex-col cursor-pointer snap-start" 
      onClick={handleCardClick}
    >
      {/* Image Container */}
      <div className="w-full aspect-[4/3] rounded-2xl overflow-hidden relative mb-2 bg-zinc-900">
        {/* Network Logo */}
        {networkLogo && (
          <div className="absolute top-0 right-0 bg-white/95 backdrop-blur-md rounded-bl-xl px-2 py-1 shadow-sm max-h-[28px] flex items-center justify-center z-20 pointer-events-none">
            <img loading="lazy" decoding="async" 
              src={networkLogo} 
              alt="" 
              className="h-4.5 w-auto max-w-[60px] max-h-[20px] object-contain rounded-[2px]" 
            />
          </div>
        )}

        {/* Badge Top-Left */}
        {(() => {
          if (categoryInfo.type === 'NEW_SEASON') {
            let badgeText = `SAISON DISPO 🍿`;
            
            let totalSeasonEps = show.nextEpisodeToWatch?.episode_count 
              || categoryInfo.nextEpisodeToAir?.episode_count 
              || 1;

            let airedInSeason = totalSeasonEps;

            const nextEpToAir = show.nextEpisodeToAir || (show as any).next_episode_to_air || categoryInfo.nextEpisodeToAir;
            const currentSeason = show.nextEpisodeToWatch?.season_number || categoryInfo.seasonNumber;

            let isAiring = false;
            if (nextEpToAir && nextEpToAir.season_number === currentSeason) {
              airedInSeason = Math.max(0, nextEpToAir.episode_number - 1);
              isAiring = true;
            } else if (show.nextEpisodeToWatch?.air_date) {
              const todayStr = getTodayStr();
              if (show.nextEpisodeToWatch.air_date > todayStr) {
                airedInSeason = Math.max(0, show.nextEpisodeToWatch.episode_number - 1);
                isAiring = true;
              }
            }

            if (isAiring && totalSeasonEps <= airedInSeason) {
               // We know it's airing, but we don't know the true total. Just make it larger.
               // We can use nextEpToAir.episode_number if available, or just fallback to '?' in the string
               totalSeasonEps = Math.max(totalSeasonEps, airedInSeason + 1);
            }

            if (isAiring || airedInSeason < totalSeasonEps) {
              if (airedInSeason > 0) {
                const seasonTotal = show.nextEpisodeToWatch?.episode_count || categoryInfo.nextEpisodeToAir?.episode_count;
                const knownTotal = (seasonTotal && seasonTotal >= airedInSeason && seasonTotal > 1) ? seasonTotal : null;
                badgeText = knownTotal ? `${airedInSeason}/${knownTotal} ÉP. DISPOS 🍿` : `${airedInSeason} ÉP. DISPOS 🍿`;
              } else {
                badgeText = `BIENTÔT DISPO ⏳`;
              }
            }

            return (
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 bg-[#E5A93D] text-black text-[10px] font-extrabold px-2.5 py-0.5 rounded-t-lg shadow-lg flex items-center gap-1 uppercase tracking-wider whitespace-nowrap">
                <Sparkles size={11} className="text-black fill-black shrink-0" />
                <span>{badgeText}</span>
              </div>
            );
          }

          if (isFutureRelease) {
            const nextEp = categoryInfo.nextEpisodeToAir;
            const epNum = nextEp?.episode_number;
            const isFinalSeason = nextEp?.is_final_season;
            const episodeCount = nextEp?.episode_count;

            let badgeText = `SAISON ${formattedSeasonNum} DANS ${daysRemaining}J 🚀`;

            if (epNum === 1) {
              if (isFinalSeason && nextEp?.series_ended) {
                badgeText = `ULTIME SAISON DANS ${daysRemaining}J 🏆`;
              } else {
                badgeText = `SAISON ${formattedSeasonNum} DANS ${daysRemaining}J 🚀`;
              }
            } else if (epNum && episodeCount && epNum > 1 && epNum === episodeCount) {
              badgeText = `FIN DE SAISON DANS ${daysRemaining}J 🎬`;
            } else if (epNum) {
              badgeText = `ÉP. ${epNum} DANS ${daysRemaining}J 📅`;
            }

            return (
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 bg-indigo-600 text-white text-[10px] font-extrabold px-2.5 py-0.5 rounded-t-lg shadow-lg backdrop-blur-md uppercase tracking-wider flex items-center gap-1 whitespace-nowrap">
                <Calendar size={11} className="shrink-0" />
                <span>{badgeText}</span>
              </div>
            );
          }

          return (
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 bg-emerald-600 text-white text-[10px] font-extrabold px-2.5 py-0.5 rounded-t-lg shadow-lg backdrop-blur-md uppercase tracking-wider flex items-center gap-1 whitespace-nowrap">
              <Tv size={11} className="shrink-0" />
              <span>Épisode disponible</span>
            </div>
          );
        })()}

        {/* Poster / Backdrop */}
        {(() => {
          const rawPath = show.backdropPath || show.posterPath;
          if (!rawPath) return <div className="w-full h-full bg-zinc-900 flex items-center justify-center text-xs text-zinc-600 p-2 text-center">{show.title}</div>;
          const imgSrc = rawPath.startsWith('http') ? rawPath : `https://image.tmdb.org/t/p/w500${rawPath}`;
          return (
            <img loading="lazy" decoding="async" 
              src={imgSrc}
              alt={show.title}
              className="w-full h-full object-cover"
            />
          );
        })()}
      </div>
      
      {/* Progress Bar */}
      <div className="w-full h-1 bg-zinc-800 rounded-full mb-3 overflow-hidden">
        {seenCount > 0 && progressPercent === 0 && !totalCount ? (
          <div className="h-full w-full bg-zinc-700/50 animate-pulse rounded-full" />
        ) : (
          <div className={cn("h-full rounded-full transition-all duration-500 ease-out", isFullyWatched ? "bg-emerald-500" : "bg-[#E5A93D]")} style={{ width: `${progressPercent}%` }} />
        )}
      </div>

      <div className="flex justify-between items-center">
        <div className="flex flex-col pr-2">
          <button 
            className="text-[#E5A93D] font-extrabold text-xs sm:text-[13px] uppercase tracking-wider mb-1 line-clamp-2 text-left hover:underline leading-tight"
            onClick={(e) => {
              e.stopPropagation();
              if (onShowClick && show.id) {
                onShowClick(show.id);
              }
            }}
          >
            {show.title}
          </button>

          {categoryInfo.type === 'NEW_SEASON' ? (
            <>
              <span className="text-white font-semibold text-sm mb-0.5">
                Nouvelle saison S{formattedSeasonNum}
              </span>
              <span className="text-emerald-400 text-xs font-medium">
                Sortie au cours des 30 derniers jours
              </span>
            </>
          ) : (
            <>
              <span className="text-white font-semibold text-sm mb-0.5">
                {isFutureRelease 
                  ? `S${(categoryInfo.nextEpisodeToAir?.season_number ?? 1).toString().padStart(2, '0')} | E${(categoryInfo.nextEpisodeToAir?.episode_number ?? 1).toString().padStart(2, '0')} le ${formattedAirDateShort}`
                  : `Prochain : S${(categoryInfo.nextEpisodeToAir?.season_number ?? 1).toString().padStart(2, '0')} | E${(categoryInfo.nextEpisodeToAir?.episode_number ?? 1).toString().padStart(2, '0')}`
                }
              </span>
            </>
          )}
        </div>
        
        {categoryInfo.type === 'CURRENTLY_AIRING' || isFullyWatched ? (
          <div className="p-1 -mr-1 -mt-1 text-amber-400" title="À jour">
            <SeenItCheckButton onClick={(e) => e.stopPropagation()} isWatched={true} size={28} />
          </div>
        ) : (
          <SeenItCheckButton 
            onClick={(e) => {
              e.stopPropagation();
              onMarkAsSeen(show);
            }}
            className="-mr-1 -mt-1"
            title="Marquer le prochain épisode comme vu"
          />
        )}
      </div>
    </div>
  );
}
