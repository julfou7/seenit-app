import type { Show } from '../../types.ts';

export interface DeliveredMediaAlert {
  id: number | string;
  extra?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

/** Choix posé sur un épisode (cloche allumée ou coupée), `null` sans choix ; fourni par l'appelant. */
export type EpisodeChoiceReader = (show: Show, season: number, episode: number) => boolean | null;

export function isObsoleteMediaAlert(alert: DeliveredMediaAlert, uid: string, shows: readonly Show[], episodeChoice?: EpisodeChoiceReader): boolean {
  const data = alert.extra || alert.data || {};
  // Ne jamais retirer un téléchargement en cours ni une alerte d'un autre compte.
  if (data.ownerUid !== uid || data.notificationScope !== 'media') return false;
  const show = shows.find(item => item.userId === uid && item.mediaType === data.mediaType
    && String(item.id) === String(data.showId));
  if (!show) return false;
  if (show.isArchived || show.status === 'dropped') return true;
  if (show.mediaType === 'movie') return show.notificationsEnabled === false || show.seenEpisodes.includes('movie');
  const season = Number(data.season), episode = Number(data.episode);
  const known = data.season !== undefined && Number.isInteger(season) && season >= 0 && Number.isInteger(episode) && episode > 0;
  if (known && show.seenEpisodes.includes(`${season}x${episode}`)) return true;
  // Revue Codex #1099 (« une cloche = cet épisode seul ») : le choix de l'épisode l'emporte sur la série coupée.
  // Revue Codex #1099 : l'alerte porte l'épisode à reprendre (`season`/`episode`, action « Vu ») et l'épisode annoncé
  // (`releasedSeason`/`releasedEpisode`) ; la cloche se lit sur l'épisode annoncé, sinon sur l'épisode de l'alerte.
  const releasedSeason = Number(data.releasedSeason), releasedEpisode = Number(data.releasedEpisode);
  const released = data.releasedSeason !== undefined && Number.isInteger(releasedSeason) && releasedSeason >= 0 && Number.isInteger(releasedEpisode) && releasedEpisode > 0;
  const choice = released ? episodeChoice?.(show, releasedSeason, releasedEpisode) ?? null : known ? episodeChoice?.(show, season, episode) ?? null : null;
  return choice === false || (choice !== true && show.notificationsEnabled === false);
}

export function isSameVisibleMediaAlert(left: DeliveredMediaAlert, right: DeliveredMediaAlert): boolean {
  const a = left.extra || left.data || {}, b = right.extra || right.data || {};
  return a.notificationScope === 'media' && b.notificationScope === 'media'
    && !!a.ownerUid && a.ownerUid === b.ownerUid && !!a.showId && String(a.showId) === String(b.showId)
    && a.mediaType === b.mediaType;
}
