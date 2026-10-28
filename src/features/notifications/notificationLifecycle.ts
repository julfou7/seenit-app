import type { Show } from '../../types.ts';

export interface DeliveredMediaAlert {
  id: number | string;
  extra?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

export function isObsoleteMediaAlert(alert: DeliveredMediaAlert, uid: string, shows: readonly Show[]): boolean {
  const data = alert.extra || alert.data || {};
  // Ne jamais retirer un téléchargement en cours ni une alerte d'un autre compte.
  if (data.ownerUid !== uid || data.notificationScope !== 'media') return false;
  const show = shows.find(item => item.userId === uid && item.mediaType === data.mediaType
    && String(item.id) === String(data.showId));
  if (!show) return false;
  if (show.isArchived || show.status === 'dropped' || show.notificationsEnabled === false) return true;
  if (show.mediaType === 'movie') return show.seenEpisodes.includes('movie');
  const season = Number(data.season), episode = Number(data.episode);
  return data.season !== undefined && Number.isInteger(season) && season >= 0
    && Number.isInteger(episode) && episode > 0 && show.seenEpisodes.includes(`${season}x${episode}`);
}

export function isSameVisibleMediaAlert(left: DeliveredMediaAlert, right: DeliveredMediaAlert): boolean {
  const a = left.extra || left.data || {}, b = right.extra || right.data || {};
  return a.notificationScope === 'media' && b.notificationScope === 'media'
    && !!a.ownerUid && a.ownerUid === b.ownerUid && !!a.showId && String(a.showId) === String(b.showId)
    && a.mediaType === b.mediaType;
}
