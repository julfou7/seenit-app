import { db } from '../../db/dexie';
import { authenticatedFetch } from '../../lib/apiAuth';
import { resolveSeenItApiUrl } from '../../lib/seenitApi';

export interface EpisodeImdbData {
  rating: number;
  imdbId: string;
}

export interface SeriesImdbData {
  rating: number;
  votes: string;
  updatedAt: number;
}

const FOUR_HOURS = 4 * 60 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;

async function fetchOmdb(imdbId: string, seasonNumber?: number): Promise<Response> {
  const params = new URLSearchParams({ i: imdbId });
  if (seasonNumber !== undefined) params.set('Season', String(seasonNumber));
  return authenticatedFetch(`${resolveSeenItApiUrl('/api/media/omdb')}?${params.toString()}`);
}

/**
 * Récupère les notes IMDb d'une saison avec la stratégie de cache historique.
 * Le client ne possède plus la clé OMDb : tout accès réseau passe par le backend SeenIt.
 */
export async function getSeasonImdbRatings(
  imdbId: string | null | undefined,
  seasonNumber: number,
  forceRefresh: boolean = false
): Promise<Record<number, EpisodeImdbData>> {
  if (!imdbId) return {};
  const cacheKey = `${imdbId}-S${seasonNumber}`;

  try {
    const cachedData = await db.omdbRatingsCache.get(cacheKey);
    let normalizedCache: Record<number, EpisodeImdbData> | null = null;

    if (cachedData?.ratings) {
      normalizedCache = {};
      Object.entries(cachedData.ratings).forEach(([epNumStr, value]) => {
        const epNum = parseInt(epNumStr, 10);
        if (typeof value === 'number') {
          normalizedCache![epNum] = { rating: value, imdbId: '' };
        } else if (value && typeof value === 'object' && typeof (value as any).rating === 'number') {
          normalizedCache![epNum] = {
            rating: (value as any).rating,
            imdbId: (value as any).imdbId || '',
          };
        }
      });

      const age = Date.now() - (cachedData.updatedAt || 0);
      const hasMissingRatings = Object.values(normalizedCache).some(ep => !ep || ep.rating === 0);
      const isOngoing = cachedData.isOngoing || hasMissingRatings;
      const cacheLifetime = hasMissingRatings ? FOUR_HOURS : isOngoing ? ONE_DAY : FOURTEEN_DAYS;
      if (!forceRefresh && age < cacheLifetime) return normalizedCache;
    }

    const response = await fetchOmdb(imdbId, seasonNumber);
    if (!response.ok) return normalizedCache || {};
    const data = await response.json();
    if (data.Response === 'False' || !Array.isArray(data.Episodes) || data.Episodes.length === 0) {
      return normalizedCache || {};
    }

    let hasNAs = false;
    let hasFutureEpisodes = false;
    const thirtyDaysAgo = Date.now() - 30 * ONE_DAY;
    const ratingsMap: Record<number, EpisodeImdbData> = {};
    const missingEpisodesToFetch: { epNum: number; epImdbId: string }[] = [];

    data.Episodes.forEach((episode: any) => {
      const epNum = parseInt(episode.Episode, 10);
      const rating = parseFloat(episode.imdbRating);
      const epImdbId = episode.imdbID || episode.imdbId || '';
      if (episode.imdbRating === 'N/A' || !episode.imdbRating || Number.isNaN(rating) || rating <= 0) {
        hasNAs = true;
        if (epImdbId && !Number.isNaN(epNum)) missingEpisodesToFetch.push({ epNum, epImdbId });
      }
      if (episode.Released && episode.Released !== 'N/A') {
        const releaseTime = new Date(episode.Released).getTime();
        if (!Number.isNaN(releaseTime) && releaseTime > thirtyDaysAgo) hasFutureEpisodes = true;
      } else {
        hasFutureEpisodes = true;
      }
      if (!Number.isNaN(epNum)) {
        ratingsMap[epNum] = {
          rating: !Number.isNaN(rating) && rating > 0 ? rating : 0,
          imdbId: epImdbId,
        };
      }
    });

    if (missingEpisodesToFetch.length > 0 && missingEpisodesToFetch.length <= 25) {
      await Promise.all(missingEpisodesToFetch.map(async ({ epNum, epImdbId }) => {
        try {
          const epResponse = await fetchOmdb(epImdbId);
          if (!epResponse.ok) return;
          const epData = await epResponse.json();
          const epRating = parseFloat(epData.imdbRating);
          if (!Number.isNaN(epRating) && epRating > 0) {
            ratingsMap[epNum] = { rating: epRating, imdbId: epImdbId };
          }
        } catch {
          // Un épisode indisponible ne doit pas invalider toute la saison.
        }
      }));
    }

    await db.omdbRatingsCache.put({
      id: cacheKey,
      imdbId,
      seasonNumber,
      ratings: ratingsMap,
      isOngoing: hasNAs || hasFutureEpisodes,
      updatedAt: Date.now(),
    });
    return ratingsMap;
  } catch (error) {
    console.warn('[OMDb] Erreur lors de la récupération des notes de la saison:', error);
    return {};
  }
}

/** Récupère la note globale IMDb d'une série ou d'un film via la façade backend. */
export async function getSeriesImdbData(
  imdbId: string | null | undefined,
  forceRefresh: boolean = false
): Promise<SeriesImdbData | null> {
  if (!imdbId) return null;

  try {
    const cached = await db.omdbEpisodesCache.get(imdbId);
    if (cached) {
      const age = Date.now() - (cached.updatedAt || 0);
      const isOngoing = (cached as any).isOngoing;
      const hasValidRating = typeof cached.rating === 'number' && cached.rating > 0;
      const cacheLifetime = !hasValidRating ? FOUR_HOURS : isOngoing ? ONE_DAY : FOURTEEN_DAYS;
      if (!forceRefresh && age < cacheLifetime && cached.rating !== undefined) {
        return { rating: cached.rating, votes: cached.votes, updatedAt: cached.updatedAt };
      }
    }

    const response = await fetchOmdb(imdbId);
    if (!response.ok) {
      return cached?.rating !== undefined
        ? { rating: cached.rating, votes: cached.votes, updatedAt: cached.updatedAt }
        : null;
    }
    const data = await response.json();
    if (data.Response === 'False' || !data.imdbRating || data.imdbRating === 'N/A') {
      return cached?.rating !== undefined
        ? { rating: cached.rating, votes: cached.votes, updatedAt: cached.updatedAt }
        : null;
    }

    const rating = parseFloat(data.imdbRating);
    const votes = data.imdbVotes && data.imdbVotes !== 'N/A' ? data.imdbVotes : '0';
    const year = data.Year || '';
    const isOngoing = year.endsWith('–') || year.endsWith('-') || (year.includes('–') && !year.split('–')[1]?.trim());
    const result: SeriesImdbData = {
      rating: !Number.isNaN(rating) && rating > 0 ? rating : 0,
      votes,
      updatedAt: Date.now(),
    };

    await db.omdbEpisodesCache.put({
      imdbId,
      votes,
      rating: result.rating,
      isOngoing,
      updatedAt: result.updatedAt,
    } as any);
    return result;
  } catch (error) {
    console.warn('[OMDb] Erreur lors de la récupération de la note globale:', error);
    return null;
  }
}

/** Récupère le nombre de votes IMDb d'un épisode spécifique via le backend SeenIt. */
export async function getEpisodeImdbVotes(episodeImdbId: string): Promise<string | null> {
  if (!episodeImdbId) return null;
  try {
    const cached = await db.omdbEpisodesCache.get(episodeImdbId);
    if (cached) return cached.votes;
    const response = await fetchOmdb(episodeImdbId);
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.imdbVotes || data.imdbVotes === 'N/A') return null;
    await db.omdbEpisodesCache.put({
      imdbId: episodeImdbId,
      votes: data.imdbVotes,
      updatedAt: Date.now(),
    });
    return data.imdbVotes;
  } catch {
    return null;
  }
}
