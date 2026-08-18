import { useShowsStore } from '../store/showsStore';
import { useFavoritePeopleStore } from '../store/favoritePeopleStore';
import { tmdb } from '../features/shows/tmdb';
import { type Show } from '../types';

export async function getRecommendations(limit: number = 20) {
  const shows = useShowsStore.getState().shows;
  const tmdbIds = new Set(shows.map(s => s.tmdbId));
  
  // Extract preferred genres
  const genreWeights: Record<number, number> = {};
  shows.forEach(s => {
    const sGenres: number[] = s ? ((s as any).genres || (s as any).genre_ids || []) : [];
    let weight = 0;
    if (s.status === 'completed') weight += 5;
    else if (s.status === 'watching' || (s.seenEpisodes && s.seenEpisodes.length > 0)) weight += 3;
    else if (s.status === 'plan_to_watch') weight += 1;
    else if (s.status === 'dropped') weight -= 5;

    if (s.isFavorite) weight += 3;
    if (s.userRating && s.userRating >= 8) weight += 2;

    sGenres.forEach(gId => {
      genreWeights[gId] = (genreWeights[gId] || 0) + weight;
    });
  });

  const topGenreIds = Object.entries(genreWeights)
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(entry => Number(entry[0]));

  const favPeople = useFavoritePeopleStore.getState().people;
  const peopleIds = favPeople.map(p => p.id).join('|');

  let rawResults: any[] = [];
  const apiKey = import.meta.env.VITE_TMDB_API_KEY || '677711df46484bc7129492d4a9267a65';
  const minReleaseDate = '2016-01-01';

  const promises: Promise<{ type: 'tv' | 'movie', res: any }>[] = [];

  if (topGenreIds.length > 0) {
    const genreStr = topGenreIds.join('|');
    promises.push(
      fetch(`${tmdb['baseUrl']}/discover/tv?api_key=${apiKey}&language=fr-FR&sort_by=popularity.desc&vote_count.gte=50&vote_average.gte=6.5&first_air_date.gte=${minReleaseDate}&with_genres=${genreStr}`).then(r => r.json()).then(res => ({ type: 'tv' as const, res })).catch(() => ({ type: 'tv' as const, res: {} })),
      fetch(`${tmdb['baseUrl']}/discover/movie?api_key=${apiKey}&language=fr-FR&sort_by=popularity.desc&vote_count.gte=50&vote_average.gte=6.5&primary_release_date.gte=${minReleaseDate}&with_genres=${genreStr}`).then(r => r.json()).then(res => ({ type: 'movie' as const, res })).catch(() => ({ type: 'movie' as const, res: {} }))
    );
  }

  if (peopleIds.length > 0) {
    promises.push(
      fetch(`${tmdb['baseUrl']}/discover/tv?api_key=${apiKey}&language=fr-FR&sort_by=popularity.desc&with_people=${peopleIds}`).then(r => r.json()).then(res => ({ type: 'tv' as const, res })).catch(() => ({ type: 'tv' as const, res: {} })),
      fetch(`${tmdb['baseUrl']}/discover/movie?api_key=${apiKey}&language=fr-FR&sort_by=popularity.desc&with_people=${peopleIds}`).then(r => r.json()).then(res => ({ type: 'movie' as const, res })).catch(() => ({ type: 'movie' as const, res: {} }))
    );
  }

  if (promises.length > 0) {
    const results = await Promise.all(promises);
    results.forEach(({ type, res }) => {
      if (res.results) {
        rawResults.push(...(res.results || []).map((r: any) => ({ ...r, media_type: type })));
      }
    });
  }

  if (rawResults.length < 15) {
    const [tvPop, moviePop] = await Promise.all([
      fetch(`${tmdb['baseUrl']}/discover/tv?api_key=${apiKey}&language=fr-FR&sort_by=popularity.desc&vote_count.gte=50&vote_average.gte=7.0&first_air_date.gte=${minReleaseDate}`).then(r => r.json()).catch(() => ({})),
      fetch(`${tmdb['baseUrl']}/discover/movie?api_key=${apiKey}&language=fr-FR&sort_by=popularity.desc&vote_count.gte=50&vote_average.gte=7.0&primary_release_date.gte=${minReleaseDate}`).then(r => r.json()).catch(() => ({}))
    ]);
    if (tvPop.results) rawResults.push(...(tvPop.results || []).map((r: any) => ({ ...r, media_type: 'tv' })));
    if (moviePop.results) rawResults.push(...(moviePop.results || []).map((r: any) => ({ ...r, media_type: 'movie' })));
  }

  const map = new Map<number, any>();
  rawResults.forEach(item => {
    if (!item.id || tmdbIds.has(item.id)) return;
    const voteCount = item.vote_count || 0;
    if (voteCount < 50) return;

    if (!map.has(item.id)) {
      map.set(item.id, item);
    }
  });

  const processedList = Array.from(map.values());
  processedList.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

  return processedList.slice(0, limit);
}
