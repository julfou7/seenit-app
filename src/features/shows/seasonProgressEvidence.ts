import type { SeasonProgressEvidence } from '../../types';

interface EpisodeEvidence { episode_number?: number; episode_type?: string | null; air_date?: string | null }
interface SeasonEvidence { season_number: number; episode_count?: number; episodes?: EpisodeEvidence[] }

/** Métadonnées publiques compactes conservées lorsque seasonsCache est supprimé. */
export function buildSeasonProgressEvidence(seasons: readonly SeasonEvidence[], ended: boolean): Record<string, SeasonProgressEvidence> {
  const lastSeason = seasons.reduce((maximum, season) => Math.max(maximum, season.season_number), 0);
  return Object.fromEntries(seasons.map(season => {
    const last = (season.episodes || []).reduce<EpisodeEvidence | null>((latest, episode) =>
      Number(episode.episode_number) > Number(latest?.episode_number || 0) ? episode : latest, null);
    const known = Math.max(season.episode_count || 0, last?.episode_number || 0);
    const datedFinale = last?.episode_type === 'finale' && /^\d{4}-\d{2}-\d{2}$/.test(last.air_date || '') && Number(last.episode_number) >= known;
    return [String(season.season_number), {
      season_number: season.season_number, known_episodes_in_season: known,
      last_season_number: lastSeason,
      season_total_unknown: !ended && season.season_number === lastSeason && !datedFinale,
      last_known_episode_type: last?.episode_type || null,
      last_known_episode_air_date: last?.air_date || null,
    } satisfies SeasonProgressEvidence];
  }));
}
