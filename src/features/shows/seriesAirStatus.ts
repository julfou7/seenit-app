/**
 * SEENIT-UX-023 : statut réel de diffusion d'une série sur sa fiche, lu dans les détails TMDB.
 * Il dit si des épisodes sont attendus : diffusion en cours, renouvelée (prochaine saison datée),
 * en cours sans date, terminée ou annulée.
 */
export type SeriesAirTone = 'airing' | 'renewed' | 'ongoing' | 'ended' | 'canceled';

export interface SeriesAirStatus {
  label: string;
  tone: SeriesAirTone;
  /** Date du prochain épisode ou de la prochaine saison, si TMDB la donne. */
  detail: string | null;
}

interface EpisodeRef { air_date?: string | null; season_number?: number | null }
export interface SeriesAirDetails {
  status?: string | null;
  next_episode_to_air?: EpisodeRef | null;
  last_episode_to_air?: EpisodeRef | null;
}

const shortDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const yearDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

function formatAirDate(value: string | null | undefined, now: number): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  return (year === new Date(now).getFullYear() ? shortDate : yearDate).format(date);
}

export function seriesAirStatus(details: SeriesAirDetails | null | undefined, now = Date.now()): SeriesAirStatus | null {
  const status = details?.status;
  if (!status) return null;
  if (status === 'Ended') return { label: 'Terminée', tone: 'ended', detail: null };
  if (status === 'Canceled') return { label: 'Annulée', tone: 'canceled', detail: null };
  const next = details?.next_episode_to_air || null;
  const last = details?.last_episode_to_air || null;
  const nextSeason = Number(next?.season_number);
  const date = formatAirDate(next?.air_date, now);
  if (next && Number.isFinite(nextSeason)) {
    // Même saison que le dernier épisode diffusé : la saison passe en ce moment.
    if (last && Number(last.season_number) === nextSeason) return { label: 'En diffusion', tone: 'airing', detail: date ? `prochain épisode le ${date}` : null };
    return { label: 'Renouvelée', tone: 'renewed', detail: date ? `saison ${nextSeason} le ${date}` : `saison ${nextSeason} annoncée` };
  }
  if (status === 'In Production') return { label: 'En production', tone: 'renewed', detail: null };
  if (status === 'Planned' || status === 'Pilot') return { label: 'Prévue', tone: 'renewed', detail: null };
  return { label: 'En cours', tone: 'ongoing', detail: 'pas de date annoncée' };
}
