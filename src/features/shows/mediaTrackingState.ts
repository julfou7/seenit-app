import type { Show } from '../../types';

export type TrackableMedia = Partial<Show> & Pick<Show, 'status'>;

export function hasRecordedMediaProgress(media: Partial<Show>): boolean {
  if (Array.isArray(media.seenEpisodes) && media.seenEpisodes.length > 0) return true;
  if (media.episodeRecords && Object.keys(media.episodeRecords).length > 0) return true;
  return false;
}

export function isExplicitPendingRewatch(media: Partial<Show>): boolean {
  if (media.mediaType !== 'tv' || media.status !== 'watching') return false;
  if (hasRecordedMediaProgress(media)) return false;

  const next = media.nextEpisodeToWatch;
  const lastWatchedAt = Number(media.lastWatchedAt || 0);
  return Number.isFinite(lastWatchedAt)
    && lastWatchedAt > 0
    && Number(next?.season_number) === 1
    && Number(next?.episode_number) === 1;
}

export function shouldNormalizeInitialTrackingState(media: Partial<Show>): boolean {
  return media.status === 'watching'
    && !hasRecordedMediaProgress(media)
    && !isExplicitPendingRewatch(media);
}

export function normalizeTrackedMediaState<T extends TrackableMedia>(media: T): T {
  if (!shouldNormalizeInitialTrackingState(media)) return media;
  return { ...media, status: 'plan_to_watch' } as T;
}
