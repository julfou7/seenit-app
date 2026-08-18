import { db } from '../../db/dexie';

const OMDB_API_KEY = 'eadd4829';

export interface EpisodeImdbData {
  rating: number;
  imdbId: string;
}

export interface SeriesImdbData {
  rating: number;
  votes: string;
  updatedAt: number;
}

// 1 day in milliseconds
const ONE_DAY = 24 * 60 * 60 * 1000;
// 14 days in milliseconds
const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;

/**
 * Récupère les notes IMDb d'une saison.
 * Stratégie CACHE-FIRST avec Expiration Inteligente :
 * - Si les données sont en cache et encore valides, retourne directement le cache.
 * - Si le cache est expiré, tente de rafraîchir en réseau.
 * - Si le réseau échoue ou rate-limit, retourne le cache comme fallback.
 * - Durée de vie du cache : 1 jour pour les saisons en cours ou récentes, 14 jours pour les terminées.
 */
export async function getSeasonImdbRatings(
  imdbId: string | null | undefined,
  seasonNumber: number
): Promise<Record<number, EpisodeImdbData>> {
  if (!imdbId) return {};

  const cacheKey = `${imdbId}-S${seasonNumber}`;

  try {
    // 1. CHERCHER EN LOCAL DANS DEXIE
    const cachedData = await db.omdbRatingsCache.get(cacheKey);
    let normalizedCache: Record<number, EpisodeImdbData> | null = null;

    if (cachedData && cachedData.ratings) {
      normalizedCache = {};
      Object.entries(cachedData.ratings).forEach(([epNumStr, val]) => {
        const epNum = parseInt(epNumStr, 10);
        if (typeof val === 'number') {
          normalizedCache![epNum] = { rating: val, imdbId: '' };
        } else if (val && typeof val === 'object' && typeof val.rating === 'number') {
          normalizedCache![epNum] = { rating: val.rating, imdbId: val.imdbId || '' };
        }
      });

      // Calculer l'âge du cache
      const age = Date.now() - (cachedData.updatedAt || 0);
      const isOngoing = cachedData.isOngoing || Object.values(normalizedCache).some(ep => ep.rating === 0);
      const cacheLifetime = isOngoing ? ONE_DAY : FOURTEEN_DAYS;

      // Si le cache est récent, on l'utilise sans appel réseau !
      if (age < cacheLifetime) {
        return normalizedCache;
      }
    }

    // 2. SI ABSENT OU EXPIRÉ -> APPEL RÉSEAU OMDB
    const res = await fetch(
      `https://www.omdbapi.com/?apikey=${OMDB_API_KEY}&i=${imdbId}&Season=${seasonNumber}`
    );
    if (!res.ok) {
      // Fallback au cache expiré si le réseau échoue
      return normalizedCache || {};
    }

    const data = await res.json();
    if (data.Response === 'False' || !data.Episodes || !Array.isArray(data.Episodes) || data.Episodes.length === 0) {
      return normalizedCache || {};
    }

    // Déterminer si la saison est toujours en cours de diffusion (présence de notes 'N/A' ou d'épisodes futurs)
    let hasNAs = false;
    let hasFutureEpisodes = false;
    const thirtyDaysAgo = Date.now() - 30 * ONE_DAY;

    const ratingsMap: Record<number, EpisodeImdbData> = {};
    data.Episodes.forEach((ep: any) => {
      const epNum = parseInt(ep.Episode, 10);
      const rating = parseFloat(ep.imdbRating);
      const epImdbId = ep.imdbID || ep.imdbId || '';

      if (ep.imdbRating === 'N/A' || !ep.imdbRating) {
        hasNAs = true;
      }

      if (ep.Released && ep.Released !== 'N/A') {
        const releaseTime = new Date(ep.Released).getTime();
        if (!isNaN(releaseTime) && releaseTime > thirtyDaysAgo) {
          hasFutureEpisodes = true;
        }
      } else {
        hasFutureEpisodes = true;
      }

      if (!isNaN(epNum)) {
        ratingsMap[epNum] = {
          rating: !isNaN(rating) && rating > 0 ? rating : 0,
          imdbId: epImdbId
        };
      }
    });

    const isOngoing = hasNAs || hasFutureEpisodes;

    // 4. SAUVEGARDER DANS DEXIE POUR LES PROCHAINES OUVERTURES
    await db.omdbRatingsCache.put({
      id: cacheKey,
      imdbId,
      seasonNumber,
      ratings: ratingsMap,
      isOngoing,
      updatedAt: Date.now()
    });

    return ratingsMap;
  } catch (error) {
    console.warn('[OMDb] Erreur lors de la récupération des notes de la saison:', error);
    return {};
  }
}

/**
 * Récupère la note globale d'une série ou d'un film sur IMDb.
 * Stratégie CACHE-FIRST avec Expiration Inteligente :
 * - Cache de 1 jour pour les séries en cours de production/diffusion.
 * - Cache de 14 jours pour les séries terminées.
 */
export async function getSeriesImdbData(
  imdbId: string | null | undefined
): Promise<SeriesImdbData | null> {
  if (!imdbId) return null;

  try {
    // 1. Chercher d'abord dans le cache
    const cached = await db.omdbEpisodesCache.get(imdbId);
    
    if (cached) {
      const age = Date.now() - (cached.updatedAt || 0);
      const isOngoing = (cached as any).isOngoing;
      const cacheLifetime = isOngoing ? ONE_DAY : FOURTEEN_DAYS;

      if (age < cacheLifetime && cached.rating !== undefined) {
        return {
          rating: cached.rating,
          votes: cached.votes,
          updatedAt: cached.updatedAt
        };
      }
    }

    // 2. Appel réseau si absent ou expiré
    const res = await fetch(`https://www.omdbapi.com/?apikey=${OMDB_API_KEY}&i=${imdbId}`);
    if (!res.ok) {
      if (cached && cached.rating !== undefined) {
        return { rating: cached.rating, votes: cached.votes, updatedAt: cached.updatedAt };
      }
      return null;
    }

    const data = await res.json();
    if (data.Response === 'False' || !data.imdbRating || data.imdbRating === 'N/A') {
      if (cached && cached.rating !== undefined) {
        return { rating: cached.rating, votes: cached.votes, updatedAt: cached.updatedAt };
      }
      return null;
    }

    const rating = parseFloat(data.imdbRating);
    const votes = data.imdbVotes && data.imdbVotes !== 'N/A' ? data.imdbVotes : '0';
    
    // Vérifier si la série est en cours
    const yearStr = data.Year || '';
    const isOngoing = yearStr.endsWith('–') || yearStr.endsWith('-') || (yearStr.includes('–') && !yearStr.split('–')[1]?.trim());

    const result: SeriesImdbData = {
      rating,
      votes,
      updatedAt: Date.now()
    };

    // Sauvegarder dans le cache
    await db.omdbEpisodesCache.put({
      imdbId,
      votes,
      rating,
      isOngoing,
      updatedAt: Date.now()
    } as any);

    return result;
  } catch (error) {
    console.warn('[OMDb] Erreur lors de la récupération de la note globale:', error);
    return null;
  }
}

/**
 * Récupère le nombre de votes IMDb pour un épisode spécifique.
 * Stratégie CACHE-FIRST :
 * 1. Vérifie la table `omdbEpisodesCache`.
 * 2. Si absent -> Effectue 1 appel API pour cet épisode unique.
 */
export async function getEpisodeImdbVotes(episodeImdbId: string): Promise<string | null> {
  if (!episodeImdbId) return null;

  try {
    // 1. Check cache
    const cached = await db.omdbEpisodesCache.get(episodeImdbId);
    if (cached) return cached.votes;

    // 2. Fetch API
    const res = await fetch(`https://www.omdbapi.com/?apikey=${OMDB_API_KEY}&i=${episodeImdbId}`);
    if (!res.ok) return null;
    const data = await res.json();

    if (data.imdbVotes && data.imdbVotes !== 'N/A') {
      await db.omdbEpisodesCache.put({
        imdbId: episodeImdbId,
        votes: data.imdbVotes,
        updatedAt: Date.now()
      });
      return data.imdbVotes;
    }
    return null;
  } catch {
    return null;
  }
}
