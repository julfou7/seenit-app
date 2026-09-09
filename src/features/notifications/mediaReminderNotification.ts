import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import {
  generateNotificationNumericId,
  sendNativeNotification,
  type NativeNotificationOptions,
} from '../../lib/firebase';

export interface MediaReminderNotificationOptions extends NativeNotificationOptions {
  summaryText: string;
  allowMarkWatched?: boolean;
}

export function getMediaReminderNotificationId(tag: string): number {
  return generateNotificationNumericId(tag);
}

function resolveNotificationId(options: MediaReminderNotificationOptions): number {
  if (options.notificationId !== undefined) return options.notificationId;
  if (options.tag) return getMediaReminderNotificationId(options.tag);
  if (options.showId && options.season !== undefined && options.episode !== undefined) {
    return generateNotificationNumericId(`ep_${options.showId}_S${options.season}E${options.episode}`);
  }
  return Math.floor(Math.random() * 1_000_000);
}

export async function cancelMediaReminderNotificationByTag(tag: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await LocalNotifications.cancel({
      notifications: [{ id: getMediaReminderNotificationId(tag) }],
    });
  } catch (error) {
    console.warn('Media reminder native cancellation failed safely:', error);
  }
}

/**
 * Supprime les anciens rappels locaux du même média qui ne correspondent plus
 * aux identifiants autorisés par les dates canoniques courantes. Cela permet de
 * retirer notamment les alarmes film historiques calculées avec une estimation
 * et les payloads planifiés avant une évolution du contrat de notification.
 */
export async function prunePendingMediaReminderNotifications(
  showId: string | number,
  mediaType: 'tv' | 'movie',
  allowedNotificationIds: Iterable<number> = [],
): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const allowed = new Set(allowedNotificationIds);
    const pending = await LocalNotifications.getPending();
    const notifications = (pending.notifications || [])
      .filter((notification: any) => (
        String(notification?.extra?.showId ?? '') === String(showId)
        && String(notification?.extra?.mediaType ?? 'tv') === mediaType
        && !allowed.has(Number(notification?.id))
      ))
      .map((notification: any) => ({ id: Number(notification.id) }))
      .filter(notification => Number.isInteger(notification.id));

    if (notifications.length > 0) {
      await LocalNotifications.cancel({ notifications });
    }
  } catch (error) {
    console.warn('Media reminder native pruning failed safely:', error);
  }
}

/**
 * Programme un rappel média Android sans faire transiter d'octets d'image dans
 * le pont Capacitor. L'affiche locale sert de largeIcon ; l'URI locale du visuel
 * disponible est aussi transmise comme attachment SeenIt afin que le poster de
 * fallback puisse lui aussi être rendu en BigPictureStyle. Le patch natif garde
 * un décodage borné et la PWA conserve le chemin générique.
 */
export async function sendMediaReminderNotification(
  title: string,
  options: MediaReminderNotificationOptions
): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    await sendNativeNotification(title, options);
    return true;
  }

  try {
    const permission = await LocalNotifications.checkPermissions();
    if (permission.display !== 'granted') {
      const requested = await LocalNotifications.requestPermissions();
      if (requested.display !== 'granted') return false;
    }

    if (options.allowMarkWatched) {
      await LocalNotifications.registerActionTypes({
        types: [{
          id: 'EPISODE_NOTIF_ACTIONS',
          actions: [{
            id: 'mark_watched',
            title: '✓ Marquer comme vu',
            foreground: true,
          }],
        }],
      }).catch(() => undefined);
    }

    const imageUrl = options.image;
    const iconUrl = options.icon;
    // imageUrl peut volontairement être le même fichier local que largeIcon :
    // dans ce cas il constitue le poster de fallback du BigPicture natif.
    const attachments = imageUrl
      ? [{ id: 'seenit-media', url: imageUrl }]
      : undefined;
    const extraData = options.data || {
      showId: options.showId,
      tmdbId: options.tmdbId,
      mediaType: options.mediaType,
      season: options.season,
      episode: options.episode,
    };
    const targetDate = options.scheduleDate && options.scheduleDate.getTime() > Date.now()
      ? options.scheduleDate
      : new Date(Date.now() + 100);

    await LocalNotifications.schedule({
      notifications: [{
        title,
        body: options.body || '',
        largeBody: options.body || '',
        summaryText: options.summaryText,
        id: resolveNotificationId(options),
        schedule: {
          at: targetDate,
          allowWhileIdle: true,
        },
        smallIcon: 'ic_stat_seenit',
        iconColor: '#E5A93D',
        largeIcon: iconUrl || undefined,
        attachments,
        actionTypeId: options.allowMarkWatched ? 'EPISODE_NOTIF_ACTIONS' : undefined,
        extra: {
          showId: extraData.showId,
          tmdbId: extraData.tmdbId,
          mediaType: extraData.mediaType || 'tv',
          season: extraData.season,
          episode: extraData.episode,
          url: extraData.url,
        },
      }],
    });
    return true;
  } catch (error) {
    console.warn('Media reminder native schedule failed; notification skipped safely:', error);
    return false;
  }
}
