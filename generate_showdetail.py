content = """import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Show } from '../core/db';
import { tmdb } from '../features/shows/tmdb';
import { ChevronLeft, Star, Heart, CheckCircle2, Circle, Tv, Zap, X, EyeOff, Archive, Trash2, MoreVertical } from 'lucide-react';
import { cn } from '../lib/utils';
import { EpisodeDetailModal } from './EpisodeDetailModal';

interface ShowDetailScreenProps {
  showId?: number;
  tmdbId?: number;
  onBack: () => void;
}

export function ShowDetailScreen({ showId, tmdbId: externalTmdbId, onBack }: ShowDetailScreenProps) {
  const show = useLiveQuery(() => {
    if (showId) return db.shows.get(showId);
    if (externalTmdbId) return db.shows.where('tmdbId').equals(externalTmdbId).first();
    return undefined;
  }, [showId, externalTmdbId]);

  const [tmdbDetails, setTmdbDetails] = useState<any>(null);
  const [providers, setProviders] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'about' | 'episodes'>('about');
  
  const [seasonsCache, setSeasonsCache] = useState<Record<number, any>>({});
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null);
  const [selectedEpisode, setSelectedEpisode] = useState<{season: number, episode: any} | null>(null);
  const [showMenu, setShowMenu] = useState(false);

  const effectiveTmdbId = show?.tmdbId || externalTmdbId;

  useEffect(() => {
    if (!effectiveTmdbId) return;
    
    let isMounted = true;
    
    tmdb.getShowDetails(effectiveTmdbId).then(res => {
      if (res.ok && isMounted) setTmdbDetails(res.value);
    });

    tmdb.getWatchProviders(effectiveTmdbId).then(res => {
      if (res.ok && isMounted) {
         setProviders(res.value.results?.FR || res.value.results?.US);
      }
    });

    return () => { isMounted = false; };
  }, [effectiveTmdbId]);

  const loadSeason = async (seasonNumber: number) => {
    if (expandedSeason === seasonNumber) {
      setExpandedSeason(null);
      return;
    }
    
    setExpandedSeason(seasonNumber);
    if (!effectiveTmdbId || seasonsCache[seasonNumber]) return;

    const res = await tmdb.getSeasonDetails(effectiveTmdbId, seasonNumber);
    if (res.ok) {
      setSeasonsCache(prev => ({ ...prev, [seasonNumber]: res.value }));
    }
  };

  const toggleEpisodeSeen = async (e: React.MouseEvent, season: number, episode: number) => {
    e.stopPropagation();
    if (!show || !show.id) return;
    
    const epKey = `${season}x${episode}`;
    const newSeen = new Set(show.seenEpisodes || []);
    const newRecords = { ...(show.episodeRecords || {}) };
    
    if (newSeen.has(epKey)) {
      newSeen.delete(epKey);
      delete newRecords[epKey];
    } else {
      newSeen.add(epKey);
      newRecords[epKey] = { watchedAt: Date.now() };
    }
    
    await db.shows.update(show.id, {
        seenEpisodes: Array.from(newSeen), 
        episodeRecords: newRecords, 
        updatedAt: Date.now()
    });
  };

  const toggleArchive = async () => {
    if (!show?.id) return;
    await db.shows.update(show.id, { 
      isArchived: !show.isArchived,
      updatedAt: Date.now()
    });
    alert(show.isArchived ? "Série désarchivée" : "Série archivée");
  };

  const deleteShow = async () => {
    if (!show?.id) return;
    await db.shows.delete(show.id);
    onBack();
  };

  const toggleMediaType = async () => {
    if (!show?.id) return;
    const newType = show.mediaType === 'tv' ? 'movie' : 'tv';
    await db.shows.update(show.id, { 
      mediaType: newType,
      updatedAt: Date.now()
    });
    alert(`Converti en ${newType === 'movie' ? 'Film' : 'Série'}`);
  };

  if (!show && !tmdbDetails) return <div className="flex-1 bg-black flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#E5A93D]" /></div>;

  const title = show?.title || tmdbDetails?.name || tmdbDetails?.title || 'Chargement...';
  const posterPath = show?.posterPath || (tmdbDetails?.poster_path ? `https://image.tmdb.org/t/p/w342${tmdbDetails.poster_path}` : undefined);
  const backdropUrl = tmdbDetails?.backdrop_path 
    ? `https://image.tmdb.org/t/p/w780${tmdbDetails.backdrop_path}` 
    : posterPath;

  return (
    <div className="flex-1 bg-black text-white overflow-y-auto relative pb-safe">
      {/* Hero Header */}
      <div className="relative h-72 w-full">
        {backdropUrl && (
          <img 
            src={backdropUrl} 
            alt="Backdrop" 
            className="w-full h-full object-cover opacity-60"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent" />
        
        {/* Menu 3-dots */}
        {show && (
          <div className="absolute top-12 right-4 z-50">
            <button 
              onClick={() => setShowMenu(!showMenu)}
              className="w-10 h-10 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10"
            >
              <MoreVertical size={20} />
            </button>
            
            {showMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 mt-2 w-56 bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden flex flex-col py-2 animate-in fade-in slide-in-from-top-2">
                  <button 
                    onClick={() => { setShowMenu(false); toggleArchive(); }}
                    className="px-4 py-3 text-left text-sm text-zinc-300 hover:bg-zinc-800 transition-colors flex items-center gap-3 font-semibold"
                  >
                    <Archive size={16} className={show.isArchived ? "text-emerald-500" : "text-zinc-400"} />
                    {show.isArchived ? "Désarchiver" : "Archiver"}
                  </button>
                  <button 
                    onClick={() => { setShowMenu(false); toggleMediaType(); }}
                    className="px-4 py-3 text-left text-sm text-zinc-300 hover:bg-zinc-800 transition-colors flex items-center gap-3 font-semibold"
                  >
                    <Tv size={16} className="text-zinc-400" />
                    {show.mediaType === 'tv' ? 'Convertir en Film' : 'Convertir en Série'}
                  </button>
                  <div className="h-px bg-white/5 my-1" />
                  <button 
                    onClick={() => { setShowMenu(false); deleteShow(); }}
                    className="px-4 py-3 text-left text-sm text-red-500 hover:bg-red-500/10 transition-colors flex items-center gap-3 font-semibold"
                  >
                    <Trash2 size={16} />
                    Ne plus suivre
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <button 
          onClick={onBack}
          className="absolute top-12 left-4 w-10 h-10 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10"
        >
          <ChevronLeft size={24} />
        </button>

        {/* Content */}
        <div className="absolute bottom-0 inset-x-0 p-6 flex items-end gap-4">
          {posterPath && (
            <img
               src={posterPath}
               alt="Poster"
               className="w-24 h-36 rounded-lg shadow-2xl border border-zinc-800 object-cover"
            />
          )}
          <div className="flex-1 pb-2">
            <h1 className="text-2xl font-bold leading-tight drop-shadow-md">{title}</h1>
            {tmdbDetails && (
              <div className="flex items-center gap-2 text-xs text-zinc-300 mt-2 font-medium">
                {tmdbDetails.networks?.[0]?.name && (
                  <span className="bg-white/10 px-2 py-0.5 rounded">{tmdbDetails.networks[0].name}</span>
                )}
                {tmdbDetails.number_of_seasons && (
                  <span>{tmdbDetails.number_of_seasons} Saisons</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/10 sticky top-0 bg-zinc-950/80 backdrop-blur-xl z-20 px-4 pt-2 pb-2">
        <div className="bg-zinc-900 p-1 rounded-full border border-white/5 flex w-full">
          <button 
            onClick={() => setActiveTab('about')}
            className={cn(
              "flex-1 py-2 text-xs font-bold tracking-widest uppercase transition-all rounded-full",
              activeTab === 'about' ? "bg-zinc-800 text-white shadow-lg" : "text-zinc-500"
            )}
          >
            À Propos
          </button>
          <button 
            onClick={() => setActiveTab('episodes')}
            className={cn(
              "flex-1 py-2 text-xs font-bold tracking-widest uppercase transition-all rounded-full",
              activeTab === 'episodes' ? "bg-zinc-800 text-white shadow-lg" : "text-zinc-500"
            )}
          >
            Épisodes
          </button>
        </div>
      </div>

      <div className="p-4">
        {activeTab === 'about' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Where to watch */}
            {providers?.flatrate && (
              <div>
                <h3 className="text-xs font-bold uppercase text-zinc-500 tracking-wider mb-3">Où regarder</h3>
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {providers.flatrate.map((provider: any) => (
                    <img 
                      key={provider.provider_id}
                      src={`https://image.tmdb.org/t/p/w92${provider.logo_path}`}
                      alt={provider.provider_name}
                      className="w-12 h-12 rounded-xl"
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Synopsis */}
            {tmdbDetails?.overview && (
              <div>
                <h3 className="text-xs font-bold uppercase text-zinc-500 tracking-wider mb-3">Synopsis</h3>
                <p className="text-zinc-300 text-sm leading-relaxed">{tmdbDetails.overview}</p>
              </div>
            )}

            {/* Info Grid */}
            {tmdbDetails && (
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-zinc-900 p-4 rounded-2xl">
                  <span className="block text-xs text-zinc-500 mb-1">Année</span>
                  <span className="font-semibold">{tmdbDetails.first_air_date?.substring(0, 4) || tmdbDetails.release_date?.substring(0, 4)}</span>
                </div>
                <div className="bg-zinc-900 p-4 rounded-2xl">
                  <span className="block text-xs text-zinc-500 mb-1">Note globale</span>
                  <div className="flex items-center gap-1">
                    <Star size={16} className="text-[#E5A93D] fill-[#E5A93D]" />
                    <span className="font-semibold">{tmdbDetails.vote_average?.toFixed(1)}</span>
                  </div>
                </div>
                <div className="bg-zinc-900 p-4 rounded-2xl col-span-2">
                  <span className="block text-xs text-zinc-500 mb-1">Genres</span>
                  <span className="font-semibold leading-tight block">
                    {tmdbDetails.genres?.map((g: any) => g.name).join(', ')}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'episodes' && (
          <div className="space-y-2 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {tmdbDetails?.seasons?.filter((s: any) => s.season_number > 0).map((season: any) => {
              const isFutureSeason = season.air_date ? new Date(season.air_date).getTime() > Date.now() : false;
              
              return (
              <div key={season.id} className={cn("bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden transition-all", isFutureSeason && "opacity-50 grayscale-[50%]")}>
                {/* Season Header */}
                <button 
                  onClick={() => loadSeason(season.season_number)}
                  className="w-full p-4 flex items-center justify-between text-left"
                >
                  <div>
                    <div className="flex items-center gap-2">
                       <h3 className="font-bold text-zinc-100">Saison {season.season_number}</h3>
                       {isFutureSeason && <span className="bg-white/10 text-white text-[10px] font-bold px-1.5 py-0.5 rounded tracking-wide uppercase">📅 À venir</span>}
                    </div>
                    <p className="text-xs text-zinc-500 mt-1">{season.episode_count} épisodes</p>
                  </div>
                </button>

                {/* Episodes List (Accordion) */}
                {expandedSeason === season.season_number && (
                  <div className="bg-black/50 border-t border-zinc-800 divide-y divide-zinc-800/50">
                    {!seasonsCache[season.season_number] ? (
                      <div className="p-6 flex justify-center"><div className="animate-spin h-5 w-5 border-2 border-[#E5A93D] border-t-transparent rounded-full" /></div>
                    ) : (
                      seasonsCache[season.season_number].episodes.map((ep: any) => {
                        const epKey = `${season.season_number}x${ep.episode_number}`;
                        const isSeen = show?.seenEpisodes?.includes(epKey);
                        const isFutureEp = ep.air_date ? new Date(ep.air_date).getTime() > Date.now() : false;
                        
                        return (
                          <div 
                            key={ep.id} 
                            onClick={() => setSelectedEpisode({season: season.season_number, episode: ep})}
                            className={cn("p-3 flex items-center gap-3 hover:bg-zinc-900/50 transition-colors cursor-pointer active:bg-zinc-800", isFutureEp && "opacity-50")}
                          >
                            <div className="relative w-24 h-16 rounded-md overflow-hidden bg-zinc-800 shrink-0 border border-white/5">
                               {ep.still_path && (
                                 <img src={`https://image.tmdb.org/t/p/w300${ep.still_path}`} className="w-full h-full object-cover" alt="" />
                               )}
                               <div className="absolute inset-0 bg-black/20" />
                            </div>
                            
                            <div className="flex-1 min-w-0">
                               <div className="flex items-center gap-2 mb-0.5">
                                 <p className="text-xs font-mono text-zinc-500">E{ep.episode_number.toString().padStart(2, '0')}</p>
                                 {isFutureEp && <span className="bg-amber-500/20 text-amber-500 text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wide uppercase border border-amber-500/20">Prochainement</span>}
                               </div>
                               <p className="text-sm font-semibold text-zinc-200 truncate">{ep.name}</p>
                            </div>

                            {!isFutureEp && (
                              <button 
                                onClick={(e) => toggleEpisodeSeen(e, season.season_number, ep.episode_number)}
                                className="p-3 shrink-0 touch-manipulation"
                              >
                                {isSeen ? (
                                  <CheckCircle2 size={24} className="text-[#E5A93D] drop-shadow-[0_0_8px_rgba(229,169,61,0.5)]" />
                                ) : (
                                  <Circle size={24} className="text-zinc-600" />
                                )}
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            )})}
          </div>
        )}
      </div>

      {/* Episode Modal */}
      {selectedEpisode && (
        <EpisodeDetailModal 
          show={show}
          season={selectedEpisode.season}
          episode={selectedEpisode.episode}
          onClose={() => setSelectedEpisode(null)}
        />
      )}
    </div>
  );
}
"""

with open("src/screens/ShowDetailScreen.tsx", "w") as f:
    f.write(content)

