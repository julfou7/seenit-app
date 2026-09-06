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

function resolveNotificationId(options: MediaReminderNotificationOptions): number {
  if (options.notificationId !== undefined) return options.notificationId;
  if (options.tag) return generateNotificationNumericId(options.tag);
  if (options.showId && options.season !== undefined && options.episode !== undefined) {
    return generateNotificationNumericId(`ep_${options.showId}_S${options.season}E${options.episode}`);
  }
  return Math.floor(Math.random() * 1_000_000);
}

/**
 * Programme un rappel média Android sans faire transiter d'octets d'image dans
 * le pont Capacitor. L'affiche locale sert de largeIcon ; une seconde URI locale
 * distincte est transmise comme attachment SeenIt et le patch natif la rend en
 * BigPictureStyle après décodage borné. La PWA conserve le chemin générique.
 */
export async function sendMediaReminderNotification(
  title: string,
  options: MediaReminderNotificationOptions
): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    await sendNativeNotification(title, options);
    return;
  }

  try {
    const permission = await LocalNotifications.checkPermissions();
    if (permission.display !== 'granted') {
      const requested = await LocalNotifications.requestPermissions();
      if (requested.display !== 'granted') return;
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
    const attachments = imageUrl && imageUrl !== iconUrl
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
  } catch (error) {
    console.warn('Media reminder native schedule failed; notification skipped safely:', error);
  }
}
