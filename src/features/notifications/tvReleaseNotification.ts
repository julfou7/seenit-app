import type { Show } from '../../types.ts';
import type { MediaReminderNotificationOptions } from './mediaReminderNotification.ts';
import { buildTvEpisodeReminderCopy, type TvReminderEpisode } from './tvReminderCopy.ts';

type ReleaseEpisode = TvReminderEpisode & { air_date?: string | null; still_path?: string | null };

const tmdbImage = (path: string | null | undefined, size: 'w342' | 'w500') =>
  !path ? undefined : path.startsWith('http') ? path : `https://image.tmdb.org/t/p/${size}${path}`;

/**
 * Notification « nouvel épisode » d'une série, construite au même endroit pour le vrai rappel et pour la
 * notification de test des Réglages (retour du 15/11 : « une seule notif, mais qui utilise le code à jour »).
 * Affiche en vignette, image de l'épisode (ou image paysage de la série) en grand, épisode à reprendre ciblé
 * par « ✓ Vu », catégorie Rappels pour une cloche explicite sinon Épisodes et saisons.
 */
export function buildTvReleaseNotification(input: {
  show: Show;
  released: ReleaseEpisode;
  todayStr: string;
  provider?: { id: number; name: string };
  isSpecificReminder: boolean;
}): { title: string; iconUrl?: string; imageUrl?: string; options: MediaReminderNotificationOptions } {
  const { show, released, todayStr, provider, isSpecificReminder } = input;
  const iconUrl = tmdbImage(show.posterPath, 'w342');
  const still = released.still_path || show.nextEpisodeToAir?.still_path || show.nextEpisodeToWatch?.still_path;
  const imageUrl = tmdbImage(still, 'w500') || tmdbImage(show.backdropPath, 'w500') || iconUrl;
  const next = show.nextEpisodeToWatch;
  const target = next && (!next.air_date || !released.air_date || next.air_date <= released.air_date) ? next : released;
  const copy = buildTvEpisodeReminderCopy(show, released, todayStr, provider?.name);
  return {
    title: show.title,
    iconUrl,
    imageUrl,
    options: {
      badge: 'https://seenit.app/icon-192.png',
      showId: show.id,
      tmdbId: show.tmdbId,
      mediaType: 'tv',
      season: target.season_number,
      episode: target.episode_number,
      renotify: true,
      vibrate: [150, 80, 150, 80, 250],
      body: copy.body,
      summaryText: copy.summaryText,
      detailText: copy.detailText,
      provider,
      allowMarkWatched: true,
      allowTonight: true,
      actionTitle: target.episode_number !== released.episode_number ? `✓ Vu E${String(target.episode_number).padStart(2, '0')}` : '✓ Vu',
      channelId: isSpecificReminder ? 'seenit_reminders' : 'seenit_episodes',
      data: {
        releasedSeason: released.season_number, releasedEpisode: released.episode_number,
        releasedName: released.name, releasedDate: released.air_date,
        url: `/?showId=${show.id}&tmdbId=${show.tmdbId}&mediaType=tv&season=${target.season_number}&episode=${target.episode_number}&tab=watchlist`,
        showId: show.id,
        tmdbId: show.tmdbId,
        mediaType: 'tv',
        season: target.season_number,
        episode: target.episode_number,
      },
    } as MediaReminderNotificationOptions,
  };
}
