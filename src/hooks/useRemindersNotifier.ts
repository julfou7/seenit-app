import { useEffect } from 'react';
import { useShowsStore } from '../store/showsStore';
import { useToastStore } from '../store/toastStore';
import { getUpcomingEpisodeInfo } from '../components/cards/UpcomingShowCard';
import { sendNativeNotification } from '../lib/firebase';
import { getTodayStr } from '../lib/utils';

export function useRemindersNotifier() {
  const shows = useShowsStore(state => state.shows);
  const { showToast } = useToastStore();

  useEffect(() => {
    if (!shows || shows.length === 0) return;

    const todayStr = getTodayStr();
    const now = new Date();

    shows.forEach(s => {
      if (s.isArchived || s.status === 'dropped') return;

      const upcoming = getUpcomingEpisodeInfo(s);
      if (!upcoming || !upcoming.air_date) return;

      const sNum = String(upcoming.season_number).padStart(2, '0');
      const eNum = String(upcoming.episode_number).padStart(2, '0');

      // Check if user has enabled notifications for this show or set a specific episode reminder
      const isSpecificReminder = localStorage.getItem(`reminder_${s.id}_S${upcoming.season_number}E${upcoming.episode_number}`) === 'true';
      const isShowNotification = s.notificationsEnabled === true || localStorage.getItem(`reminder_${s.id}`) === 'true';

      // If user hasn't explicitly disabled it, followings & favorites are notified
      if (!isSpecificReminder && !isShowNotification && s.notificationsEnabled === false) return;

      const [year, month, day] = upcoming.air_date.split('-').map(Number);
      if (!year || !month || !day) return;

      // Exact 09:00:00 AM local time on the air date
      const airDate9Am = new Date(year, month - 1, day, 9, 0, 0, 0);

      const title = s.title;
      const body = `L'épisode S${sNum}E${eNum} ${upcoming.name ? `« ${upcoming.name} » ` : ''}est disponible aujourd'hui !`;
      const iconUrl = s.posterPath 
        ? (s.posterPath.startsWith('http') ? s.posterPath : `https://image.tmdb.org/t/p/w185${s.posterPath}`)
        : '/icon-192.png';
      const imageUrl = s.backdropPath 
        ? (s.backdropPath.startsWith('http') ? s.backdropPath : `https://image.tmdb.org/t/p/w780${s.backdropPath}`)
        : undefined;

      const notificationPayload = {
        body,
        icon: iconUrl,
        badge: '/icon-192.png',
        image: imageUrl,
        showId: s.id,
        tmdbId: s.tmdbId,
        mediaType: s.mediaType || 'tv',
        season: upcoming.season_number,
        episode: upcoming.episode_number,
        tag: `notif_${s.id}_S${sNum}E${eNum}_${upcoming.air_date}`,
        renotify: true,
        vibrate: [150, 80, 150, 80, 250],
        data: {
          url: `/?showId=${s.id}&tmdbId=${s.tmdbId}&mediaType=${s.mediaType || 'tv'}&season=${upcoming.season_number}&episode=${upcoming.episode_number}&tab=watchlist`,
          showId: s.id,
          tmdbId: s.tmdbId,
          mediaType: s.mediaType || 'tv',
          season: upcoming.season_number,
          episode: upcoming.episode_number
        },
        actions: [
          {
            action: 'mark_watched',
            title: '✓ Marquer comme vu'
          }
        ]
      };

      // 1. Future release date (or today before 9:00 AM) -> Schedule Native Alarm at 9:00 AM
      if (airDate9Am.getTime() > now.getTime()) {
        const scheduleKey = `scheduled_9am_${s.id}_S${sNum}E${eNum}_${upcoming.air_date}`;
        const alreadyScheduled = localStorage.getItem(scheduleKey);

        if (!alreadyScheduled) {
          try {
            localStorage.setItem(scheduleKey, 'true');
          } catch {}

          sendNativeNotification(title, {
            ...notificationPayload,
            scheduleDate: airDate9Am
          } as any);
        }
        return;
      }

      // 2. Air date is today and it is already 9:00 AM or later -> Notify immediately if not yet done
      if (upcoming.air_date === todayStr) {
        const notifiedKey = `notified_today_${s.id}_S${sNum}E${eNum}_${todayStr}`;

        if (!localStorage.getItem(notifiedKey)) {
          try {
            localStorage.setItem(notifiedKey, 'true');
          } catch {}

          const msg = `🎉 Sortie aujourd'hui : ${title} S${sNum}E${eNum} est disponible !`;
          showToast(msg, 'info', s);

          sendNativeNotification(title, {
            ...notificationPayload,
            scheduleDate: undefined
          } as any);
        }
      }
    });
  }, [shows, showToast]);
}
