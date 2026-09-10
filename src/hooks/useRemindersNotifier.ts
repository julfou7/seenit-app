import { useEffect } from 'react';
import { useShowsStore } from '../store/showsStore';
import { useToastStore } from '../store/toastStore';
import { getUpcomingEpisodeInfo } from '../components/cards/UpcomingShowCard';
import { auth } from '../lib/firebase';
import { getTodayStr } from '../lib/utils';
import { readUserScopedJson, writeUserScopedJson } from '../lib/userIsolation';
import { tmdb } from '../features/shows/tmdb';
import { resolveNotificationMediaVisual } from '../features/notifications/notificationMedia';
import {
  cancelMediaReminderNotificationByTag,
  getMediaReminderNotificationId,
  prunePendingMediaReminderNotifications,
  sendMediaReminderNotification,
} from '../features/notifications/mediaReminderNotification';
import {
  resolveFrenchMovieReleaseReminderDate,
  toLocalReminderDate,
} from '../features/notifications/movieReleaseReminder';

const REMINDER_SCHEDULE_SCHEMA = 'v4';

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function useRemindersNotifier() {
  const shows = useShowsStore(state => state.shows);
  const { showToast } = useToastStore();

  useEffect(() => {
    if (!shows || shows.length === 0) return;

    const todayStr = getTodayStr();
    const now = new Date();

    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const userPrefs = readUserScopedJson(uid, 'notifications', {
      release_today_tv: true,
      season_d7: true,
      movie_theater: true,
      movie_dvd_vod: true
    });

    const processReminders = async () => {
      // Delay execution to avoid hanging the app during startup
      await new Promise(r => setTimeout(r, 5000));
      for (const s of shows) {
        // Small delay between each processing to let the JS event loop breathe
        await new Promise(r => setTimeout(r, 50));

        if (s.isArchived || s.status === 'dropped') {
          await prunePendingMediaReminderNotifications(s.id, s.mediaType, []);
          continue;
        }

        const isShowNotification = s.notificationsEnabled === true || readUserScopedJson(uid, `reminder_${s.id}`, false);
        if (!isShowNotification && s.notificationsEnabled === false) {
          await prunePendingMediaReminderNotifications(s.id, s.mediaType, []);
          continue;
        }

        const title = s.title;
        // Le logo SeenIt n'est jamais substitué à une affiche absente : le
        // résolveur natif doit pouvoir choisir explicitement le fallback texte.
        const iconUrl = s.posterPath
          ? (s.posterPath.startsWith('http') ? s.posterPath : `https://image.tmdb.org/t/p/w154${s.posterPath}`)
          : undefined;

        const imageUrl = s.backdropPath
          ? (s.backdropPath.startsWith('http') ? s.backdropPath : `https://image.tmdb.org/t/p/w500${s.backdropPath}`)
          : (s.posterPath ? (s.posterPath.startsWith('http') ? s.posterPath : `https://image.tmdb.org/t/p/w500${s.posterPath}`) : undefined);

        // --- FILMS ---
        if (s.mediaType === 'movie') {
          const tmdbId = Number(s.tmdbId);
          if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
            await prunePendingMediaReminderNotifications(s.id, 'movie', []);
            continue;
          }

          if (!userPrefs.movie_theater && !userPrefs.movie_dvd_vod) {
            await prunePendingMediaReminderNotifications(s.id, 'movie', []);
            continue;
          }

          // Les rappels film reposent uniquement sur les release_dates FR TMDB.
          // Une date générique ou une estimation J+N n'est jamais présentée comme
          // une disponibilité réelle.
          const detailsResult = await tmdb.getMovieDetails(tmdbId);
          if (!detailsResult.ok || !detailsResult.value) {
            // Fail closed : mieux vaut retirer une ancienne alarme incertaine que
            // produire un faux positif pendant une indisponibilité de métadonnée.
            await prunePendingMediaReminderNotifications(s.id, 'movie', []);
            continue;
          }

          const theaterDateKey = userPrefs.movie_theater
            ? resolveFrenchMovieReleaseReminderDate(detailsResult.value, 'theater')
            : null;
          const homeDateKey = userPrefs.movie_dvd_vod
            ? resolveFrenchMovieReleaseReminderDate(detailsResult.value, 'home')
            : null;

          const buildMovieNotificationTag = (tag: string, targetStr: string) => (
            `notif_${s.id}_${tag}_${targetStr}`
          );

          const allowedPendingMovieIds: number[] = [];
          const rememberFutureMovieId = (dateKey: string | null, tag: string) => {
            if (!dateKey) return;
            const targetDate = toLocalReminderDate(dateKey);
            if (!targetDate || targetDate.getTime() <= now.getTime()) return;
            allowedPendingMovieIds.push(getMediaReminderNotificationId(buildMovieNotificationTag(tag, dateKey)));
          };
          rememberFutureMovieId(theaterDateKey, 'theater');
          rememberFutureMovieId(homeDateKey, 'vod');

          // Supprime les anciennes alarmes du même film (dont l'ancien J+120)
          // lorsque leur identifiant ne correspond plus à une vraie date FR.
          await prunePendingMediaReminderNotifications(s.id, 'movie', allowedPendingMovieIds);

          const scheduleMovieAlert = async (
            targetStr: string,
            tag: string,
            notificationTitle: string,
            summaryText: string,
            msgBody: string
          ) => {
            const targetDate = toLocalReminderDate(targetStr);
            if (!targetDate) return;

            const notificationTag = buildMovieNotificationTag(tag, targetStr);
            const notificationPayload = {
              body: msgBody,
              badge: 'https://seenit.app/icon-192.png',
              showId: s.id,
              tmdbId,
              mediaType: 'movie',
              tag: notificationTag,
              renotify: true,
              vibrate: [150, 80, 150, 80, 250],
              data: {
                url: `/?showId=${s.id}&tmdbId=${tmdbId}&mediaType=movie&tab=watchlist`,
                showId: s.id,
                tmdbId,
                mediaType: 'movie'
              }
            };

            const send = async (scheduleDate?: Date) => {
              const mediaVisual = await resolveNotificationMediaVisual(iconUrl, imageUrl);
              return sendMediaReminderNotification(notificationTitle, {
                ...notificationPayload,
                ...mediaVisual,
                summaryText,
                scheduleDate
              } as any);
            };

            if (targetDate.getTime() > now.getTime()) {
              const scheduleKey = `scheduled_9am_${REMINDER_SCHEDULE_SCHEMA}_${s.id}_${tag}_${targetStr}`;
              if (!readUserScopedJson(uid, scheduleKey, false)) {
                // Même ID Android : on remplace explicitement une éventuelle
                // ancienne alarme pour lui injecter le payload visuel courant.
                await cancelMediaReminderNotificationByTag(notificationTag);
                if (await send(targetDate)) writeUserScopedJson(uid, scheduleKey, true);
              }
            } else if (targetStr === todayStr) {
              const notifiedKey = `notified_today_${s.id}_${tag}_${todayStr}`;
              if (!readUserScopedJson(uid, notifiedKey, false)) {
                showToast(`🍿 ${msgBody}`, 'info', s);
                if (await send()) writeUserScopedJson(uid, notifiedKey, true);
              }
            }
          };

          if (theaterDateKey) {
            await scheduleMovieAlert(
              theaterDateKey,
              'theater',
              title,
              '🎬 Sortie cinéma',
              "Dans les salles aujourd'hui."
            );
          }
          if (homeDateKey) {
            await scheduleMovieAlert(
              homeDateKey,
              'vod',
              title,
              '📺 Sortie DVD / VOD',
              'Disponible en DVD / VOD aujourd’hui.'
            );
          }
          continue;
        }

        // --- SÉRIES TV ---
        const upcoming = getUpcomingEpisodeInfo(s);
        if (!upcoming || !upcoming.air_date) continue;

        const sNum = String(upcoming.season_number).padStart(2, '0');
        const eNum = String(upcoming.episode_number).padStart(2, '0');

        const isSpecificReminder = readUserScopedJson(uid, `reminder_${s.id}_S${upcoming.season_number}E${upcoming.episode_number}`, false);
        if (!isSpecificReminder && !isShowNotification && s.notificationsEnabled === false) {
          await prunePendingMediaReminderNotifications(s.id, 'tv', []);
          continue;
        }

        const [year, month, day] = upcoming.air_date.split('-').map(Number);
        if (!year || !month || !day) continue;

        const airDate9Am = new Date(year, month - 1, day, 9, 0, 0, 0);
        const d7Date9Am = new Date(airDate9Am);
        d7Date9Am.setDate(d7Date9Am.getDate() - 7);

        const episodeStill = upcoming.still_path || s.nextEpisodeToAir?.still_path || s.nextEpisodeToWatch?.still_path;
        const tvImageUrl = episodeStill
          ? (episodeStill.startsWith('http') ? episodeStill : `https://image.tmdb.org/t/p/w500${episodeStill}`)
          : imageUrl;

        const tvPayload = {
          badge: 'https://seenit.app/icon-192.png',
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

        const buildTvTag = (tagPrefix: string, targetStr: string) => (
          `notif_${s.id}_${tagPrefix}_S${sNum}E${eNum}_${targetStr}`
        );

        const allowedPendingTvIds: number[] = [];
        const rememberFutureTvId = (targetDate: Date, tagPrefix: string, enabled: boolean) => {
          if (!enabled || targetDate.getTime() <= now.getTime()) return;
          const targetStr = toLocalDateKey(targetDate);
          allowedPendingTvIds.push(getMediaReminderNotificationId(buildTvTag(tagPrefix, targetStr)));
        };
        rememberFutureTvId(
          d7Date9Am,
          'd7',
          Boolean(userPrefs.season_d7 && upcoming.episode_number === 1),
        );
        rememberFutureTvId(
          airDate9Am,
          'today',
          Boolean(userPrefs.release_today_tv || isSpecificReminder),
        );
        await prunePendingMediaReminderNotifications(s.id, 'tv', allowedPendingTvIds);

        const scheduleTvAlert = async (
          targetDate: Date,
          tagPrefix: string,
          notificationTitle: string,
          summaryText: string,
          msgBody: string,
          addActions: boolean = false
        ) => {
          const targetStr = toLocalDateKey(targetDate);
          const notificationTag = buildTvTag(tagPrefix, targetStr);
          const fullPayload = {
            ...tvPayload,
            body: msgBody,
            tag: notificationTag
          };

          const send = async (scheduleDate?: Date) => {
            const mediaVisual = await resolveNotificationMediaVisual(iconUrl, tvImageUrl);
            return sendMediaReminderNotification(notificationTitle, {
              ...fullPayload,
              ...mediaVisual,
              summaryText,
              allowMarkWatched: addActions,
              scheduleDate
            } as any);
          };

          if (targetDate.getTime() > now.getTime()) {
            const scheduleKey = `scheduled_9am_${REMINDER_SCHEDULE_SCHEMA}_${s.id}_${tagPrefix}_S${sNum}E${eNum}_${targetStr}`;
            if (!readUserScopedJson(uid, scheduleKey, false)) {
              await cancelMediaReminderNotificationByTag(notificationTag);
              if (await send(targetDate)) writeUserScopedJson(uid, scheduleKey, true);
            }
          } else if (targetStr === todayStr) {
            const notifiedKey = `notified_today_${s.id}_${tagPrefix}_S${sNum}E${eNum}_${todayStr}`;
            if (!readUserScopedJson(uid, notifiedKey, false)) {
              showToast(`🎉 ${msgBody}`, 'info', s);
              if (await send()) writeUserScopedJson(uid, notifiedKey, true);
            }
          }
        };

        if (userPrefs.season_d7 && upcoming.episode_number === 1) {
          await scheduleTvAlert(
            d7Date9Am,
            'd7',
            title,
            '📅 Nouvelle saison',
            `Saison ${upcoming.season_number} dans 7 jours.`
          );
        }

        if (userPrefs.release_today_tv || isSpecificReminder) {
          await scheduleTvAlert(
            airDate9Am,
            'today',
            title,
            '🆕 Nouvel épisode',
            `S${sNum}E${eNum}${upcoming.name ? ` · ${upcoming.name}` : ''} disponible aujourd'hui.`,
            true
          );
        }
      }
    };
    processReminders().catch(err => console.warn('Reminder scheduling error:', err));
  }, [shows, showToast]);
}
