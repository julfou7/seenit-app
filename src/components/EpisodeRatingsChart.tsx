import React, { useState, useEffect } from 'react';
import { Star, ChevronDown, Check, X } from 'lucide-react';
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
  const [isSeasonPickerOpen, setIsSeasonPickerOpen] = useState<boolean>(false);

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

  // Fetch IMDb ratings for the selected season using Cache-First Dexie service with auto-upgrade for ongoing episodes
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

  // Check if we have at least one valid IMDb rating in the season
  const hasAnyImdbRating = React.useMemo(() => {
    return Object.values(imdbRatings).some((data: any) => data && typeof data.rating === 'number' && data.rating > 0);
  }, [imdbRatings]);

  // Check if all aired episodes have IMDb ratings
  const hasFullImdbRatings = React.useMemo(() => {
    if (!episodes || episodes.length === 0) return false;
    const now = new Date();
    const airedEpisodes = episodes.filter((ep: any) => {
      if (!ep.air_date) return false;
      const airDate = new Date(ep.air_date);
      return airDate <= now;
    });

    if (airedEpisodes.length === 0) {
      return hasAnyImdbRating;
    }

    return airedEpisodes.every((ep: any) => {
      const epNum = ep.episode_number;
      const imdbData = epNum !== undefined ? imdbRatings[epNum] : null;
      return imdbData && typeof imdbData.rating === 'number' && imdbData.rating > 0;
    });
  }, [imdbRatings, episodes, hasAnyImdbRating]);

  // Helper to resolve episode rating (IMDb priority if ALL aired episodes have IMDb rating, otherwise 100% TMDB fallback)
  const getEpisodeRatingInfo = (ep: any): { rating: number; source: 'imdb' | 'tmdb' } => {
    if (!ep) return { rating: 0, source: 'tmdb' };
    const epNum = ep.episode_number;
    const imdbData = epNum !== undefined ? imdbRatings[epNum] : null;
    if (hasFullImdbRatings && imdbData && typeof imdbData.rating === 'number' && imdbData.rating > 0) {
      return { rating: imdbData.rating, source: 'imdb' };
    }
    const tmdbRating = ep.vote_average ? Number(ep.vote_average) : 0;
    return { rating: tmdbRating, source: 'tmdb' };
  };

  const getEpisodeVote = (ep: any): number => {
    return getEpisodeRatingInfo(ep).rating;
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
    const epImdbData = epNum !== undefined ? imdbRatings[epNum] : null;

    if (hasFullImdbRatings && epImdbData && epImdbData.imdbId) {
      let isMounted = true;
      getEpisodeImdbVotes(epImdbData.imdbId).then(votes => {
        if (isMounted) {
          if (votes) {
            setActiveEpisodeVotes(votes);
          } else if (activeEpisode.vote_count) {
            setActiveEpisodeVotes(typeof activeEpisode.vote_count === 'number' ? activeEpisode.vote_count.toLocaleString() : String(activeEpisode.vote_count));
          } else {
            setActiveEpisodeVotes(null);
          }
        }
      });
      return () => { isMounted = false; };
    } else {
      if (activeEpisode.vote_count !== undefined && activeEpisode.vote_count !== null && activeEpisode.vote_count > 0) {
        setActiveEpisodeVotes(typeof activeEpisode.vote_count === 'number' ? activeEpisode.vote_count.toLocaleString() : String(activeEpisode.vote_count));
      } else {
        setActiveEpisodeVotes(null);
      }
    }
  }, [activeEpisode, imdbRatings, hasFullImdbRatings]);

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
  }, [episodes, imdbRatings, hasFullImdbRatings]);

  if (!seasons || seasons.length === 0) return null;

  return (
    <div className="bg-zinc-900/90 border border-white/10 rounded-2xl p-3.5 space-y-3 shadow-xl w-full overflow-hidden">
      {/* 1. Header Row: Title on Left, Season Selector strictly on Right */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/5">
        <h3 className="text-xs font-extrabold text-white uppercase tracking-wider shrink-0">
          Notes par épisode
        </h3>

        {/* Season Selector : Custom Modal Picker if > 3 seasons, else horizontal pills */}
        {validSeasons.length > 3 ? (
          <div className="shrink-0">
            <button
              type="button"
              onClick={() => setIsSeasonPickerOpen(true)}
              className="flex items-center gap-1.5 bg-amber-500/10 hover:bg-amber-500/20 active:bg-amber-500/30 border border-amber-500/30 text-amber-400 font-bold text-xs px-2.5 py-1 rounded-xl cursor-pointer transition-all shadow-sm active:scale-95"
            >
              <span>Saison {selectedSeasonNum}</span>
              <ChevronDown size={14} className="text-amber-400 shrink-0" />
            </button>

            {/* Custom Dark Modal Picker for Android/iOS/Web compatibility */}
            {isSeasonPickerOpen && (
              <div 
                className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
                onClick={() => setIsSeasonPickerOpen(false)}
              >
                <div 
                  className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-xs p-4 space-y-3 shadow-2xl animate-scale-in"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between pb-2 border-b border-white/10">
                    <h4 className="text-sm font-extrabold text-white">Sélectionner une saison</h4>
                    <button 
                      type="button"
                      onClick={() => setIsSeasonPickerOpen(false)}
                      className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
                    >
                      <X size={18} />
                    </button>
                  </div>

                  <div className="max-h-64 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                    {validSeasons.map((s) => {
                      const isSelected = s.season_number === selectedSeasonNum;
                      return (
                        <button
                          key={s.id || s.season_number}
                          type="button"
                          onClick={() => {
                            setSelectedSeasonNum(s.season_number);
                            setIsSeasonPickerOpen(false);
                          }}
                          className={cn(
                            "w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all text-left cursor-pointer",
                            isSelected
                              ? "bg-amber-500 text-zinc-950 font-black shadow-md shadow-amber-500/20"
                              : "text-zinc-300 hover:bg-white/5 active:bg-white/10"
                          )}
                        >
                          <span>Saison {s.season_number}</span>
                          {isSelected && <Check size={16} className="text-zinc-950 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1 overflow-x-auto hide-scrollbar shrink-0">
            {validSeasons.map((s) => {
              const isSelected = s.season_number === selectedSeasonNum;
              return (
                <button
                  key={s.id || s.season_number}
                  onClick={() => setSelectedSeasonNum(s.season_number)}
                  className={cn(
                    "px-2 py-0.5 rounded-lg text-[11px] font-bold transition-all duration-200 cursor-pointer active:scale-95 shrink-0",
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
        )}
      </div>

      {/* 2. Subheader Row: Season Average Score + Legend */}
      <div className="flex items-center justify-between gap-2 flex-wrap text-[11px]">
        {seasonStats && (
          <span className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-800/80 border border-white/10 text-[11px] font-bold shrink-0",
            hasFullImdbRatings ? "text-amber-400" : "text-blue-400"
          )}>
            <Star 
              size={11} 
              className={cn(
                "shrink-0",
                hasFullImdbRatings ? "fill-amber-400 text-amber-400" : "fill-blue-400 text-blue-400"
              )} 
            />
            S{selectedSeasonNum} • {seasonStats.average}
            {!hasFullImdbRatings && totalTmdbVotes > 0 && (
              <span className="text-[9px] text-zinc-400 font-normal">
                ({totalTmdbVotes.toLocaleString()})
              </span>
            )}
            <span className={cn(
              "ml-0.5 px-1 py-0.2 text-[9px] font-black rounded border",
              hasFullImdbRatings
                ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                : "bg-blue-500/20 text-blue-300 border-blue-500/30"
            )}>
              {hasFullImdbRatings ? 'IMDb' : 'TMDB'}
            </span>
          </span>
        )}

        <div className="flex items-center gap-2 text-[10px] text-zinc-400 font-medium ml-auto">
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
          <div className="relative pt-4 pb-2 px-1 bg-zinc-950/50 rounded-xl border border-white/5 overflow-hidden">
            {/* Grid lines (2 subtle clean lines, no watermark numbers) */}
            <div className="absolute inset-x-2 top-11 bottom-9 flex flex-col justify-between pointer-events-none opacity-40">
              <div className="border-t border-white/10 w-full" />
              <div className="border-t border-white/5 w-full" />
            </div>

            <div className="relative">
              {/* Row 1: Score labels above bars */}
              <div className="flex items-center justify-between gap-1 sm:gap-2 px-1.5 mb-1 relative z-10">
                {episodes.map((ep: any) => {
                  const vote = getEpisodeVote(ep);
                  const formattedVote = vote > 0 ? vote.toFixed(1) : '-';
                  const colorInfo = getRatingColor(vote);
                  const isActive = activeEpisode?.id === ep.id || activeEpisode?.episode_number === ep.episode_number;

                  return (
                    <div
                      key={ep.id || ep.episode_number}
                      onClick={() => setActiveEpisode(ep)}
                      onMouseEnter={() => setActiveEpisode(ep)}
                      className="flex-1 min-w-[26px] max-w-[44px] text-center cursor-pointer"
                    >
                      <span
                        className={cn(
                          "text-[10px] font-bold block transition-transform duration-200",
                          isActive ? "text-amber-400 font-extrabold scale-110" : colorInfo.text
                        )}
                      >
                        {formattedVote}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Row 2: Bar graphics with the perfectly aligned dashed average line */}
              <div className="relative h-20 mb-2">
                {/* Ligne moyenne de la saison */}
                {seasonStats && Number(seasonStats.average) > 0 && (
                  <div
                    className="absolute left-1 right-1 border-b-2 border-dashed border-amber-400/80 z-20 pointer-events-none"
                    style={{
                      bottom: `${Math.max(10, Math.min(100, (Number(seasonStats.average) / 10) * 100))}%`
                    }}
                  >
                    <span className="absolute bg-amber-500 text-zinc-950 font-black text-[9px] px-1.5 py-0.5 rounded-full shadow-md left-2 -translate-y-1/2 z-30">
                      Moy: {Number(seasonStats.average).toFixed(1)}
                    </span>
                  </div>
                )}

                <div className="flex items-end justify-between gap-1 sm:gap-2 h-full px-1.5 relative z-10">
                  {episodes.map((ep: any) => {
                    const vote = getEpisodeVote(ep);
                    const heightPercent = vote > 0 ? Math.max(12, (vote / 10) * 100) : 10;
                    const isActive = activeEpisode?.id === ep.id || activeEpisode?.episode_number === ep.episode_number;
                    const colorInfo = getRatingColor(vote);

                    return (
                      <div
                        key={ep.id || ep.episode_number}
                        onClick={() => setActiveEpisode(ep)}
                        onMouseEnter={() => setActiveEpisode(ep)}
                        className="flex-1 min-w-[26px] max-w-[44px] h-full flex items-end justify-center group cursor-pointer relative bg-zinc-800/15 rounded-t-sm"
                      >
                        <div
                          style={{ height: `${heightPercent}%` }}
                          className={cn(
                            "w-full rounded-t-sm transition-all duration-300 relative group-hover:brightness-125",
                            colorInfo.bg,
                            isActive ? "ring-2 ring-white/80 shadow-[0_0_10px_rgba(255,255,255,0.3)] brightness-125 scale-[1.02]" : "opacity-85"
                          )}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Row 3: Episode labels below bars */}
              <div className="flex items-center justify-between gap-1 sm:gap-2 px-1.5 relative z-10">
                {episodes.map((ep: any) => {
                  const isActive = activeEpisode?.id === ep.id || activeEpisode?.episode_number === ep.episode_number;

                  return (
                    <div
                      key={ep.id || ep.episode_number}
                      onClick={() => setActiveEpisode(ep)}
                      onMouseEnter={() => setActiveEpisode(ep)}
                      className="flex-1 min-w-[26px] max-w-[44px] text-center cursor-pointer"
                    >
                      <span
                        className={cn(
                          "text-[10px] font-medium block transition-colors",
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
          </div>

          {/* Active Episode Card Detail (Fully Clickable & Clean) */}
          {activeEpisode && (
            <div 
              onClick={() => {
                if (onSelectEpisode) {
                  onSelectEpisode(selectedSeasonNum, activeEpisode);
                }
              }}
              className="bg-zinc-800/70 border border-white/10 hover:border-amber-500/30 hover:bg-zinc-800/90 rounded-xl p-2.5 flex items-center justify-between gap-3 animate-in fade-in duration-200 cursor-pointer group active:scale-[0.99] transition-all shadow-md"
            >
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                {activeEpisode.still_path ? (
                  <img loading="lazy" decoding="async"
                    src={`https://image.tmdb.org/t/p/w185${activeEpisode.still_path}`}
                    alt={activeEpisode.name}
                    className="w-16 h-10 object-cover rounded-lg border border-white/10 shrink-0 group-hover:opacity-90 transition-opacity"
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
                  <h4 className="text-xs font-semibold text-white line-clamp-2 mt-0.5 leading-snug group-hover:text-amber-300 transition-colors">
                    {activeEpisode.name || `Épisode ${activeEpisode.episode_number}`}
                  </h4>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {(() => {
                  const ratingInfo = getEpisodeRatingInfo(activeEpisode);
                  const isImdb = ratingInfo.source === 'imdb';
                  return (
                    <div className={cn(
                      "flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-900/90 border text-xs font-bold shrink-0",
                      isImdb ? "border-amber-500/30 text-amber-400" : "border-blue-500/30 text-blue-400"
                    )}>
                      <Star size={12} className={cn("shrink-0", isImdb ? "fill-amber-400 text-amber-400" : "fill-blue-400 text-blue-400")} />
                      <span className="text-white">
                        {ratingInfo.rating > 0 ? ratingInfo.rating.toFixed(1) : '-'}
                      </span>
                      <span className={cn(
                        "text-[8px] font-black px-1 py-0.2 rounded ml-0.5",
                        isImdb ? "bg-amber-500/20 text-amber-300" : "bg-blue-500/20 text-blue-300"
                      )}>
                        {isImdb ? 'IMDb' : 'TMDB'}
                      </span>
                      {activeEpisodeVotes && (
                        <span className="text-[9px] text-zinc-400 font-normal ml-0.5 whitespace-nowrap">
                          ({activeEpisodeVotes})
                        </span>
                      )}
                    </div>
                  );
                })()}
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
    // Filter out seasons with season_number <= 0 (specials) or with 0 episodes
    const filtered = seasons.filter((s: any) => s.season_number > 0 && s.episode_count > 0);
    return filtered.length > 0 ? filtered : seasons.filter((s: any) => s.episode_count > 0);
  }, [seasons]);
}

