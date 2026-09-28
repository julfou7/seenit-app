import { type Show } from '../../types';

export interface WatchEpisodePointer {
  season_number: number;
  episode_number: number;
  air_date?: string | null;
  episode_count?: number | null;
  name?: string | null;
}

interface CachedEpisode {
  episode_number: number;
  air_date?: string | null;
}

interface CachedSeason {
  season_number: number;
  episode_count?: number | null;
  episodes?: CachedEpisode[];
}

function positiveCount(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Nombre d'épisodes déjà diffusés restant à regarder APRÈS l'épisode de reprise.
 *
 * Cette valeur alimente la carte « À Regarder » et les notifications afin qu'un
 * même état de progression produise toujours le même « + X ».
 */
export function getExtraAvailableEpisodes(
  show: Show,
  nextEpisode: WatchEpisodePointer,
  todayStr: string,
): number {
  const watchedCount = show.seenEpisodes?.length ?? 0;
  const totalAiredCount = positiveCount(show.totalAiredEpisodes);

  const seasonsCache = (show.seasonsCache ?? []) as CachedSeason[];
  const seenSet = new Set(show.seenEpisodes ?? []);
  let cacheUnwatchedCount = 0;

  for (const season of seasonsCache) {
    if (season.season_number <= 0 || !Array.isArray(season.episodes)) continue;
    for (const episode of season.episodes) {
      if (!episode.air_date || episode.air_date > todayStr) continue;
      if (!seenSet.has(`${season.season_number}x${episode.episode_number}`)) {
        cacheUnwatchedCount += 1;
      }
    }
  }

  if (totalAiredCount > 0) {
    const unwatchedFromTotal = Math.max(0, totalAiredCount - watchedCount);
    return Math.max(0, Math.max(unwatchedFromTotal, cacheUnwatchedCount) - 1);
  }

  if (cacheUnwatchedCount > 0) {
    return Math.max(0, cacheUnwatchedCount - 1);
  }

  const cachedSeason = seasonsCache.find(
    season => season.season_number === nextEpisode.season_number,
  );
  const nextEpisodeToAir = show.nextEpisodeToAir as WatchEpisodePointer | undefined;

  const totalSeasonEpisodes =
    positiveCount(nextEpisode.episode_count)
    || positiveCount(cachedSeason?.episode_count)
    || (cachedSeason?.episodes?.length ?? 0)
    || (
      nextEpisodeToAir?.season_number === nextEpisode.season_number
        ? positiveCount(nextEpisodeToAir.episode_count)
        : 0
    )
    || 1;

  let airedInSeason = totalSeasonEpisodes;

  if (cachedSeason?.episodes?.length) {
    const airedFromCache = cachedSeason.episodes.filter(
      episode => Boolean(episode.air_date && episode.air_date <= todayStr),
    ).length;
    if (airedFromCache > 0) {
      airedInSeason = airedFromCache;
    }
  } else if (nextEpisodeToAir?.season_number === nextEpisode.season_number) {
    if (nextEpisodeToAir.air_date && nextEpisodeToAir.air_date > todayStr) {
      airedInSeason = Math.max(0, nextEpisodeToAir.episode_number - 1);
    } else if (nextEpisodeToAir.episode_number) {
      airedInSeason = Math.max(airedInSeason, nextEpisodeToAir.episode_number);
    }
  } else if (nextEpisode.air_date && nextEpisode.air_date > todayStr) {
    airedInSeason = Math.max(0, nextEpisode.episode_number - 1);
  }

  return Math.max(0, airedInSeason - nextEpisode.episode_number);
}
