import type { SeasonProgressEvidence, Show } from '../../types';

/** Répare une seule fois les anciennes preuves qui confondaient liste et total. */
export function needsSeasonProgressRefresh(show: Pick<Show, 'seasonProgress' | 'nextEpisodeToWatch' | 'nextEpisodeToAir'>): boolean {
  return Object.values(show.seasonProgress || {}).some(evidence => !Object.hasOwn(evidence, 'episode_count'))
    || [show.nextEpisodeToWatch, show.nextEpisodeToAir].some(pointer => typeof pointer?.season_total_unknown === 'boolean'
      && !Object.hasOwn(show.seasonProgress?.[String(pointer.season_number)] || {}, 'episode_count'));
}

interface EpisodeEvidence { episode_number?: number; episode_type?: string | null; air_date?: string | null }
interface SeasonEvidence { season_number: number; episode_count?: number; episodes?: EpisodeEvidence[] }

/** Métadonnées publiques compactes conservées lorsque seasonsCache est supprimé. */
export function buildSeasonProgressEvidence(seasons: readonly SeasonEvidence[], ended: boolean): Record<string, SeasonProgressEvidence> {
  const lastSeason = seasons.reduce((maximum, season) => Math.max(maximum, season.season_number), 0);
  return Object.fromEntries(seasons.map(season => {
    const last = (season.episodes || []).reduce<EpisodeEvidence | null>((latest, episode) =>
      Number(episode.episode_number) > Number(latest?.episode_number || 0) ? episode : latest, null);
    const total = typeof season.episode_count === 'number' && Number.isInteger(season.episode_count) && season.episode_count > 0 && season.episode_count <= 10_000 ? season.episode_count : null;
    const known = Math.max(total || 0, last?.episode_number || 0);
    const datedFinale = last?.episode_type === 'finale' && /^\d{4}-\d{2}-\d{2}$/.test(last.air_date || '') && Number(last.episode_number) >= known;
    return [String(season.season_number), {
      season_number: season.season_number, episode_count: total, known_episodes_in_season: known,
      last_season_number: lastSeason,
      season_total_unknown: total === null && !ended && season.season_number === lastSeason && !datedFinale,
      last_known_episode_type: last?.episode_type || null,
      last_known_episode_air_date: last?.air_date || null,
    } satisfies SeasonProgressEvidence];
  }));
}
