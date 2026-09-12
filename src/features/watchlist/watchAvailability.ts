import type { Show } from '../../types';

export type WatchAvailabilityEvidence = Pick<
  Show,
  'mediaType' | 'seenEpisodes' | 'totalAiredEpisodes' | 'firstAirDate' | 'nextEpisodeToWatch'
>;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isAiredDate(
  airDate: string | null | undefined,
  todayIso: string = new Date().toISOString().slice(0, 10),
): boolean {
  return Boolean(airDate && ISO_DATE_PATTERN.test(airDate) && airDate <= todayIso);
}

/**
 * SEENIT-WATCHLIST-001 — Unknown metadata is never promoted to "available".
 * A TV show only has watchable evidence once SeenIt can positively prove that
 * at least one episode has aired. Production status and total episode count are
 * deliberately ignored: an in-production show may have old aired seasons, while
 * a TBA show may already expose a planned episode count without any aired episode.
 */
export function hasAiredEpisodeEvidence(
  show: WatchAvailabilityEvidence,
  todayIso: string = new Date().toISOString().slice(0, 10),
): boolean {
  if (show.mediaType !== 'tv') return true;
  if ((show.seenEpisodes?.length ?? 0) > 0) return true;
  if (typeof show.totalAiredEpisodes === 'number' && show.totalAiredEpisodes > 0) return true;
  if (isAiredDate(show.firstAirDate, todayIso)) return true;
  if (isAiredDate(show.nextEpisodeToWatch?.air_date, todayIso)) return true;
  return false;
}
