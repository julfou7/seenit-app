import type { SeasonProgressEvidence, Show } from '../../types';

type ConfirmedSeasonEvidence = SeasonProgressEvidence & { total_evidence_version: 2 };
export function isCurrentSeasonProgress(evidence: SeasonProgressEvidence | undefined): evidence is ConfirmedSeasonEvidence {
  return Boolean(evidence && Object.hasOwn(evidence, 'episode_count') && 'total_evidence_version' in evidence && evidence.total_evidence_version === 2);
}

/** Répare une seule fois les anciennes preuves qui confondaient liste et total. */
export function needsSeasonProgressRefresh(show: Pick<Show, 'seasonProgress' | 'nextEpisodeToWatch' | 'nextEpisodeToAir'>): boolean {
  return Object.values(show.seasonProgress || {}).some(evidence => !isCurrentSeasonProgress(evidence))
    || [show.nextEpisodeToWatch, show.nextEpisodeToAir].some(pointer => typeof pointer?.season_total_unknown === 'boolean'
      && !isCurrentSeasonProgress(show.seasonProgress?.[String(pointer.season_number)]));
}

interface EpisodeEvidence { episode_number?: number; episode_type?: string | null; air_date?: string | null }
interface SeasonEvidence { season_number: number; episode_count?: number; episodes?: EpisodeEvidence[] }

/** Métadonnées publiques compactes conservées lorsque seasonsCache est supprimé. */
export function buildSeasonProgressEvidence(seasons: readonly SeasonEvidence[], ended: boolean): Record<string, ConfirmedSeasonEvidence> {
  const lastSeason = seasons.reduce((maximum, season) => Math.max(maximum, season.season_number), 0);
  return Object.fromEntries(seasons.map(season => {
    const last = (season.episodes || []).reduce<EpisodeEvidence | null>((latest, episode) =>
      Number(episode.episode_number) > Number(latest?.episode_number || 0) ? episode : latest, null);
    const total = typeof season.episode_count === 'number' && Number.isInteger(season.episode_count) && season.episode_count > 0 && season.episode_count <= 10_000 ? season.episode_count : null;
    const known = Math.max(total || 0, last?.episode_number || 0);
    const datedFinale = last?.episode_type === 'finale' && /^\d{4}-\d{2}-\d{2}$/.test(last.air_date || '') && Number(last.episode_number) >= known;
    const listed = Number(last?.episode_number || 0);
    const dated = new Set((season.episodes || []).filter(ep => Number(ep.episode_number) > 0 && Number(ep.episode_number) <= (total || 0) && /^\d{4}-\d{2}-\d{2}$/.test(ep.air_date || '')).map(ep => ep.episode_number));
    const completeSchedule = total !== null && dated.size >= total;
    const confirmed = total !== null && (ended || season.season_number < lastSeason || listed > 0 && total > listed || last?.episode_type === 'finale' || completeSchedule);
    return [String(season.season_number), {
      total_evidence_version: 2,
      season_number: season.season_number, episode_count: confirmed ? total : null, known_episodes_in_season: known,
      last_season_number: lastSeason,
      season_total_unknown: !confirmed && !datedFinale,
      last_known_episode_type: last?.episode_type || null,
      last_known_episode_air_date: last?.air_date || null,
    } satisfies ConfirmedSeasonEvidence];
  }));
}
