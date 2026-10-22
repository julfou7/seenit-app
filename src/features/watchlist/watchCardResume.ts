import type { Show } from '../../types.ts';
import { hasAiredEpisodeEvidence, isAiredDate } from './watchAvailability.ts';
import type { SeriesCardEpisode } from './seriesCardPresentation.ts';

interface CachedEpisode extends SeriesCardEpisode { still_path?: string | null }
interface CachedSeason { season_number: number; episode_count?: number; episodes?: CachedEpisode[] }
export interface WatchCardResume { episode: CachedEpisode | null; upToDate: boolean }

function validEpisode(value: SeriesCardEpisode | null | undefined): value is SeriesCardEpisode {
  return Boolean(value && Number.isInteger(value.season_number) && value.season_number >= 0 && Number.isInteger(value.episode_number) && value.episode_number > 0);
}

/** Le pointeur de diffusion sert au calendrier, jamais de repli pour une reprise. */
export function resolveWatchCardResume(show: Show, today: string): WatchCardResume {
  const seen = new Set((show.seenEpisodes || []).flatMap(key => {
    const match = /^(?:s\s*)?(\d+)\s*(?:x|e)\s*(\d+)$/i.exec(key.trim());
    return match ? [`${Number(match[1])}x${Number(match[2])}`] : [];
  }));
  const total = show.totalAiredEpisodes;
  const complete = show.status === 'completed' || show.isArchived
    || (typeof total === 'number' && total > 0 && seen.size >= total);
  if (complete) return { episode: null, upToDate: true };
  if (show.status === 'dropped' || !hasAiredEpisodeEvidence(show, today)) return { episode: null, upToDate: false };
  const pointer = show.nextEpisodeToWatch as CachedEpisode | null | undefined;
  if (validEpisode(pointer) && !seen.has(`${pointer.season_number}x${pointer.episode_number}`)
    && (!pointer.air_date || isAiredDate(pointer.air_date, today))) return { episode: pointer, upToDate: false };

  const seasons = (show.seasonsCache || []) as CachedSeason[];
  const cachedEpisodes = seasons.filter(season => season.season_number > 0).flatMap(season => (season.episodes || []).map(episode => ({ ...episode, season_number: season.season_number, episode_count: season.episode_count || season.episodes?.length })));
  const nextCached = cachedEpisodes.filter(episode => validEpisode(episode) && !seen.has(`${episode.season_number}x${episode.episode_number}`) && isAiredDate(episode.air_date, today))
    .sort((a, b) => a.season_number - b.season_number || a.episode_number - b.episode_number)[0];
  if (nextCached) return { episode: nextCached, upToDate: false };
  // Une date future explicite interdit de réinventer cet épisode sans date.
  if (!pointer && cachedEpisodes.length === 0 && seen.size === 0) {
    const upcoming = show.nextEpisodeToAir as SeriesCardEpisode | null | undefined;
    if (upcoming?.season_number === 1 && upcoming.episode_number === 1 && upcoming.air_date && upcoming.air_date > today) return { episode: null, upToDate: false };
    return { episode: { season_number: 1, episode_number: 1, air_date: isAiredDate(show.firstAirDate, today) ? show.firstAirDate : null }, upToDate: false };
  }
  return { episode: null, upToDate: false };
}

/** Façade appelée par le handler de production, sans altérer le Show ni l'undo existant. */
export async function markWatchCardEpisode(show: Show, today: string, mark: (show: Show, season: number, episode: number) => Promise<void | boolean>): Promise<boolean> {
  const resume = resolveWatchCardResume(show, today);
  if (!show.id || !resume.episode || resume.upToDate) return false;
  if (await mark(show, resume.episode.season_number, resume.episode.episode_number) === false) return false;
  return true;
}
