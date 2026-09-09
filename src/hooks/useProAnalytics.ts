import { useState, useEffect } from 'react';
import { type Show } from '../types';
import { tmdb } from '../features/shows/tmdb';
import { checkIsUpToDate } from '../lib/utils';
import { auth } from '../lib/firebase';

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

type PersonAccumulator = {
  name: string;
  movieWorks: Set<number>;
  tvWorks: Set<number>;
  profile_path: string | null;
  popularity: number;
};

type AnalyticsPersonContribution = {
  id: number;
  name: string;
  profile_path: string | null;
  popularity: number;
};

type AnalyticsMediaContribution = {
  genres: string[];
  actors: AnalyticsPersonContribution[];
  directors: AnalyticsPersonContribution[];
};

// Cache de session volontairement compact : contrairement au cache TMDB complet,
// il ne conserve que les quelques champs nécessaires aux statistiques. Il permet
// de reprendre un calcul interrompu (navigation/Réglages) sans retélécharger les
// crédits déjà analysés. Les données contenues ici sont uniquement des métadonnées
// TMDB publiques ; aucune progression utilisateur n'y est stockée.
const analyticsContributionCache = new Map<string, AnalyticsMediaContribution>();
const MAX_ANALYTICS_CONTRIBUTIONS = 512;

// Le résultat final contient des données propres au compte : il est donc cloisonné
// par UID dans sa clé et reste uniquement en mémoire pendant la session WebView/PWA.
const analyticsResultCache = new Map<string, AnalyticsData>();
const MAX_ANALYTICS_RESULTS = 8;

const getMediaContributionKey = (show: Show): string =>
  `${show.mediaType === 'movie' ? 'movie' : 'tv'}:${Number(show.tmdbId)}`;

const readContributionCache = (key: string): AnalyticsMediaContribution | null => {
  const cached = analyticsContributionCache.get(key);
  if (!cached) return null;
  analyticsContributionCache.delete(key);
  analyticsContributionCache.set(key, cached);
  return cached;
};

const writeContributionCache = (key: string, contribution: AnalyticsMediaContribution) => {
  if (analyticsContributionCache.has(key)) analyticsContributionCache.delete(key);
  analyticsContributionCache.set(key, contribution);
  while (analyticsContributionCache.size > MAX_ANALYTICS_CONTRIBUTIONS) {
    const oldest = analyticsContributionCache.keys().next().value;
    if (!oldest) break;
    analyticsContributionCache.delete(oldest);
  }
};

const readResultCache = (key: string): AnalyticsData | null => {
  const cached = analyticsResultCache.get(key);
  if (!cached) return null;
  analyticsResultCache.delete(key);
  analyticsResultCache.set(key, cached);
  return cached;
};

const writeResultCache = (key: string, data: AnalyticsData) => {
  if (analyticsResultCache.has(key)) analyticsResultCache.delete(key);
  analyticsResultCache.set(key, data);
  while (analyticsResultCache.size > MAX_ANALYTICS_RESULTS) {
    const oldest = analyticsResultCache.keys().next().value;
    if (!oldest) break;
    analyticsResultCache.delete(oldest);
  }
};

const isDirectingJob = (jobStr: string) => {
  const job = (jobStr || '').toLowerCase();
  return job.includes('director')
    || job.includes('réalisat')
    || job.includes('creator')
    || job.includes('créat')
    || job === 'showrunner';
};

const toPersonContribution = (person: any): AnalyticsPersonContribution => ({
  id: Number(person.id),
  name: person.name || '',
  profile_path: person.profile_path || null,
  popularity: person.popularity || 0,
});

const extractAnalyticsContribution = (show: Show, details: any): AnalyticsMediaContribution => {
  const genres: string[] = Array.from(new Set<string>(
    (Array.isArray(details?.genres) ? details.genres : [])
      .map((genre: any) => String(genre?.name || '').trim())
      .filter((name: string) => name.length > 0),
  ));

  let castList: any[] = [];
  if (show.mediaType === 'tv') {
    if (Array.isArray(details?.aggregate_credits?.cast) && details.aggregate_credits.cast.length > 0) {
      castList = [...details.aggregate_credits.cast].sort((left: any, right: any) => {
        const episodeDiff = (right.total_episode_count || 0) - (left.total_episode_count || 0);
        if (episodeDiff !== 0) return episodeDiff;
        return (left.order || 0) - (right.order || 0);
      });
    } else if (Array.isArray(details?.credits?.cast)) {
      castList = details.credits.cast;
    }
  } else if (Array.isArray(details?.credits?.cast)) {
    castList = details.credits.cast;
  }

  const actorsById = new Map<number, AnalyticsPersonContribution>();
  // On conserve le même périmètre que l'implémentation historique : tout le casting
  // dédupliqué par média, afin que le classement reste cohérent avec la filmographie.
  for (const cast of castList) {
    const id = Number(cast?.id);
    if (!id || actorsById.has(id)) continue;
    actorsById.set(id, toPersonContribution(cast));
  }

  const directorsById = new Map<number, AnalyticsPersonContribution>();
  const addDirector = (person: any) => {
    const id = Number(person?.id);
    if (!id || directorsById.has(id)) return;
    directorsById.set(id, toPersonContribution(person));
  };

  if (show.mediaType === 'tv') {
    if (Array.isArray(details?.created_by)) {
      details.created_by.forEach(addDirector);
    }

    const crew = details?.aggregate_credits?.crew || details?.credits?.crew || [];
    if (Array.isArray(crew)) {
      for (const member of crew) {
        const directing = Array.isArray(member?.jobs)
          ? member.jobs.some((job: any) => isDirectingJob(job?.job))
          : isDirectingJob(member?.job);
        if (directing) addDirector(member);
      }
    }
  } else {
    const crew = details?.credits?.crew || [];
    if (Array.isArray(crew)) {
      for (const member of crew) {
        if (isDirectingJob(member?.job)) addDirector(member);
      }
    }
  }

  return {
    genres,
    actors: Array.from(actorsById.values()),
    directors: Array.from(directorsById.values()),
  };
};

const ensureAccumulator = (
  target: Record<number, PersonAccumulator>,
  person: AnalyticsPersonContribution,
): PersonAccumulator => {
  if (!target[person.id]) {
    target[person.id] = {
      name: person.name,
      movieWorks: new Set<number>(),
      tvWorks: new Set<number>(),
      profile_path: person.profile_path,
      popularity: person.popularity,
    };
  }

  const accumulator = target[person.id];
  if (person.profile_path && !accumulator.profile_path) accumulator.profile_path = person.profile_path;
  if (person.popularity > accumulator.popularity) accumulator.popularity = person.popularity;
  return accumulator;
};

const applyContribution = (
  show: Show,
  contribution: AnalyticsMediaContribution,
  genreCounts: Record<string, number>,
  actorCounts: Record<number, PersonAccumulator>,
  directorCounts: Record<number, PersonAccumulator>,
) => {
  contribution.genres.forEach((genre) => {
    genreCounts[genre] = (genreCounts[genre] || 0) + 1;
  });

  const tmdbId = Number(show.tmdbId);
  contribution.actors.forEach((actor) => {
    const accumulator = ensureAccumulator(actorCounts, actor);
    if (show.mediaType === 'movie') accumulator.movieWorks.add(tmdbId);
    else accumulator.tvWorks.add(tmdbId);
  });

  contribution.directors.forEach((director) => {
    const accumulator = ensureAccumulator(directorCounts, director);
    if (show.mediaType === 'movie') accumulator.movieWorks.add(tmdbId);
    else accumulator.tvWorks.add(tmdbId);
  });
};

const buildPersonStats = (
  counts: Record<number, PersonAccumulator>,
  role: 'actor' | 'director',
): PersonStat[] => Object.entries(counts)
  .map(([id, person]) => {
    const movieCount = person.movieWorks.size;
    const tvCount = person.tvWorks.size;
    const totalCount = movieCount + tvCount;

    let subtitle = '';
    if (role === 'director') {
      if (tvCount > 0 && movieCount === 0) {
        subtitle = `${tvCount} ${tvCount > 1 ? 'séries créées' : 'série créée'}`;
      } else if (movieCount > 0 && tvCount === 0) {
        subtitle = `${movieCount} ${movieCount > 1 ? 'films vus' : 'film vu'}`;
      } else {
        subtitle = `${tvCount} ${tvCount > 1 ? 'séries créées' : 'série créée'} · ${movieCount} ${movieCount > 1 ? 'films vus' : 'film vu'}`;
      }
    } else if (tvCount > 0 && movieCount === 0) {
      subtitle = `${tvCount} ${tvCount > 1 ? 'séries vues' : 'série vue'}`;
    } else if (movieCount > 0 && tvCount === 0) {
      subtitle = `${movieCount} ${movieCount > 1 ? 'films vus' : 'film vu'}`;
    } else {
      subtitle = `${movieCount} ${movieCount > 1 ? 'films' : 'film'} · ${tvCount} ${tvCount > 1 ? 'séries' : 'série'} vus`;
    }

    return {
      id: Number(id),
      name: person.name,
      count: totalCount,
      movieCount,
      tvCount,
      subtitle,
      profile_path: person.profile_path,
      popularity: person.popularity,
    };
  })
  .filter((person) => person.count > 0)
  .sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count;
    return (right.popularity || 0) - (left.popularity || 0);
  })
  .slice(0, 20);

const buildAdvancedData = (
  baseData: AnalyticsData,
  genreCounts: Record<string, number>,
  actorCounts: Record<number, PersonAccumulator>,
  directorCounts: Record<number, PersonAccumulator>,
): AnalyticsData => {
  const totalGenreWeight = Object.values(genreCounts).reduce((sum, count) => sum + count, 0) || 1;
  const genres = Object.entries(genreCounts)
    .map(([name, count]) => ({
      name,
      count: Math.round(count),
      percentage: Math.round((count / totalGenreWeight) * 100),
    }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 4);

  const dominantGenre = genres[0]?.name || 'Général';
  return {
    ...baseData,
    dominantGenre,
    cinephileArchetype: getArchetypeForGenre(dominantGenre),
    genres,
    topActors: buildPersonStats(actorCounts, 'actor'),
    topDirectors: buildPersonStats(directorCounts, 'director'),
  };
};

const buildAnalyticsSignature = (shows: Show[]): string => shows
  .map((show) => {
    const value = show as any;
    const next = value.nextEpisodeToWatch || {};
    return [
      String(show.id || ''),
      String(Number(show.tmdbId) || 0),
      show.mediaType || 'tv',
      value.status || '',
      value.isFavorite ? '1' : '0',
      value.isArchived ? '1' : '0',
      (value.seenEpisodes || []).join(','),
      String(value.totalEpisodes || 0),
      String(value.totalAiredEpisodes || 0),
      String(next.season_number || ''),
      String(next.episode_number || ''),
      String(next.air_date || ''),
      value.seriesEnded ? '1' : '0',
      value.tmdbStatus || '',
      value.networks?.[0]?.name || '',
      value.title || '',
    ].join('~');
  })
  .sort()
  .join('|');

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
  const analyticsSignature = buildAnalyticsSignature(shows || []);
  const analyticsCacheKey = `${auth.currentUser?.uid || 'anonymous'}:${analyticsSignature}`;

  useEffect(() => {
    let isMounted = true;

    async function loadStats() {
      const cachedResult = readResultCache(analyticsCacheKey);
      if (cachedResult) {
        setData(cachedResult);
        setLoading(false);
        return;
      }

      if (!shows || shows.length === 0) {
        const emptyData: AnalyticsData = {
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
          bingeTime: null,
        };
        if (isMounted) {
          setData(emptyData);
          setLoading(false);
          writeResultCache(analyticsCacheKey, emptyData);
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
      const actorCounts: Record<number, PersonAccumulator> = {};
      const directorCounts: Record<number, PersonAccumulator> = {};

      let bingeCandidate: Show | null = null;
      let maxRemainingEps = 0;
      let topShowTitle = 'Aucune';
      let maxEpsForShow = -1;

      shows.forEach(show => {
        const seenEpsCount = (show.seenEpisodes || []).filter(e => e !== 'movie').length;
        if (show.isFavorite) favoritesCount++;

        let platformName = 'Autres';
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
          if (isShowWatched(show)) {
            totalMoviesSeen++;
            totalMinutes += 110;
            platformCounts[platformName] = (platformCounts[platformName] || 0) + 1;
          }
        } else {
          totalEpisodesSeen += seenEpsCount;
          totalMinutes += seenEpsCount * 45;
          if (show.status === 'completed') completedTvCount++;
          if (seenEpsCount > 0 || isShowWatched(show)) {
            platformCounts[platformName] = (platformCounts[platformName] || 0) + 1;
          }
          if (seenEpsCount > maxEpsForShow) {
            maxEpsForShow = seenEpsCount;
            topShowTitle = show.title;
          }

          if (show.status === 'watching') {
            const remaining = (show.totalEpisodes || 0) - seenEpsCount;
            if (remaining > maxRemainingEps) {
              maxRemainingEps = remaining;
              bingeCandidate = show;
            }
          }
        }
      });

      const totalPlatformItems = Object.values(platformCounts).reduce((sum, count) => sum + count, 0) || 1;
      const sortedPlatforms = Object.entries(platformCounts)
        .map(([name, count]) => ({
          name,
          count,
          percentage: Math.round((count / totalPlatformItems) * 100),
        }))
        .sort((left, right) => right.count - left.count)
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
        bingeTime: bingeCandidate ? { title: bingeCandidate.title, remainingMinutes: maxRemainingEps * 45 } : null,
      };

      if (isMounted) setData(initialData);

      const watchedItems = shows.filter(isShowWatched);
      if (watchedItems.length > 0) {
        // 12 requêtes au maximum par lot : assez pour terminer une grosse bibliothèque
        // rapidement, puis on rend explicitement la main au navigateur entre les lots.
        // Les contributions déjà vues sont relues du cache compact sans requête réseau.
        const batchSize = 12;
        for (let offset = 0; offset < watchedItems.length; offset += batchSize) {
          if (!isMounted) return;
          const batch = watchedItems.slice(offset, offset + batchSize);

          const contributions = await Promise.all(batch.map(async (show) => {
            const cacheKey = getMediaContributionKey(show);
            const cached = readContributionCache(cacheKey);
            if (cached) return cached;

            try {
              const result = show.mediaType === 'movie'
                ? await tmdb.getMovieDetails(show.tmdbId)
                : await tmdb.getShowDetails(show.tmdbId);
              if (!result.ok || !result.value) return null;
              const contribution = extractAnalyticsContribution(show, result.value);
              writeContributionCache(cacheKey, contribution);
              return contribution;
            } catch (error) {
              console.warn('[Analytics] Impossible de charger une contribution TMDB', error);
              return null;
            }
          }));

          if (!isMounted) return;
          contributions.forEach((contribution, index) => {
            if (!contribution) return;
            applyContribution(batch[index], contribution, genreCounts, actorCounts, directorCounts);
          });

          const batchIndex = Math.floor(offset / batchSize);
          const isLastBatch = offset + batch.length >= watchedItems.length;
          // Dès le premier lot, « Vos Stars » affiche de vraies données au lieu de
          // rester en skeleton jusqu'à la toute dernière fiche. Ensuite on actualise
          // tous les quatre lots pour limiter le coût des tris pendant le scroll.
          if (isMounted && (batchIndex === 0 || (batchIndex + 1) % 4 === 0 || isLastBatch)) {
            setData(buildAdvancedData(initialData, genreCounts, actorCounts, directorCounts));
          }

          await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
      }

      if (!isMounted) return;
      const finalData = buildAdvancedData(initialData, genreCounts, actorCounts, directorCounts);
      setData(finalData);
      setLoading(false);
      writeResultCache(analyticsCacheKey, finalData);
    }

    void loadStats();
    return () => { isMounted = false; };
  }, [analyticsCacheKey]);

  return { data, loading };
}
