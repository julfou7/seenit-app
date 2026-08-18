import React, { useState, useEffect } from 'react';
import { Star, ChevronRight } from 'lucide-react';
import { cn, formatAirDateSafe } from '../lib/utils';
import { getSeasonImdbRatings, getEpisodeImdbVotes, type EpisodeImdbData } from '../features/shows/omdbService';

interface EpisodeRatingsChartProps {
  effectiveTmdbId: number | string | null;
  imdbId?: string | null;
  seasons: any[];
  seasonsCache: Record<number, any>;
  onLoadSeason: (seasonNumber: number) => Promise<void>;
  onSelectEpisode?: (seasonNumber: number, episode: any) => void;
  defaultSeasonNumber?: number;
}

export const getRatingColor = (voteAverage: number | undefined | null) => {
  if (voteAverage === undefined || voteAverage === null || voteAverage === 0) {
    return {
      bg: 'bg-zinc-700/80',
      text: 'text-zinc-500',
      border: 'border-zinc-700',
      fill: '#52525b',
      label: 'Non noté'
    };
  }

  if (voteAverage >= 8.5) {
    return {
      bg: 'bg-[#34d399]',
      text: 'text-[#34d399]',
      border: 'border-[#34d399]/40',
      fill: '#34d399',
      label: '≥ 8.5'
    };
  }
  if (voteAverage >= 7.5) {
    return {
      bg: 'bg-emerald-600/80',
      text: 'text-emerald-400',
      border: 'border-emerald-500/30',
      fill: '#059669',
      label: '7.5 - 8.4'
    };
  }
  if (voteAverage >= 6.5) {
    return {
      bg: 'bg-amber-500/70',
      text: 'text-amber-400',
      border: 'border-amber-500/30',
      fill: '#f59e0b',
      label: '6.5 - 7.4'
    };
  }
  return {
    bg: 'bg-rose-950/80 border border-rose-500/40',
    text: 'text-rose-400/90',
    border: 'border-rose-500/30',
    fill: '#881337',
    label: '< 6.5'
  };
};

export const EpisodeRatingsChart: React.FC<EpisodeRatingsChartProps> = React.memo(({
  effectiveTmdbId,
  imdbId,
  seasons = [],
  seasonsCache,
  onLoadSeason,
  onSelectEpisode,
  defaultSeasonNumber
}) => {
  // Filter valid seasons (ignore specials season 0 unless it's the only one)
  const validSeasons = useMemoSeasons(seasons);
  const [selectedSeasonNum, setSelectedSeasonNum] = useState<number>(() => {
    if (defaultSeasonNumber !== undefined && validSeasons.some(s => s.season_number === defaultSeasonNumber)) {
      return defaultSeasonNumber;
    }
    return validSeasons[0]?.season_number ?? 1;
  });

  const [activeEpisode, setActiveEpisode] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [imdbRatings, setImdbRatings] = useState<Record<number, EpisodeImdbData>>({});
  const [activeEpisodeVotes, setActiveEpisodeVotes] = useState<string | null>(null);

  // Sync selected season when default change or initial load
  useEffect(() => {
    if (validSeasons.length > 0 && !validSeasons.some(s => s.season_number === selectedSeasonNum)) {
      setSelectedSeasonNum(validSeasons[0].season_number);
    }
  }, [validSeasons]);

  // Load season data if not cached
  useEffect(() => {
    if (!seasonsCache[selectedSeasonNum]) {
      setIsLoading(true);
      onLoadSeason(selectedSeasonNum).finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, [selectedSeasonNum, seasonsCache]);

  // Fetch IMDb ratings for the selected season using Cache-First Dexie service
  useEffect(() => {
    if (!imdbId) {
      setImdbRatings({});
      return;
    }
    let isMounted = true;
    getSeasonImdbRatings(imdbId, selectedSeasonNum).then((ratings) => {
      if (isMounted) {
        setImdbRatings(ratings || {});
      }
    });
    return () => { isMounted = false; };
  }, [imdbId, selectedSeasonNum]);

  const seasonData = seasonsCache[selectedSeasonNum];
  const episodes = seasonData?.episodes || [];

  // Check if we have a valid IMDb rating for the aired episodes of this season
  const hasImdbRatings = React.useMemo(() => {
    if (!episodes || episodes.length === 0) return false;
    
    const now = new Date();
    const airedEpisodes = episodes.filter((ep: any) => {
      if (!ep.air_date) return false;
      const airDate = new Date(ep.air_date);
      return airDate <= now;
    });

    if (airedEpisodes.length === 0) {
      // Si aucun épisode n'a de date de diffusion passée, on regarde si on a quand même des notes IMDb chargées
      return Object.values(imdbRatings).some((data: any) => data && typeof data.rating === 'number' && data.rating > 0);
    }

    return airedEpisodes.every((ep: any) => {
      const epNum = ep.episode_number;
      const imdbData = epNum !== undefined ? imdbRatings[epNum] : null;
      return imdbData && typeof imdbData.rating === 'number' && imdbData.rating > 0;
    });
  }, [imdbRatings, episodes]);

  // Helper to resolve episode rating (IMDb priority if complete/aired, otherwise TMDB)
  const getEpisodeVote = (ep: any): number => {
    if (!ep) return 0;
    const epNum = ep.episode_number;
    const imdbData = epNum !== undefined ? imdbRatings[epNum] : null;
    if (hasImdbRatings && imdbData && typeof imdbData.rating === 'number' && imdbData.rating > 0) {
      return imdbData.rating;
    }
    return ep.vote_average ? Number(ep.vote_average) : 0;
  };

  // Set active episode when episodes change
  useEffect(() => {
    if (episodes.length > 0) {
      setActiveEpisode(episodes[0]);
    } else {
      setActiveEpisode(null);
    }
  }, [selectedSeasonNum, seasonData]);

  // Lazy fetch IMDb votes for the active selected episode
  useEffect(() => {
    if (!activeEpisode) {
      setActiveEpisodeVotes(null);
      return;
    }
    const epNum = activeEpisode.episode_number;
    const epImdbData = (hasImdbRatings && epNum !== undefined) ? imdbRatings[epNum] : null;

    if (epImdbData && epImdbData.imdbId) {
      let isMounted = true;
      getEpisodeImdbVotes(epImdbData.imdbId).then(votes => {
        if (isMounted) setActiveEpisodeVotes(votes);
      });
      return () => { isMounted = false; };
    } else {
      if (activeEpisode.vote_count) {
        setActiveEpisodeVotes(String(activeEpisode.vote_count));
      } else {
        setActiveEpisodeVotes(null);
      }
    }
  }, [activeEpisode, imdbRatings, hasImdbRatings]);

  // Total TMDB votes for the season
  const totalTmdbVotes = React.useMemo(() => {
    if (!episodes || episodes.length === 0) return 0;
    return episodes.reduce((acc: number, ep: any) => acc + (ep.vote_count || 0), 0);
  }, [episodes]);

  // Season Stats
  const seasonStats = React.useMemo(() => {
    if (!episodes || episodes.length === 0) return null;
    const ratedValues = episodes.map((e: any) => getEpisodeVote(e)).filter((v: number) => v > 0);
    if (ratedValues.length === 0) return null;

    const sum = ratedValues.reduce((acc: number, v: number) => acc + v, 0);
    const avg = sum / ratedValues.length;

    return {
      average: avg.toFixed(1),
      count: ratedValues.length,
    };
  }, [episodes, imdbRatings, hasImdbRatings]);

  if (!seasons || seasons.length === 0) return null;

  return (
    <div className="bg-zinc-900/90 border border-white/10 rounded-2xl p-3.5 space-y-3 shadow-xl w-full overflow-hidden">
      {/* 1. Header + Season Selector on a single compact line */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider truncate shrink-0">
            Notes par épisode
          </h3>
          {seasonStats && (
            <span className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-800 border border-white/10 text-[11px] font-bold shrink-0",
              hasImdbRatings ? "text-amber-400" : "text-blue-400"
            )}>
              <Star 
                size={11} 
                className={cn(
                  "shrink-0",
                  hasImdbRatings ? "fill-amber-400 text-amber-400" : "fill-blue-400 text-blue-400"
                )} 
              />
              S{selectedSeasonNum} • {seasonStats.average}
              {!hasImdbRatings && totalTmdbVotes > 0 && (
                <span className="text-[9px] text-zinc-400 font-normal">
                  ({totalTmdbVotes.toLocaleString()})
                </span>
              )}
              <span className={cn(
                "ml-0.5 px-1 py-0.2 text-[9px] font-black rounded border",
                hasImdbRatings
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                  : "bg-blue-500/20 text-blue-300 border-blue-500/30"
              )}>
                {hasImdbRatings ? 'IMDb' : 'TMDB'}
              </span>
            </span>
          )}
        </div>

        {/* Season Selector Pills */}
        <div className="flex items-center gap-1 overflow-x-auto hide-scrollbar flex-1 min-w-0 pb-1">
          {validSeasons.map((s) => {
            const isSelected = s.season_number === selectedSeasonNum;
            return (
              <button
                key={s.id || s.season_number}
                onClick={() => setSelectedSeasonNum(s.season_number)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all duration-200 cursor-pointer active:scale-95 shrink-0",
                  isSelected
                    ? "bg-amber-500 text-zinc-950 font-black shadow-sm"
                    : "bg-zinc-800/80 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-white/5"
                )}
              >
                S{s.season_number}
              </button>
            );
          })}
        </div>
      </div>

      {/* Discrete Color Legend Line */}
      <div className="flex flex-wrap items-center justify-between gap-y-2 text-[10px] text-zinc-400 font-medium">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <span className="flex items-center gap-1 shrink-0">
            <span className="w-2 h-2 rounded-full bg-[#34d399] inline-block"></span> ≥8.5
          </span>
          <span className="flex items-center gap-1 shrink-0">
            <span className="w-2 h-2 rounded-full bg-emerald-600 inline-block"></span> 7.5-8.4
          </span>
          <span className="flex items-center gap-1 shrink-0">
            <span className="w-2 h-2 rounded-full bg-amber-500/70 inline-block"></span> 6.5-7.4
          </span>
          <span className="flex items-center gap-1 shrink-0">
            <span className="w-2 h-2 rounded-full bg-rose-900/80 border border-rose-500/40 inline-block"></span> &lt;6.5
          </span>
        </div>
        <span className={cn(
          "text-[10px] font-medium shrink-0",
          hasImdbRatings ? "text-amber-400/90" : "text-blue-400/90"
        )}>
          Source: {hasImdbRatings ? 'IMDb' : 'TMDB'}
        </span>
      </div>

      {/* Chart Canvas */}
      {isLoading ? (
        <div className="h-36 flex items-center justify-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-amber-400" />
        </div>
      ) : episodes.length === 0 ? (
        <div className="h-28 flex items-center justify-center text-zinc-500 text-xs font-medium">
          Aucun épisode disponible pour cette saison.
        </div>
      ) : (
        <div className="space-y-3">
          {/* Interactive Bar Chart Container */}
          <div className="relative pt-4 pb-2 px-1 bg-zinc-950/50 rounded-xl border border-white/5">
            {/* Grid lines (2 subtle clean lines, no watermark numbers) */}
            <div className="absolute inset-x-2 top-5 bottom-7 flex flex-col justify-between pointer-events-none opacity-40">
              <div className="border-t border-white/10 w-full" />
              <div className="border-t border-white/5 w-full" />
            </div>

            {/* Bars container */}
            <div className="flex items-end justify-between gap-1 sm:gap-2 h-36 overflow-x-auto pb-5 px-1.5 hide-scrollbar relative z-10">
              {episodes.map((ep: any) => {
                const vote = getEpisodeVote(ep);
                const formattedVote = vote > 0 ? vote.toFixed(1) : '-';
                const colorInfo = getRatingColor(vote);
                const isActive = activeEpisode?.id === ep.id || activeEpisode?.episode_number === ep.episode_number;

                // Scale height: minimum 12% so bar is visible even if vote is low
                const heightPercent = vote > 0 ? Math.max(12, (vote / 10) * 100) : 10;

                return (
                  <div
                    key={ep.id || ep.episode_number}
                    onClick={() => setActiveEpisode(ep)}
                    onMouseEnter={() => setActiveEpisode(ep)}
                    className="flex-1 min-w-[26px] max-w-[44px] h-full flex flex-col items-center justify-end group cursor-pointer"
                  >
                    {/* Score Label above bar */}
                    <span
                      className={cn(
                        "text-[10px] font-bold mb-1 transition-transform group-hover:scale-110",
                        isActive ? "text-amber-400 font-extrabold scale-110" : colorInfo.text
                      )}
                    >
                      {formattedVote}
                    </span>

                    {/* Bar graphic */}
                    <div className="w-full bg-zinc-800/60 rounded-t-md p-0.5 h-full flex items-end">
                      <div
                        style={{ height: `${heightPercent}%` }}
                        className={cn(
                          "w-full rounded-t-sm transition-all duration-300 relative group-hover:brightness-125",
                          colorInfo.bg,
                          isActive ? "ring-2 ring-white/80 shadow-[0_0_10px_rgba(255,255,255,0.3)] brightness-125 scale-[1.02]" : "opacity-85"
                        )}
                      />
                    </div>

                    {/* Episode label below bar */}
                    <span
                      className={cn(
                        "text-[10px] font-medium mt-1 transition-colors",
                        isActive ? "text-white font-bold" : "text-zinc-500 group-hover:text-zinc-300"
                      )}
                    >
                      E{ep.episode_number < 10 ? `0${ep.episode_number}` : ep.episode_number}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Active Episode Card Detail (Purified & Clean) */}
          {activeEpisode && (
            <div className="bg-zinc-800/70 border border-white/10 rounded-xl p-2.5 flex items-center justify-between gap-3 animate-in fade-in duration-200">
              <div className="flex items-center gap-2.5 min-w-0">
                {activeEpisode.still_path ? (
                  <img loading="lazy" decoding="async"
                    src={`https://image.tmdb.org/t/p/w185${activeEpisode.still_path}`}
                    alt={activeEpisode.name}
                    className="w-16 h-10 object-cover rounded-lg border border-white/10 shrink-0"
                  />
                ) : (
                  <div className="w-16 h-10 rounded-lg bg-zinc-900 border border-white/10 flex items-center justify-center text-zinc-600 text-[10px] font-bold shrink-0">
                    E{activeEpisode.episode_number < 10 ? `0${activeEpisode.episode_number}` : activeEpisode.episode_number}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-bold uppercase text-amber-400">
                      Épisode {activeEpisode.episode_number}
                    </span>
                    {activeEpisode.air_date && (
                      <span className="text-[10px] text-zinc-400">
                        • {formatAirDateSafe(activeEpisode.air_date, 'short')}
                      </span>
                    )}
                  </div>
                  <h4 className="text-xs font-semibold text-white truncate mt-0.5">
                    {activeEpisode.name || `Épisode ${activeEpisode.episode_number}`}
                  </h4>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-900/90 border border-white/10 text-xs font-bold">
                  <Star size={12} className="fill-amber-400 text-amber-400 shrink-0" />
                  <span className="text-white">
                    {getEpisodeVote(activeEpisode) > 0 ? getEpisodeVote(activeEpisode).toFixed(1) : '-'}
                  </span>
                  {activeEpisodeVotes && (
                    <span className="text-[9px] text-zinc-400 font-normal ml-0.5">
                      ({activeEpisodeVotes})
                    </span>
                  )}
                </div>

                {onSelectEpisode && (
                  <button
                    onClick={() => onSelectEpisode(selectedSeasonNum, activeEpisode)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-lg text-xs font-semibold border border-white/10 transition-all active:scale-95 cursor-pointer"
                  >
                    <span>Détails</span>
                    <ChevronRight size={13} />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

function useMemoSeasons(seasons: any[]) {
  return React.useMemo(() => {
    if (!seasons || seasons.length === 0) return [];
    const filtered = seasons.filter((s: any) => s.season_number > 0);
    return filtered.length > 0 ? filtered : seasons;
  }, [seasons]);
}

