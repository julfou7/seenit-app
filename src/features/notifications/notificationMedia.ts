import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';

const NOTIFICATION_MEDIA_DIR = 'notification-media';
const NATIVE_IMAGE_TIMEOUT_MS = 4_500;
const ALLOWED_NATIVE_IMAGE_HOSTS = new Set(['image.tmdb.org', 'seenit.app']);

export interface NotificationMediaVisual {
  icon?: string;
  image?: string;
}

export function isAllowedNativeNotificationImageUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ALLOWED_NATIVE_IMAGE_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export function notificationMediaCachePath(url: string): string {
  let hash = 2166136261;
  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${NOTIFICATION_MEDIA_DIR}/${(hash >>> 0).toString(16)}.img`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('notification image timeout')), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function cacheNativeNotificationImage(url: string): Promise<string | undefined> {
  if (!isAllowedNativeNotificationImageUrl(url)) return undefined;

  const path = notificationMediaCachePath(url);
  let exists = false;
  try {
    await Filesystem.stat({ path, directory: Directory.Data });
    exists = true;
  } catch {
    exists = false;
  }

  if (!exists) {
    await withTimeout(
      Filesystem.downloadFile({
        url,
        path,
        directory: Directory.Data,
        recursive: true,
        progress: false
      }),
      NATIVE_IMAGE_TIMEOUT_MS
    );
  }

  const result = await Filesystem.getUri({ path, directory: Directory.Data });
  return result.uri || undefined;
}

/**
 * Prépare le visuel d'une notification sans jamais transporter les octets de
 * l'image dans le pont Capacitor. Sur Android, seul un chemin local court est
 * remis à LocalNotifications ; le fichier est téléchargé nativement depuis une
 * URL HTTPS bornée (poster TMDB w154 côté appelant). Sur le Web, les URL restent
 * directement exploitables par l'API Notification/service worker.
 */
export async function resolveNotificationMediaVisual(
  nativePosterUrl?: string,
  webImageUrl?: string
): Promise<NotificationMediaVisual> {
  if (!Capacitor.isNativePlatform()) {
    return {
      icon: nativePosterUrl,
      image: webImageUrl || nativePosterUrl
    };
  }

  if (!nativePosterUrl) return {};

  try {
    const localUri = await cacheNativeNotificationImage(nativePosterUrl);
    if (!localUri) return {};
    return { icon: localUri, image: localUri };
  } catch (error) {
    console.warn('Notification media cache failed; using text-only notification:', error);
    return {};
  }
}
