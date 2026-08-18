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

    shows.forEach(s => {
      if (s.isArchived || s.status === 'dropped') return;

      const upcoming = getUpcomingEpisodeInfo(s);
      if (!upcoming) return;

      // Check if episode airs today
      if (upcoming.air_date === todayStr) {
        const sNum = String(upcoming.season_number).padStart(2, '0');
        const eNum = String(upcoming.episode_number).padStart(2, '0');
        const notifiedKey = `notified_today_${s.id}_S${sNum}E${eNum}_${todayStr}`;

        if (!localStorage.getItem(notifiedKey)) {
          try {
            localStorage.setItem(notifiedKey, 'true');
          } catch {}

          const title = s.title;
          const msg = `🎉 Sortie aujourd'hui : ${title} S${sNum}E${eNum} est disponible !`;

          showToast(msg, 'info', s);

          const iconUrl = s.posterPath 
            ? (s.posterPath.startsWith('http') ? s.posterPath : `https://image.tmdb.org/t/p/w185${s.posterPath}`)
            : '/icon-192.png';
            
          const imageUrl = s.backdropPath 
            ? (s.backdropPath.startsWith('http') ? s.backdropPath : `https://image.tmdb.org/t/p/w780${s.backdropPath}`)
            : undefined;

          // Trigger native rich Android system notification via Service Worker
          sendNativeNotification(title, {
            body: `L'épisode S${sNum}E${eNum} ${upcoming.name ? `« ${upcoming.name} » ` : ''}est disponible aujourd'hui !`,
            icon: iconUrl,
            badge: '/icon-192.png',
            image: imageUrl,
            tag: notifiedKey,
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
          } as any);
        }
      }
    });
  }, [shows, showToast]);
}
