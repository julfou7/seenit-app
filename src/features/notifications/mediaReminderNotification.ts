import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import {
  auth,
  generateNotificationNumericId,
  sendNativeNotification,
  type NativeNotificationOptions,
} from '../../lib/firebase';
import { resolveMediaReminderSchedule } from './mediaReminderSchedule';
import { isObsoleteMediaAlert } from './notificationLifecycle.ts';
import type { Show } from '../../types.ts';
import { recordClientOperationalSignal } from '../logging/clientOperationalDiagnostics.ts';
import {
  ensureSeenItNotificationChannels,
  SEENIT_NOTIFICATION_CHANNELS,
} from './notificationChannels.ts';

const localConsole = globalThis.console;

type PendingMediaNotification = {
  id: number;
  extra?: Record<string, unknown>;
};

type LocalScheduleNotification = Parameters<typeof LocalNotifications.schedule>[0]['notifications'][number] & {
  subText?: string;
};

export interface MediaReminderNotificationOptions extends NativeNotificationOptions {
  /** Libellé historique conservé côté appelants ; il devient le subText Android. */
  summaryText: string;
  /** Texte développé distinct du fait compact. */
  detailText?: string;
  channelId?: string;
  allowMarkWatched?: boolean;
  silent?: boolean;
  actionTitle?: string;
  allowTonight?: boolean;
  provider?: { id: number; name: string };
  reminderPurpose?: 'tonight';
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

function resolveChannelId(options: MediaReminderNotificationOptions): string {
  if (options.channelId) return options.channelId;
  return options.mediaType === 'movie'
    ? SEENIT_NOTIFICATION_CHANNELS.movies
    : SEENIT_NOTIFICATION_CHANNELS.episodes;
}

export async function cancelMediaReminderNotificationByTag(tag: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await LocalNotifications.cancel({
      notifications: [{ id: getMediaReminderNotificationId(tag) }],
    });
  } catch (error) {
    localConsole.warn('Media reminder native cancellation failed safely:', error);
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
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const allowed = new Set(allowedNotificationIds);
    const pending = await LocalNotifications.getPending();
    const pendingNotifications = pending.notifications as PendingMediaNotification[];
    const notifications = pendingNotifications
      .filter(notification => (
        notification.extra?.ownerUid === uid
        && notification.extra?.reminderPurpose !== 'tonight'
        && String(notification.extra?.showId ?? '') === String(showId)
        && String(notification.extra?.mediaType ?? 'tv') === mediaType
        && !allowed.has(Number(notification.id))
      ))
      .map(notification => ({ id: Number(notification.id) }))
      .filter(notification => Number.isInteger(notification.id));

    if (notifications.length > 0) {
      await LocalNotifications.cancel({ notifications });
    }
  } catch (error) {
    localConsole.warn('Media reminder native pruning failed safely:', error);
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
  const ownerUid = auth.currentUser?.uid;
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

    await ensureSeenItNotificationChannels();

    const resolvedId = resolveNotificationId(options);
    if (options.allowMarkWatched || options.allowTonight || options.provider) {
      await LocalNotifications.registerActionTypes({
        types: [{
          id: `EPISODE_NOTIF_ACTIONS_${resolvedId}`,
          actions: [
            ...(options.allowMarkWatched ? [{ id: 'mark_watched', title: options.actionTitle || '✓ Vu', foreground: true }] : []),
            ...(options.provider ? [{ id: 'open_provider', title: `Ouvrir ${options.provider.name}`, foreground: true }] : []),
            ...(options.allowTonight ? [{ id: 'remind_tonight', title: 'Ce soir', foreground: true }] : []),
          ],
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
    const schedule = resolveMediaReminderSchedule(options.scheduleDate);
    const detailText = options.detailText?.trim();

    if (ownerUid && auth.currentUser?.uid !== ownerUid) return false;

    const notification: LocalScheduleNotification = {
      title,
      body: options.body || '',
      largeBody: detailText || options.body || '',
      // BigPicture utilise encore summaryText pour le texte développé ; le type
      // passe désormais exclusivement par subText.
      summaryText: attachments && detailText ? detailText : undefined,
      subText: options.summaryText,
      id: resolvedId,
      ...(schedule ? { schedule } : {}),
      channelId: resolveChannelId(options),
      smallIcon: 'ic_stat_seenit',
      iconColor: '#E5A93D',
      largeIcon: iconUrl || undefined,
      attachments,
      actionTypeId: options.allowMarkWatched || options.allowTonight || options.provider ? `EPISODE_NOTIF_ACTIONS_${resolvedId}` : undefined,
      group: 'seenit',
      extra: {
        ownerUid,
        notificationScope: 'media',
        silent: options.silent === true,
        reminderPurpose: options.reminderPurpose,
        providerId: options.provider?.id,
        providerName: options.provider?.name,
        releasedSeason: extraData.releasedSeason,
        releasedEpisode: extraData.releasedEpisode,
        releasedName: extraData.releasedName,
        releasedDate: extraData.releasedDate,
        showId: extraData.showId,
        tmdbId: extraData.tmdbId,
        mediaType: extraData.mediaType || 'tv',
        season: extraData.season,
        episode: extraData.episode,
        url: extraData.url,
      },
    };

    await LocalNotifications.schedule({ notifications: [notification] });
    return true;
  } catch (error) {
    recordClientOperationalSignal('NOTIFICATION_CLIENT_FAILED');
    localConsole.warn('Media reminder native schedule failed; notification skipped safely:', error);
    return false;
  }
}

/** Retire les alertes vues/archivées sans toucher aux téléchargements ni aux autres UID. */
export async function reconcileDeliveredMediaAlerts(uid: string, shows: readonly Show[]): Promise<void> {
  if (!Capacitor.isNativePlatform() || auth.currentUser?.uid !== uid) return;
  try {
    const delivered = await LocalNotifications.getDeliveredNotifications();
    if (auth.currentUser?.uid !== uid) return;
    const obsolete = delivered.notifications.filter(item => isObsoleteMediaAlert(item, uid, shows));
    if (obsolete.length) await LocalNotifications.removeDeliveredNotifications({ notifications: obsolete });
    const pending = await LocalNotifications.getPending();
    if (auth.currentUser?.uid !== uid) return;
    const staleReminders = pending.notifications.filter(item => item.extra?.reminderPurpose === 'tonight' && isObsoleteMediaAlert(item, uid, shows));
    if (staleReminders.length) await LocalNotifications.cancel({ notifications: staleReminders.map(item => ({ id: item.id })) });
  } catch { /* Un panneau indisponible ne bloque pas le planificateur. */ }
}
