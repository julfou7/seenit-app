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

    const savedNotifs = localStorage.getItem('user_notifications');
    const userPrefs = savedNotifs ? JSON.parse(savedNotifs) : {
      release_today_tv: true,
      season_d7: true,
      movie_theater: true,
      movie_dvd_vod: true
    };

    shows.forEach(s => {
      if (s.isArchived || s.status === 'dropped') return;

      const isShowNotification = s.notificationsEnabled === true || localStorage.getItem(`reminder_${s.id}`) === 'true';
      if (!isShowNotification && s.notificationsEnabled === false) return;

      const title = s.title;
      const iconUrl = s.posterPath 
        ? (s.posterPath.startsWith('http') ? s.posterPath : `https://image.tmdb.org/t/p/w185${s.posterPath}`)
        : 'https://seenit.app/icon-192.png';
      
      const imageUrl = s.backdropPath 
        ? (s.backdropPath.startsWith('http') ? s.backdropPath : `https://image.tmdb.org/t/p/w780${s.backdropPath}`)
        : (s.posterPath ? (s.posterPath.startsWith('http') ? s.posterPath : `https://image.tmdb.org/t/p/w500${s.posterPath}`) : iconUrl);

      // --- FILMS ---
      if (s.mediaType === 'movie' && s.firstAirDate) {
        const [year, month, day] = s.firstAirDate.split('-').map(Number);
        if (!year || !month || !day) return;

        const releaseDate = new Date(year, month - 1, day, 9, 0, 0, 0);
        // VOD/DVD Release approx 4 months (120 days) after theatrical release in France
        const dvdDate = new Date(releaseDate.getTime() + 120 * 24 * 60 * 60 * 1000);
        
        const scheduleMovieAlert = (targetDate: Date, tag: string, msgTitle: string, msgBody: string, isVOD: boolean = false) => {
          const targetStr = targetDate.toISOString().split('T')[0];
          
          const notificationPayload = {
            body: msgBody,
            icon: iconUrl,
            badge: 'https://seenit.app/icon-192.png',
            image: imageUrl,
            showId: s.id,
            tmdbId: s.tmdbId,
            mediaType: 'movie',
            tag: `notif_${s.id}_${tag}_${targetStr}`,
            renotify: true,
            vibrate: [150, 80, 150, 80, 250],
            data: {
              url: `/?showId=${s.id}&tmdbId=${s.tmdbId}&mediaType=movie&tab=watchlist`,
              showId: s.id,
              tmdbId: s.tmdbId,
              mediaType: 'movie'
            }
          };

          if (targetDate.getTime() > now.getTime()) {
            const scheduleKey = `scheduled_9am_${s.id}_${tag}_${targetStr}`;
            if (!localStorage.getItem(scheduleKey)) {
              try { localStorage.setItem(scheduleKey, 'true'); } catch {}
              sendNativeNotification(msgTitle, { ...notificationPayload, scheduleDate: targetDate } as any);
            }
          } else if (targetStr === todayStr) {
            const notifiedKey = `notified_today_${s.id}_${tag}_${todayStr}`;
            if (!localStorage.getItem(notifiedKey)) {
              try { localStorage.setItem(notifiedKey, 'true'); } catch {}
              showToast(`🍿 ${msgBody}`, 'info', s);
              sendNativeNotification(msgTitle, { ...notificationPayload, scheduleDate: undefined } as any);
            }
          }
        };

        if (userPrefs.movie_theater) {
          scheduleMovieAlert(releaseDate, 'theater', title, `Sortie Cinéma : ${title} est dans les salles aujourd'hui !`);
        }
        if (userPrefs.movie_dvd_vod) {
          scheduleMovieAlert(dvdDate, 'vod', title, `Sortie DVD / VOD : ${title} est désormais disponible !`, true);
        }
        return;
      }

      // --- SÉRIES TV ---
      const upcoming = getUpcomingEpisodeInfo(s);
      if (!upcoming || !upcoming.air_date) return;

      const sNum = String(upcoming.season_number).padStart(2, '0');
      const eNum = String(upcoming.episode_number).padStart(2, '0');

      const isSpecificReminder = localStorage.getItem(`reminder_${s.id}_S${upcoming.season_number}E${upcoming.episode_number}`) === 'true';
      if (!isSpecificReminder && !isShowNotification && s.notificationsEnabled === false) return;

      const [year, month, day] = upcoming.air_date.split('-').map(Number);
      if (!year || !month || !day) return;

      const airDate9Am = new Date(year, month - 1, day, 9, 0, 0, 0);
      const d7Date9Am = new Date(airDate9Am.getTime() - 7 * 24 * 60 * 60 * 1000);

      const episodeStill = upcoming.still_path || s.nextEpisodeToAir?.still_path || s.nextEpisodeToWatch?.still_path;
      const tvImageUrl = episodeStill
        ? (episodeStill.startsWith('http') ? episodeStill : `https://image.tmdb.org/t/p/w780${episodeStill}`)
        : imageUrl;

      const tvPayload = {
        icon: iconUrl,
        badge: 'https://seenit.app/icon-192.png',
        image: tvImageUrl,
        showId: s.id,
        tmdbId: s.tmdbId,
        mediaType: 'tv',
        season: upcoming.season_number,
        episode: upcoming.episode_number,
        renotify: true,
        vibrate: [150, 80, 150, 80, 250],
        data: {
          url: `/?showId=${s.id}&tmdbId=${s.tmdbId}&mediaType=tv&season=${upcoming.season_number}&episode=${upcoming.episode_number}&tab=watchlist`,
          showId: s.id,
          tmdbId: s.tmdbId,
          mediaType: 'tv',
          season: upcoming.season_number,
          episode: upcoming.episode_number
        }
      };

      const scheduleTvAlert = (targetDate: Date, tagPrefix: string, msgBody: string, addActions: boolean = false) => {
        const targetStr = targetDate.toISOString().split('T')[0];
        const fullPayload = {
          ...tvPayload,
          body: msgBody,
          tag: `notif_${s.id}_${tagPrefix}_S${sNum}E${eNum}_${targetStr}`,
          actions: addActions ? [{ action: 'mark_watched', title: '✓ Marquer comme vu' }] : undefined
        };

        if (targetDate.getTime() > now.getTime()) {
          const scheduleKey = `scheduled_9am_${s.id}_${tagPrefix}_S${sNum}E${eNum}_${targetStr}`;
          if (!localStorage.getItem(scheduleKey)) {
            try { localStorage.setItem(scheduleKey, 'true'); } catch {}
            sendNativeNotification(title, { ...fullPayload, scheduleDate: targetDate } as any);
          }
        } else if (targetStr === todayStr) {
          const notifiedKey = `notified_today_${s.id}_${tagPrefix}_S${sNum}E${eNum}_${todayStr}`;
          if (!localStorage.getItem(notifiedKey)) {
            try { localStorage.setItem(notifiedKey, 'true'); } catch {}
            showToast(`🎉 ${msgBody}`, 'info', s);
            sendNativeNotification(title, { ...fullPayload, scheduleDate: undefined } as any);
          }
        }
      };

      if (userPrefs.season_d7 && upcoming.episode_number === 1) {
        scheduleTvAlert(d7Date9Am, 'd7', `La saison ${upcoming.season_number} de ${title} sort dans 7 jours ! Préparez-vous !`);
      }

      if (userPrefs.release_today_tv || isSpecificReminder) {
        scheduleTvAlert(airDate9Am, 'today', `L'épisode S${sNum}E${eNum} ${upcoming.name ? `« ${upcoming.name} » ` : ''}est disponible aujourd'hui !`, true);
      }
    });
  }, [shows, showToast]);
}
