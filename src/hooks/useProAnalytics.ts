import { useState, useEffect } from 'react';
import { type Show } from '../types';
import { tmdb } from '../features/shows/tmdb';
import { checkIsUpToDate } from '../lib/utils';

export interface PersonStat {
  id: number;
  name: string;
  count: number;
  movieCount: number;
  tvCount: number;
  profile_path: string | null;
  popularity: number;
  subtitle: string;
}

export interface AnalyticsData {
  totalMinutes: number;
  totalEpisodesSeen: number;
  totalMoviesSeen: number;
  completedTvCount: number;
  favoritesCount: number;
  topShowTitle: string;
  cinephileArchetype: string;
  dominantGenre: string;
  platforms: { name: string; count: number; percentage: number }[];
  genres: { name: string; count: number; percentage: number }[];
  topActors: PersonStat[];
  topDirectors: PersonStat[];
  bingeTime: { title: string; remainingMinutes: number } | null;
}

export function getArchetypeForGenre(genreName: string): string {
  const g = (genreName || '').toLowerCase();
  if (g.includes('thriller') || g.includes('drame') || g.includes('drama')) {
    return '🔥 Marathonneur de Thrillers';
  }
  if (g.includes('science-fiction') || g.includes('sci-fi') || g.includes('sf')) {
    return '🚀 Explorateur Sci-Fi';
  }
  if (g.includes('action') || g.includes('aventure') || g.includes('adventure')) {
    return '💥 Amateur d\'Adrénaline';
  }
  if (g.includes('comédie') || g.includes('comedy')) {
    return '😂 Amateur de Comédies';
  }
  if (g.includes('animation') || g.includes('anime')) {
    return '🎨 Passionné d\'Animation';
  }
  if (g.includes('crime') || g.includes('policier')) {
    return '🕵️ Enquêteur du Crime';
  }
  if (g.includes('horreur') || g.includes('horror')) {
    return '👻 Chasseur de Frissons';
  }
  if (g.includes('romance')) {
    return '💌 Romantique Incurable';
  }
  if (g.includes('fantastique') || g.includes('fantasy')) {
    return '🧙 Quintessence Fantasy';
  }
  if (g.includes('doc')) {
    return '🔍 Curieux de Réel';
  }
  return '🍿 Cinéphile Aguerri';
}

export function isShowWatched(show: Show | undefined): boolean {
  if (!show || !show.tmdbId) return false;
  if (show.mediaType === 'movie') {
    return show.status === 'completed' || (show.seenEpisodes && show.seenEpisodes.includes('movie')) || checkIsUpToDate(show);
  }
  const seenCount = (show.seenEpisodes || []).filter(e => e !== 'movie').length;
  return show.status === 'completed' || seenCount > 0 || checkIsUpToDate(show);
}

export function useProAnalytics(shows: Show[]) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;
    
    async function loadStats() {
      if (!shows || shows.length === 0) {
        if (isMounted) {
          setData({
            totalMinutes: 0,
            totalEpisodesSeen: 0,
            totalMoviesSeen: 0,
            completedTvCount: 0,
            favoritesCount: 0,
            topShowTitle: 'Aucune',
            cinephileArchetype: '🍿 Cinéphile Aguerri',
            dominantGenre: 'Aucun',
            platforms: [],
            genres: [],
            topActors: [],
            topDirectors: [],
            bingeTime: null
          });
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      
      let totalMinutes = 0;
      let totalEpisodesSeen = 0;
      let totalMoviesSeen = 0;
      let completedTvCount = 0;
      let favoritesCount = 0;

      const platformCounts: Record<string, number> = {};
      const genreCounts: Record<string, number> = {};
      const actorCounts: Record<number, { 
        name: string; 
        movieWorks: Set<number>;
        tvWorks: Set<number>;
        profile_path: string | null; 
        popularity: number;
      }> = {};
      const directorCounts: Record<number, { 
        name: string; 
        movieWorks: Set<number>;
        tvWorks: Set<number>;
        profile_path: string | null; 
        popularity: number;
      }> = {};
      
      let bingeCandidate: Show | null = null;
      let maxRemainingEps = 0;
      let topShowTitle = 'Aucune';
      let maxEpsForShow = -1;
      
      shows.forEach(show => {
        const seenEpsCount = (show.seenEpisodes || []).filter(e => e !== 'movie').length;
        if (show.isFavorite) favoritesCount++;
        
        let platformName = "Autres";
        if (show.networks && show.networks.length > 0) {
          const net = show.networks[0].name;
          if (net.includes('Netflix')) platformName = 'Netflix';
          else if (net.includes('Apple')) platformName = 'Apple TV+';
          else if (net.includes('HBO') || net.includes('Max')) platformName = 'HBO / Max';
          else if (net.includes('Disney')) platformName = 'Disney+';
          else if (net.includes('Amazon') || net.includes('Prime')) platformName = 'Prime Video';
          else if (net.includes('Canal')) platformName = 'Canal+';
          else platformName = net;
        }
        
        if (show.mediaType === 'movie') {
          const isSeenMovie = isShowWatched(show);
          if (isSeenMovie) {
            totalMoviesSeen++;
            totalMinutes += 110;
            platformCounts[platformName] = (platformCounts[platformName] || 0) + 1;
          }
        } else {
          totalEpisodesSeen += seenEpsCount;
          totalMinutes += seenEpsCount * 45;
          if (show.status === 'completed') {
            completedTvCount++;
          }
          if (seenEpsCount > 0 || isShowWatched(show)) {
            platformCounts[platformName] = (platformCounts[platformName] || 0) + 1;
          }
          if (seenEpsCount > maxEpsForShow) {
            maxEpsForShow = seenEpsCount;
            topShowTitle = show.title;
          }
          
          if (show.status === 'watching') {
            const totalEps = show.totalEpisodes || 0;
            const remaining = totalEps - seenEpsCount;
            if (remaining > maxRemainingEps) {
              maxRemainingEps = remaining;
              bingeCandidate = show;
            }
          }
        }
      });
      
      const totalPlatformItems = Object.values(platformCounts).reduce((a, b) => a + b, 0) || 1;
      const sortedPlatforms = Object.entries(platformCounts)
        .map(([name, count]) => ({
          name,
          count,
          percentage: Math.round((count / totalPlatformItems) * 100)
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 4);

      const initialData: AnalyticsData = {
        totalMinutes,
        totalEpisodesSeen,
        totalMoviesSeen,
        completedTvCount,
        favoritesCount,
        topShowTitle,
        cinephileArchetype: '🍿 Cinéphile Aguerri',
        dominantGenre: 'Général',
        platforms: sortedPlatforms,
        genres: [],
        topActors: [],
        topDirectors: [],
        bingeTime: bingeCandidate ? { title: bingeCandidate.title, remainingMinutes: maxRemainingEps * 45 } : null
      };

      if (isMounted) {
        setData(initialData);
      }
      
      const watchedItems = shows.filter(isShowWatched);
      
      if (watchedItems.length > 0) {
        try {
          // Process in batches of 15 to balance performance and avoid API rate spikes
          const batchSize = 15;
          for (let b = 0; b < watchedItems.length; b += batchSize) {
            const batch = watchedItems.slice(b, b + batchSize);
            const promises = batch.map(s => 
              s.mediaType === 'movie' ? tmdb.getMovieDetails(s.tmdbId) : tmdb.getShowDetails(s.tmdbId)
            );
            const results = await Promise.all(promises);
            
            results.forEach((res, i) => {
              if (!res.ok || !res.value) return;
              const details = res.value;
              const show = batch[i];
              
              // 1. Genres count
              if (details.genres && Array.isArray(details.genres)) {
                details.genres.forEach((g: any) => {
                  if (g.name) {
                    genreCounts[g.name] = (genreCounts[g.name] || 0) + 1;
                  }
                });
              }
              
              // 2. Cast count (Deduplicated per show/movie, taking top billed & recurring stars)
              let castList: any[] = [];
              if (show.mediaType === 'tv') {
                if (details.aggregate_credits?.cast && details.aggregate_credits.cast.length > 0) {
                  // Sort by total episodes in series or billing order
                  castList = [...details.aggregate_credits.cast].sort((a: any, b: any) => {
                    const epA = a.total_episode_count || 0;
                    const epB = b.total_episode_count || 0;
                    if (epB !== epA) return epB - epA;
                    return (a.order || 0) - (b.order || 0);
                  });
                } else if (details.credits?.cast) {
                  castList = details.credits.cast;
                }
              } else {
                castList = details.credits?.cast || [];
              }
              
              const seenActorIdsInMedia = new Set<number>();
              // Take all cast to match the full credits shown in the PersonDetailModal
              castList.forEach((cast: any) => {
                if (!cast || !cast.id || seenActorIdsInMedia.has(cast.id)) return;
                seenActorIdsInMedia.add(cast.id);
                
                if (!actorCounts[cast.id]) {
                  actorCounts[cast.id] = { 
                    name: cast.name, 
                    movieWorks: new Set<number>(),
                    tvWorks: new Set<number>(),
                    profile_path: cast.profile_path || null,
                    popularity: cast.popularity || 0
                  };
                }
                if (show.mediaType === 'movie') {
                  actorCounts[cast.id].movieWorks.add(show.tmdbId);
                } else {
                  actorCounts[cast.id].tvWorks.add(show.tmdbId);
                }
                if (cast.profile_path && !actorCounts[cast.id].profile_path) {
                  actorCounts[cast.id].profile_path = cast.profile_path;
                }
                if ((cast.popularity || 0) > actorCounts[cast.id].popularity) {
                  actorCounts[cast.id].popularity = cast.popularity;
                }
              });
              
              // 3. Créateurs (Séries TV) & Réalisateurs (Films)
              const isDirectingJob = (jobStr: string) => {
                const j = (jobStr || '').toLowerCase();
                return j.includes('director') || j.includes('réalisat') || j.includes('creator') || j.includes('créat') || j === 'showrunner';
              };

              if (show.mediaType === 'tv') {
                // SÉRIES TV : created_by + crew (pour inclure les réalisateurs d'épisodes)
                const seenCreators = new Set<number>();
                
                if (details.created_by && Array.isArray(details.created_by)) {
                  details.created_by.forEach((creator: any) => {
                    if (!creator || !creator.id || seenCreators.has(creator.id)) return;
                    seenCreators.add(creator.id);
                    
                    if (!directorCounts[creator.id]) {
                      directorCounts[creator.id] = { 
                        name: creator.name, 
                        movieWorks: new Set<number>(),
                        tvWorks: new Set<number>(),
                        profile_path: creator.profile_path || null,
                        popularity: creator.popularity || 0
                      };
                    }
                    directorCounts[creator.id].tvWorks.add(show.tmdbId);
                    if (creator.profile_path && !directorCounts[creator.id].profile_path) {
                      directorCounts[creator.id].profile_path = creator.profile_path;
                    }
                    if ((creator.popularity || 0) > directorCounts[creator.id].popularity) {
                      directorCounts[creator.id].popularity = creator.popularity;
                    }
                  });
                }

                const tvCrew = details.aggregate_credits?.crew || details.credits?.crew || [];
                if (Array.isArray(tvCrew)) {
                  tvCrew.forEach((member: any) => {
                    if (!member || !member.id) return;
                    // For aggregate_credits, jobs are in `jobs` array
                    let isDir = false;
                    if (Array.isArray(member.jobs)) {
                      isDir = member.jobs.some((j: any) => isDirectingJob(j.job));
                    } else {
                      isDir = isDirectingJob(member.job);
                    }
                    
                    if (isDir) {
                      if (seenCreators.has(member.id)) return;
                      seenCreators.add(member.id);

                      if (!directorCounts[member.id]) {
                        directorCounts[member.id] = { 
                          name: member.name, 
                          movieWorks: new Set<number>(),
                          tvWorks: new Set<number>(),
                          profile_path: member.profile_path || null,
                          popularity: member.popularity || 0
                        };
                      }
                      directorCounts[member.id].tvWorks.add(show.tmdbId);
                      if (member.profile_path && !directorCounts[member.id].profile_path) {
                        directorCounts[member.id].profile_path = member.profile_path;
                      }
                      if ((member.popularity || 0) > directorCounts[member.id].popularity) {
                        directorCounts[member.id].popularity = member.popularity;
                      }
                    }
                  });
                }

              } else {
                // POUR LES FILMS : Conserver les membres du crew ayant un job de réalisation
                const movieCrew = details.credits?.crew || [];
                if (Array.isArray(movieCrew)) {
                  const seenDirectors = new Set<number>();
                  movieCrew.forEach((member: any) => {
                    if (!member || !member.id) return;
                    const isDir = isDirectingJob(member.job);
                    if (isDir) {
                      if (seenDirectors.has(member.id)) return;
                      seenDirectors.add(member.id);

                      if (!directorCounts[member.id]) {
                        directorCounts[member.id] = { 
                          name: member.name, 
                          movieWorks: new Set<number>(),
                          tvWorks: new Set<number>(),
                          profile_path: member.profile_path || null,
                          popularity: member.popularity || 0
                        };
                      }
                      directorCounts[member.id].movieWorks.add(show.tmdbId);
                      if (member.profile_path && !directorCounts[member.id].profile_path) {
                        directorCounts[member.id].profile_path = member.profile_path;
                      }
                      if ((member.popularity || 0) > directorCounts[member.id].popularity) {
                        directorCounts[member.id].popularity = member.popularity;
                      }
                    }
                  });
                }
              }
            });
          }
        } catch (err) {
          console.error("Error fetching TMDB analytics details:", err);
        }
      }

      const totalGenreWeight = Object.values(genreCounts).reduce((a, b) => a + b, 0) || 1;
      const sortedGenres = Object.entries(genreCounts)
        .map(([name, count]) => ({
          name,
          count: Math.round(count),
          percentage: Math.round((count / totalGenreWeight) * 100)
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 4);

      const dominantGenre = sortedGenres[0]?.name || 'Général';
      const cinephileArchetype = getArchetypeForGenre(dominantGenre);

      const topActors: PersonStat[] = Object.entries(actorCounts)
        .map(([id, d]) => {
          const movieCount = d.movieWorks.size;
          const tvCount = d.tvWorks.size;
          const totalCount = movieCount + tvCount;

          let subtitle = '';
          if (tvCount > 0 && movieCount === 0) {
            subtitle = `${tvCount} ${tvCount > 1 ? 'séries vues' : 'série vue'}`;
          } else if (movieCount > 0 && tvCount === 0) {
            subtitle = `${movieCount} ${movieCount > 1 ? 'films vus' : 'film vu'}`;
          } else {
            subtitle = `${movieCount} ${movieCount > 1 ? 'films' : 'film'} · ${tvCount} ${tvCount > 1 ? 'séries' : 'série'} vus`;
          }

          return { 
            id: Number(id), 
            name: d.name, 
            count: totalCount, 
            movieCount,
            tvCount,
            subtitle,
            profile_path: d.profile_path,
            popularity: d.popularity 
          };
        })
        .filter(a => a.count > 0)
        .sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count;
          return (b.popularity || 0) - (a.popularity || 0);
        })
        .slice(0, 20);

      const topDirectors: PersonStat[] = Object.entries(directorCounts)
        .map(([id, d]) => {
          const movieCount = d.movieWorks.size;
          const tvCount = d.tvWorks.size;
          const totalCount = movieCount + tvCount;

          let subtitle = '';
          if (tvCount > 0 && movieCount === 0) {
            subtitle = `${tvCount} ${tvCount > 1 ? 'séries créées' : 'série créée'}`;
          } else if (movieCount > 0 && tvCount === 0) {
            subtitle = `${movieCount} ${movieCount > 1 ? 'films vus' : 'film vu'}`;
          } else {
            subtitle = `${tvCount} ${tvCount > 1 ? 'séries créées' : 'série créée'} · ${movieCount} ${movieCount > 1 ? 'films vus' : 'film vu'}`;
          }

          return { 
            id: Number(id), 
            name: d.name, 
            count: totalCount, 
            movieCount,
            tvCount,
            subtitle,
            profile_path: d.profile_path,
            popularity: d.popularity 
          };
        })
        .filter(d => d.count > 0)
        .sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count;
          return (b.popularity || 0) - (a.popularity || 0);
        })
        .slice(0, 20);
      
      if (isMounted) {
        setData({
          totalMinutes,
          totalEpisodesSeen,
          totalMoviesSeen,
          completedTvCount,
          favoritesCount,
          topShowTitle,
          cinephileArchetype,
          dominantGenre,
          platforms: sortedPlatforms,
          genres: sortedGenres,
          topActors,
          topDirectors,
          bingeTime: bingeCandidate ? { title: bingeCandidate.title, remainingMinutes: maxRemainingEps * 45 } : null
        });
        setLoading(false);
      }
    }
    
    loadStats();
    return () => { isMounted = false; };
  }, [shows]);
  
  return { data, loading };
}
