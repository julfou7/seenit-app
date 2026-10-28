import { Capacitor } from '@capacitor/core';
import { ensureSeenItNotificationChannels } from '../notifications/notificationChannels.ts';
import { PushNotifications } from '@capacitor/push-notifications';
import { LocalNotifications } from '@capacitor/local-notifications';

function stableNotificationId(version: string): number {
  let hash = 17;
  for (const character of version) {
    hash = ((hash * 31) + character.charCodeAt(0)) | 0;
  }
  return 1_600_000_000 + (Math.abs(hash) % 300_000_000);
}

export function getVerifiedUpdateDownloadNotification(version: string) {
  return {
    id: stableNotificationId(version),
    title: `SeenIt ${version}`,
    body: 'Vérifiée · installation en cours'
  };
}

export async function notifyVerifiedUpdateDownload(version: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    let permission = await LocalNotifications.checkPermissions();
    if (permission.display !== 'granted') {
      permission = await LocalNotifications.requestPermissions();
    }
    if (permission.display !== 'granted') return;

    await ensureSeenItNotificationChannels();
    try {
      const delivered = await PushNotifications.getDeliveredNotifications();
      const sameVersion = delivered.notifications.filter(item => item.data?.type === 'APP_UPDATE_AVAILABLE' && item.data?.version === version);
      if (sameVersion.length) await PushNotifications.removeDeliveredNotifications({ notifications: sameVersion });
    } catch { /* Le reçu vérifié reste indépendant du nettoyage des anciennes alertes. */ }
    const presentation = getVerifiedUpdateDownloadNotification(version);
    await LocalNotifications.schedule({
      notifications: [{
        ...presentation,
        smallIcon: 'ic_stat_seenit',
        iconColor: '#E5A93D',
        channelId: 'seenit_app',
        subText: 'Mise à jour',
        extra: {
          type: 'APP_UPDATE_DOWNLOADED',
          version
        }
      }]
    });
  } catch {
    // Le feedback de notification ne doit jamais bloquer l’installation d’une APK déjà vérifiée.
  }
}
