import React, { useEffect, useState } from 'react';
import { Check, ChevronDown, Star, X } from 'lucide-react';
import { cn } from '../lib/utils';

interface EpisodeRatingsChartProps {
  effectiveTmdbId: number | string | null;
  /** Conservé comme identifiant technique de compatibilité ; aucune note IMDb n'est chargée. */
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
      label: 'Non noté',
    };
  }
  if (voteAverage >= 8.5) {
    return {
      bg: 'bg-[#34d399]',
      text: 'text-[#34d399]',
      border: 'border-[#34d399]/40',
      fill: '#34d399',
      label: 'Excellent',
    };
  }
  if (voteAverage >= 7.5) {
    return {
      bg: 'bg-emerald-600/80',
      text: 'text-emerald-400',
      border: 'border-emerald-500/30',
      fill: '#059669',
      label: 'Très bon',
    };
  }
  if (voteAverage >= 6.5) {
    return {
      bg: 'bg-amber-500/70',
      text: 'text-amber-400',
      border: 'border-amber-500/30',
      fill: '#f59e0b',
      label: 'Bon',
    };
  }
  return {
    bg: 'bg-rose-950/80 border border-rose-500/40',
    text: 'text-rose-400/90',
    border: 'border-rose-500/30',
    fill: '#881337',
    label: 'Faible',
  };
};

export const EpisodeRatingsChart: React.FC<EpisodeRatingsChartProps> = React.memo(({
  effectiveTmdbId,
  seasons = [],
  seasonsCache,
  onLoadSeason,
  onSelectEpisode,
  defaultSeasonNumber,
}) => {
  const validSeasons = useMemoSeasons(seasons);
  const [selectedSeasonNum, setSelectedSeasonNum] = useState<number>(() => {
    if (defaultSeasonNumber !== undefined && validSeasons.some(s => s.season_number === defaultSeasonNumber)) {
      return defaultSeasonNumber;
    }
    return validSeasons[0]?.season_number ?? 1;
  });
  const [activeEpisode, setActiveEpisode] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSeasonPickerOpen, setIsSeasonPickerOpen] = useState(false);

  useEffect(() => {
    if (validSeasons.length > 0 && !validSeasons.some(s => s.season_number === selectedSeasonNum)) {
      setSelectedSeasonNum(validSeasons[0].season_number);
    }
  }, [validSeasons, selectedSeasonNum]);

  useEffect(() => {
    if (!effectiveTmdbId || seasonsCache[selectedSeasonNum]) {
      setIsLoading(false);
      return;
    }
    let mounted = true;
    setIsLoading(true);
    onLoadSeason(selectedSeasonNum).finally(() => {
      if (mounted) setIsLoading(false);
    });
    return () => { mounted = false; };
  }, [effectiveTmdbId, selectedSeasonNum, seasonsCache, onLoadSeason]);

  const seasonData = seasonsCache[selectedSeasonNum];
  const episodes = seasonData?.episodes || [];

  useEffect(() => {
    setActiveEpisode(episodes[0] || null);
  }, [selectedSeasonNum, seasonData]);

  const seasonStats = React.useMemo(() => {
    const rated = episodes
      .map((episode: any) => Number(episode?.vote_average || 0))
      .filter((rating: number) => Number.isFinite(rating) && rating > 0);
    if (!rated.length) return null;
    return {
      average: (rated.reduce((sum: number, rating: number) => sum + rating, 0) / rated.length).toFixed(1),
      count: rated.length,
    };
  }, [episodes]);

  if (!validSeasons.length) return null;

  return (
    <section className="bg-zinc-900/90 border border-white/10 rounded-2xl p-3.5 space-y-3 shadow-xl w-full overflow-hidden">
      <div className="flex items-center justify-between gap-3 pb-2 border-b border-white/5">
        <div className="min-w-0">
          <h3 className="text-xs font-extrabold text-white uppercase tracking-wider">Notes par épisode</h3>
          <p className="text-[10px] text-zinc-500 mt-0.5">Source TMDB</p>
        </div>

        {validSeasons.length > 3 ? (
          <button
            type="button"
            onClick={() => setIsSeasonPickerOpen(true)}
            className="min-h-11 inline-flex items-center gap-1.5 bg-amber-500/10 hover:bg-amber-500/20 active:bg-amber-500/30 border border-amber-500/30 text-amber-400 font-bold text-xs px-3 rounded-xl cursor-pointer transition-all shrink-0"
            aria-label={`Choisir la saison, saison ${selectedSeasonNum} sélectionnée`}
          >
            <span>Saison {selectedSeasonNum}</span>
            <ChevronDown size={14} />
          </button>
        ) : (
          <div className="flex items-center gap-1 overflow-x-auto hide-scrollbar shrink-0">
            {validSeasons.map(season => {
              const selected = season.season_number === selectedSeasonNum;
              return (
                <button
                  key={season.id || season.season_number}
                  type="button"
                  onClick={() => setSelectedSeasonNum(season.season_number)}
                  className={cn(
                    'min-w-11 min-h-11 px-2 rounded-xl text-[11px] font-bold transition-all shrink-0',
                    selected
                      ? 'bg-amber-500 text-zinc-950 font-black'
                      : 'bg-zinc-800/80 text-zinc-400 border border-white/5 hover:text-white',
                  )}
                  aria-pressed={selected}
                >
                  S{season.season_number}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {seasonStats && (
        <div className="flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-800/80 border border-white/10 px-2.5 py-1.5 font-bold text-blue-300">
            <Star size={12} className="fill-blue-400 text-blue-400" />
            Saison {selectedSeasonNum} · {seasonStats.average}
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="h-32 flex items-center justify-center" aria-label="Chargement des notes">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-amber-400" />
        </div>
      ) : episodes.length === 0 ? (
        <div className="h-24 flex items-center justify-center text-zinc-500 text-xs font-medium">
          Aucun épisode disponible pour cette saison.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto hide-scrollbar -mx-1 px-1 pb-1" role="group" aria-label={`Notes TMDB de la saison ${selectedSeasonNum}`}>
            <div className="flex items-end gap-2 min-w-max h-32 pt-4">
              {episodes.map((episode: any) => {
                const rating = Number(episode?.vote_average || 0);
                const validRating = Number.isFinite(rating) && rating > 0 ? rating : 0;
                const height = validRating > 0 ? Math.max(12, (validRating / 10) * 86) : 10;
                const color = getRatingColor(validRating);
                const active = activeEpisode?.id === episode.id
                  || activeEpisode?.episode_number === episode.episode_number;
                const episodeLabel = `E${String(episode.episode_number ?? 0).padStart(2, '0')}`;

                return (
                  <button
                    key={episode.id || episode.episode_number}
                    type="button"
                    onClick={() => setActiveEpisode(episode)}
                    className="w-11 min-w-11 h-full flex flex-col items-center justify-end gap-1.5 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded-md"
                    aria-pressed={active}
                    aria-label={`${episodeLabel}, note TMDB ${validRating > 0 ? validRating.toFixed(1) : 'non noté'}`}
                  >
                    <span className={cn('text-[10px] font-bold', active ? 'text-white' : color.text)}>
                      {validRating > 0 ? validRating.toFixed(1) : '–'}
                    </span>
                    <span className="w-full h-[86px] flex items-end rounded-md bg-zinc-800/20 overflow-hidden">
                      <span
                        className={cn(
                          'block w-full rounded-t-md transition-all duration-200',
                          color.bg,
                          active ? 'ring-2 ring-inset ring-white/80 brightness-110' : 'opacity-85',
                        )}
                        style={{ height: `${height}%` }}
                      />
                    </span>
                    <span className={cn('text-[10px] font-semibold', active ? 'text-white' : 'text-zinc-500')}>
                      {episodeLabel}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {activeEpisode && (
            <button
              type="button"
              onClick={() => onSelectEpisode?.(selectedSeasonNum, activeEpisode)}
              className="w-full min-h-11 bg-zinc-800/60 border border-white/10 hover:border-amber-500/30 hover:bg-zinc-800/90 rounded-xl px-3 py-2.5 flex items-center justify-between gap-3 text-left transition-all"
            >
              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase text-amber-400">
                  Épisode {activeEpisode.episode_number}
                </span>
                <p className="text-xs font-semibold text-white truncate mt-0.5">
                  {activeEpisode.name || `Épisode ${activeEpisode.episode_number}`}
                </p>
              </div>
              <span className="text-xs font-bold text-blue-300 shrink-0">
                {Number(activeEpisode.vote_average || 0) > 0 ? Number(activeEpisode.vote_average).toFixed(1) : '–'}
              </span>
            </button>
          )}
        </div>
      )}

      {isSeasonPickerOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => setIsSeasonPickerOpen(false)}
          role="presentation"
        >
          <div
            className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-xs p-4 space-y-3 shadow-2xl"
            onClick={event => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Sélectionner une saison"
          >
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <h4 className="text-sm font-extrabold text-white">Sélectionner une saison</h4>
              <button
                type="button"
                onClick={() => setIsSeasonPickerOpen(false)}
                className="w-11 h-11 inline-flex items-center justify-center text-zinc-400 hover:text-white rounded-xl hover:bg-white/10"
                aria-label="Fermer"
              >
                <X size={18} />
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
              {validSeasons.map(season => {
                const selected = season.season_number === selectedSeasonNum;
                return (
                  <button
                    key={season.id || season.season_number}
                    type="button"
                    onClick={() => {
                      setSelectedSeasonNum(season.season_number);
                      setIsSeasonPickerOpen(false);
                    }}
                    className={cn(
                      'w-full min-h-11 flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold text-left',
                      selected ? 'bg-amber-500 text-zinc-950 font-black' : 'text-zinc-300 hover:bg-white/5',
                    )}
                  >
                    <span>Saison {season.season_number}</span>
                    {selected && <Check size={16} />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
});

function useMemoSeasons(seasons: any[]) {
  return React.useMemo(() => {
    if (!seasons?.length) return [];
    const filtered = seasons.filter((season: any) => season.season_number > 0 && season.episode_count > 0);
    return filtered.length > 0 ? filtered : seasons.filter((season: any) => season.episode_count > 0);
  }, [seasons]);
}
