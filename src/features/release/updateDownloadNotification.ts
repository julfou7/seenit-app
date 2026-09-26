import { Capacitor } from '@capacitor/core';
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
    title: 'Mise à jour téléchargée ✅',
    body: `SeenIt ${version} est vérifiée. Ouverture de l’installeur Android…`
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

    const presentation = getVerifiedUpdateDownloadNotification(version);
    await LocalNotifications.schedule({
      notifications: [{
        ...presentation,
        smallIcon: 'ic_stat_seenit',
        iconColor: '#E5A93D',
        summaryText: 'Mise à jour SeenIt',
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
