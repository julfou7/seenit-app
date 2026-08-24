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

// 4 hours for ongoing or partially rated seasons / pending titles
const FOUR_HOURS = 4 * 60 * 60 * 1000;
// 1 day in milliseconds for recently ended or settled titles
const ONE_DAY = 24 * 60 * 60 * 1000;
// 14 days in milliseconds for fully completed past seasons
const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;

/**
 * Récupère les notes IMDb d'une saison.
 * Stratégie CACHE-FIRST avec Expiration Intelligente & Récupération Dynamique :
 * - Si les données sont en cache et encore valides, retourne le cache.
 * - Si une saison est en cours ou a des épisodes avec note 0 / N/A (non encore parues sur IMDb),
 *   la durée de cache est raccourcie à 4h pour basculer automatiquement vers les vraies notes IMDb dès publication.
 * - Si forceRefresh est activé, interroge immédiatement l'API OMDb pour récupérer les dernières notes.
 */
export async function getSeasonImdbRatings(
  imdbId: string | null | undefined,
  seasonNumber: number,
  forceRefresh: boolean = false
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
      const hasMissingRatings = Object.values(normalizedCache).some(ep => !ep || ep.rating === 0);
      const isOngoing = cachedData.isOngoing || hasMissingRatings;
      
      // Si la saison a des épisodes sans note (ou en cours), cache très court (4h) pour capter les nouvelles notes IMDb
      const cacheLifetime = hasMissingRatings ? FOUR_HOURS : isOngoing ? ONE_DAY : FOURTEEN_DAYS;

      // Si le cache est récent et sans demande de forceRefresh, on l'utilise sans appel réseau
      if (!forceRefresh && age < cacheLifetime) {
        return normalizedCache;
      }
    }

    // 2. SI ABSENT, EXPIRÉ OU FORCE_REFRESH -> APPEL RÉSEAU OMDB
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

      if (ep.imdbRating === 'N/A' || !ep.imdbRating || isNaN(rating) || rating <= 0) {
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
 * Stratégie CACHE-FIRST avec Expiration Intelligente :
 * - Cache de 4h si note manquante/0 (pour mise à niveau rapide dès que IMDb la publie)
 * - Cache de 1 jour pour les séries en cours de production/diffusion.
 * - Cache de 14 jours pour les séries et films terminés.
 */
export async function getSeriesImdbData(
  imdbId: string | null | undefined,
  forceRefresh: boolean = false
): Promise<SeriesImdbData | null> {
  if (!imdbId) return null;

  try {
    // 1. Chercher d'abord dans le cache
    const cached = await db.omdbEpisodesCache.get(imdbId);
    
    if (cached) {
      const age = Date.now() - (cached.updatedAt || 0);
      const isOngoing = (cached as any).isOngoing;
      const hasValidRating = typeof cached.rating === 'number' && cached.rating > 0;
      
      const cacheLifetime = !hasValidRating ? FOUR_HOURS : isOngoing ? ONE_DAY : FOURTEEN_DAYS;

      if (!forceRefresh && age < cacheLifetime && cached.rating !== undefined) {
        return {
          rating: cached.rating,
          votes: cached.votes,
          updatedAt: cached.updatedAt
        };
      }
    }

    // 2. Appel réseau si absent, expiré ou forcé
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
      rating: !isNaN(rating) && rating > 0 ? rating : 0,
      votes,
      updatedAt: Date.now()
    };

    // Sauvegarder dans le cache
    await db.omdbEpisodesCache.put({
      imdbId,
      votes,
      rating: result.rating,
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
