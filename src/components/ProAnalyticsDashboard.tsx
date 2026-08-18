import React, { useState, useEffect } from 'react';
import { useProAnalytics } from '../hooks/useProAnalytics';
import { type Show } from '../types';
import { 
  Clock, Tv, Film, Flame, Sparkles, MonitorPlay, 
  TrendingUp, Users, Trophy, Moon, Clapperboard, Zap, Lock, ChevronRight,
  ChevronDown, ChevronUp, Loader2
} from 'lucide-react';
import { cn } from '../lib/utils';

export function ProAnalyticsDashboard({ 
  shows,
  onPersonClick
}: { 
  shows: Show[];
  onPersonClick?: (personId: number) => void;
}) {
  const { data, loading } = useProAnalytics(shows);
  const [showAllActors, setShowAllActors] = useState(false);
  const [showAllDirectors, setShowAllDirectors] = useState(false);

  useEffect(() => {
    const handleReset = () => {
      setShowAllActors(false);
      setShowAllDirectors(false);
    };
    window.addEventListener('profile-reset-all', handleReset);
    return () => window.removeEventListener('profile-reset-all', handleReset);
  }, []);

  const formatBentoTime = (totalMinutes: number) => {
    if (!totalMinutes || totalMinutes <= 0) return '0j 0h';
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    if (days > 0) {
      return `${days}j ${hours}h`;
    }
    return `${hours}h ${Math.floor(totalMinutes % 60)}m`;
  };

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center p-10 space-y-4">
        <div className="w-8 h-8 border-4 border-[#E5A93D] border-t-transparent rounded-full animate-spin" />
        <p className="text-zinc-500 font-medium text-sm">Chargement de votre ADN Cinéphile...</p>
      </div>
    );
  }

  const { 
    totalMinutes, totalEpisodesSeen, totalMoviesSeen, 
    completedTvCount, topShowTitle, cinephileArchetype, 
    platforms, genres, topActors, topDirectors 
  } = data;

  const formattedTime = formatBentoTime(totalMinutes);

  // Gamification achievements
  const achievements = [
    {
      id: 'centenaire',
      title: 'Centenaire',
      desc: 'Plus de 100 contenus ou épisodes vus',
      icon: Trophy,
      unlocked: (totalEpisodesSeen + totalMoviesSeen) >= 100 || totalEpisodesSeen >= 100,
      color: 'from-amber-500/20 to-amber-600/10 text-amber-400 border-amber-500/30'
    },
    {
      id: 'night_owl',
      title: 'Oiseau de Nuit',
      desc: 'Visionnages et marathons réguliers',
      icon: Moon,
      unlocked: totalEpisodesSeen >= 10 || totalMinutes >= 500,
      color: 'from-indigo-500/20 to-indigo-600/10 text-indigo-400 border-indigo-500/30'
    },
    {
      id: 'big_screen',
      title: 'Grand Écran',
      desc: 'Fan de cinéma et longs métrages',
      icon: Clapperboard,
      unlocked: totalMoviesSeen >= 1,
      color: 'from-rose-500/20 to-rose-600/10 text-rose-400 border-rose-500/30'
    },
    {
      id: 'binge_master',
      title: 'Binge-Master',
      desc: 'Série ou saison entière complétée',
      icon: Zap,
      unlocked: completedTvCount >= 1 || totalEpisodesSeen >= 20,
      color: 'from-emerald-500/20 to-emerald-600/10 text-emerald-400 border-emerald-500/30'
    }
  ];

  return (
    <div className="space-y-6">
      
      {/* 1. ARCHÉTYPE BADGE */}
      <div className="flex items-center justify-center my-2">
        <span className="bg-gradient-to-r from-amber-500/20 to-[#E5A93D]/10 border border-[#E5A93D]/30 text-[#E5A93D] px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-[#E5A93D]/5">
          <Sparkles size={14} className="animate-pulse" />
          {cinephileArchetype}
        </span>
      </div>

      {/* 2. BENTO GRID STATS */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {/* Box 1 : Temps */}
        <div className="bg-zinc-900/80 border border-white/10 p-4 rounded-2xl flex flex-col justify-between hover:border-amber-500/30 transition-colors">
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-[#E5A93D] mb-3">
            <Clock size={18} />
          </div>
          <div>
            <span className="text-xl font-black text-white block tracking-tight">{formattedTime}</span>
            <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">Temps de visionnage</span>
          </div>
        </div>

        {/* Box 2 : Épisodes */}
        <div className="bg-zinc-900/80 border border-white/10 p-4 rounded-2xl flex flex-col justify-between hover:border-indigo-500/30 transition-colors">
          <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-3">
            <Tv size={18} />
          </div>
          <div>
            <span className="text-xl font-black text-white block tracking-tight">
              {totalEpisodesSeen.toLocaleString('fr-FR')} {totalEpisodesSeen > 1 ? 'éps' : 'ép'}
            </span>
            <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">Épisodes vus</span>
          </div>
        </div>

        {/* Box 3 : Films */}
        <div className="bg-zinc-900/80 border border-white/10 p-4 rounded-2xl flex flex-col justify-between hover:border-rose-500/30 transition-colors">
          <div className="w-9 h-9 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 mb-3">
            <Film size={18} />
          </div>
          <div>
            <span className="text-xl font-black text-white block tracking-tight">
              {totalMoviesSeen.toLocaleString('fr-FR')} {totalMoviesSeen > 1 ? 'films' : 'film'}
            </span>
            <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">Films vus</span>
          </div>
        </div>

        {/* Box 4 : Série du moment */}
        <div className="bg-zinc-900/80 border border-white/10 p-4 rounded-2xl flex flex-col justify-between hover:border-emerald-500/30 transition-colors">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-3">
            <Flame size={18} />
          </div>
          <div>
            <span className="text-sm font-bold text-white block truncate">{topShowTitle || 'Aucune'}</span>
            <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">Série phare</span>
          </div>
        </div>
      </div>

      {/* 3. BARRES DE RÉPARTITION (Plateformes & Genres) */}
      <div className="space-y-4">
        {/* Top Plateformes */}
        <div className="bg-zinc-900/80 border border-white/10 p-4 rounded-2xl">
          <h3 className="text-xs font-bold uppercase text-zinc-400 tracking-wider mb-3.5 flex items-center gap-2">
            <MonitorPlay size={15} className="text-[#E5A93D]" />
            Top Plateformes
          </h3>
          {platforms.length > 0 ? (
            <div className="space-y-3">
              {platforms.map(platform => (
                <div key={platform.name} className="space-y-1">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-white">{platform.name}</span>
                    <span className="text-zinc-400">{platform.count} {platform.count > 1 ? 'œuvres' : 'œuvre'} ({platform.percentage}%)</span>
                  </div>
                  <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-[#E5A93D] rounded-full transition-all duration-500" 
                      style={{ width: `${Math.max(5, platform.percentage)}%` }} 
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-zinc-500 font-medium py-2">Ajoutez des séries pour afficher vos plateformes favorites.</p>
          )}
        </div>

        {/* Top Genres */}
        <div className="bg-zinc-900/80 border border-white/10 p-4 rounded-2xl">
          <h3 className="text-xs font-bold uppercase text-zinc-400 tracking-wider mb-3.5 flex items-center gap-2">
            <TrendingUp size={15} className="text-indigo-400" />
            Genres Favoris
          </h3>
          {genres.length > 0 ? (
            <div className="space-y-3">
              {genres.map((genre, idx) => {
                const colors = ['bg-[#E5A93D]', 'bg-indigo-500', 'bg-rose-500', 'bg-emerald-500'];
                return (
                  <div key={genre.name} className="space-y-1">
                    <div className="flex justify-between text-xs font-semibold">
                      <span className="text-white">{genre.name}</span>
                      <span className="text-zinc-400">{genre.count} {genre.count > 1 ? 'œuvres' : 'œuvre'} ({genre.percentage}%)</span>
                    </div>
                    <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
                      <div 
                        className={cn("h-full rounded-full transition-all duration-500", colors[idx % colors.length])} 
                        style={{ width: `${Math.max(5, genre.percentage)}%` }} 
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-zinc-500 font-medium py-2">Chargez les détails pour calculer vos genres prédominants.</p>
          )}
        </div>
      </div>

      {/* 4. SECTION TROPHÉES & BADGES (Accomplissements) */}
      <div className="bg-zinc-900/80 border border-white/10 p-4 rounded-2xl space-y-3">
        <h3 className="text-xs font-bold uppercase text-zinc-400 tracking-wider flex items-center gap-2">
          <Trophy size={15} className="text-[#E5A93D]" />
          Accomplissements
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
          {achievements.map((badge) => {
            const Icon = badge.icon;
            if (badge.unlocked) {
              return (
                <div 
                  key={badge.id}
                  className="bg-gradient-to-r from-zinc-900 to-zinc-900/90 border border-white/10 p-3 rounded-xl flex items-center gap-3 shadow-sm hover:border-amber-500/30 transition-colors"
                >
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-[#E5A93D] shrink-0">
                    <Icon size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-white block truncate">{badge.title}</span>
                      <span className="text-[9px] font-bold bg-amber-500/20 text-[#E5A93D] px-1.5 py-0.5 rounded-full uppercase">Débloqué</span>
                    </div>
                    <span className="text-[10px] text-zinc-400 font-medium block truncate">{badge.desc}</span>
                  </div>
                </div>
              );
            } else {
              return (
                <div 
                  key={badge.id}
                  className="bg-zinc-900/40 border border-white/5 p-3 rounded-xl flex items-center gap-3 opacity-40 grayscale"
                >
                  <div className="w-10 h-10 rounded-xl bg-zinc-800 border border-white/10 flex items-center justify-center text-zinc-500 shrink-0">
                    <Icon size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-zinc-400 block truncate">{badge.title}</span>
                      <Lock size={12} className="text-zinc-600 shrink-0 ml-1" />
                    </div>
                    <span className="text-[10px] text-zinc-500 font-medium block truncate">{badge.desc}</span>
                  </div>
                </div>
              );
            }
          })}
        </div>
      </div>

      {/* 5. TOP ACTEURS & RÉALISATEURS ("Vos Stars") */}
      {loading && topActors.length === 0 && topDirectors.length === 0 ? (
        <div className="bg-zinc-900/80 border border-white/10 p-4 rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
              <Users size={15} className="text-[#E5A93D]" /> Vos Stars
            </h3>
            <span className="text-[10px] text-zinc-500 font-medium flex items-center gap-1.5 animate-pulse">
              <Loader2 size={11} className="animate-spin text-[#E5A93D]" />
              Calcul en cours...
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Skeleton Acteurs */}
            <div>
              <div className="h-3 w-20 bg-zinc-800/80 rounded animate-pulse mb-2.5" />
              <div className="space-y-1.5">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="flex items-center gap-3 p-2 rounded-xl bg-white/[0.02] border border-white/5 animate-pulse">
                    <div className="w-10 h-10 rounded-full bg-zinc-800/80 shrink-0" />
                    <div className="flex-1 space-y-1.5 py-1">
                      <div className="h-3 bg-zinc-700/60 rounded w-2/3" />
                      <div className="h-2 bg-zinc-800 rounded w-1/3" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Skeleton Créateurs & Réalisateurs */}
            <div>
              <div className="h-3 w-36 bg-zinc-800/80 rounded animate-pulse mb-2.5" />
              <div className="space-y-1.5">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="flex items-center gap-3 p-2 rounded-xl bg-white/[0.02] border border-white/5 animate-pulse">
                    <div className="w-10 h-10 rounded-full bg-zinc-800/80 shrink-0" />
                    <div className="flex-1 space-y-1.5 py-1">
                      <div className="h-3 bg-zinc-700/60 rounded w-2/3" />
                      <div className="h-2 bg-zinc-800 rounded w-1/3" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (topActors.length > 0 || topDirectors.length > 0) && (
        <div className="bg-zinc-900/80 border border-white/10 p-4 rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
              <Users size={15} className="text-[#E5A93D]" /> Vos Stars
            </h3>
            {loading && (
              <span className="text-[10px] text-zinc-500 font-medium flex items-center gap-1.5">
                <Loader2 size={11} className="animate-spin text-[#E5A93D]" />
                Mise à jour...
              </span>
            )}
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Acteurs */}
            {topActors.length > 0 && (
              <div>
                <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2.5">Acteurs</h4>
                <div className="space-y-1.5">
                  {(showAllActors ? topActors : topActors.slice(0, 5)).map((actor) => (
                    <button 
                      key={actor.id} 
                      onClick={() => onPersonClick?.(actor.id)}
                      className="w-full flex items-center justify-between p-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.07] border border-white/5 hover:border-[#E5A93D]/30 active:scale-[0.98] transition-all text-left group cursor-pointer"
                      title={`Voir la filmographie de ${actor.name}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-full bg-zinc-800 overflow-hidden shrink-0 border border-white/10 group-hover:border-[#E5A93D]/60 transition-colors">
                          {actor.profile_path ? (
                            <img src={`https://image.tmdb.org/t/p/w185${actor.profile_path}`} alt={actor.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center font-bold text-xs text-zinc-500">{actor.name.charAt(0)}</div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <span className="text-xs font-semibold text-zinc-200 group-hover:text-[#E5A93D] transition-colors block truncate">{actor.name}</span>
                          <span className="text-[10px] text-zinc-400 font-medium block truncate">
                            {actor.subtitle || `${actor.count} ${actor.count > 1 ? 'œuvres vues' : 'œuvre vue'}`}
                          </span>
                        </div>
                      </div>
                      <ChevronRight size={14} className="text-zinc-600 group-hover:text-[#E5A93D] group-hover:translate-x-0.5 transition-all shrink-0 ml-2" />
                    </button>
                  ))}
                </div>

                {topActors.length > 5 && (
                  <button
                    onClick={() => setShowAllActors(!showAllActors)}
                    className="w-full mt-2.5 py-1.5 px-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/5 hover:border-[#E5A93D]/30 text-[11px] font-semibold text-zinc-300 hover:text-white flex items-center justify-center gap-1.5 transition-all touch-manipulation cursor-pointer active:scale-[0.99]"
                  >
                    {showAllActors ? (
                      <>
                        <span>Voir moins</span>
                        <ChevronUp size={13} className="text-[#E5A93D]" />
                      </>
                    ) : (
                      <>
                        <span>Voir plus ({topActors.length} acteurs)</span>
                        <ChevronDown size={13} className="text-[#E5A93D]" />
                      </>
                    )}
                  </button>
                )}
              </div>
            )}

            {/* Créateurs & Réalisateurs */}
            {topDirectors.length > 0 && (
              <div>
                <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2.5">Créateurs & Réalisateurs</h4>
                <div className="space-y-1.5">
                  {(showAllDirectors ? topDirectors : topDirectors.slice(0, 5)).map((dir) => (
                    <button 
                      key={dir.id} 
                      onClick={() => onPersonClick?.(dir.id)}
                      className="w-full flex items-center justify-between p-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.07] border border-white/5 hover:border-[#E5A93D]/30 active:scale-[0.98] transition-all text-left group cursor-pointer"
                      title={`Voir la filmographie de ${dir.name}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-full bg-zinc-800 overflow-hidden shrink-0 border border-white/10 group-hover:border-[#E5A93D]/60 transition-colors">
                          {dir.profile_path ? (
                            <img src={`https://image.tmdb.org/t/p/w185${dir.profile_path}`} alt={dir.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center font-bold text-xs text-zinc-500">{dir.name.charAt(0)}</div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <span className="text-xs font-semibold text-zinc-200 group-hover:text-[#E5A93D] transition-colors block truncate">{dir.name}</span>
                          <span className="text-[10px] text-zinc-400 font-medium block truncate">
                            {dir.subtitle || `${dir.count} ${dir.count > 1 ? 'œuvres vues' : 'œuvre vue'}`}
                          </span>
                        </div>
                      </div>
                      <ChevronRight size={14} className="text-zinc-600 group-hover:text-[#E5A93D] group-hover:translate-x-0.5 transition-all shrink-0 ml-2" />
                    </button>
                  ))}
                </div>

                {topDirectors.length > 5 && (
                  <button
                    onClick={() => setShowAllDirectors(!showAllDirectors)}
                    className="w-full mt-2.5 py-1.5 px-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/5 hover:border-[#E5A93D]/30 text-[11px] font-semibold text-zinc-300 hover:text-white flex items-center justify-center gap-1.5 transition-all touch-manipulation cursor-pointer active:scale-[0.99]"
                  >
                    {showAllDirectors ? (
                      <>
                        <span>Voir moins</span>
                        <ChevronUp size={13} className="text-[#E5A93D]" />
                      </>
                    ) : (
                      <>
                        <span>Voir plus ({topDirectors.length} créateurs)</span>
                        <ChevronDown size={13} className="text-[#E5A93D]" />
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
