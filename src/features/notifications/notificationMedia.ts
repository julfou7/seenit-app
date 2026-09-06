import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';

const NOTIFICATION_MEDIA_DIR = 'notification-media';
const NATIVE_IMAGE_CONNECT_TIMEOUT_MS = 2_500;
const NATIVE_IMAGE_READ_TIMEOUT_MS = 2_500;
const MAX_NATIVE_IMAGE_FILE_BYTES = 512 * 1024;
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

async function hasUsableCachedImage(path: string): Promise<boolean> {
  try {
    const stat = await Filesystem.stat({ path, directory: Directory.Data });
    return stat.type === 'file' && stat.size > 0 && stat.size <= MAX_NATIVE_IMAGE_FILE_BYTES;
  } catch {
    return false;
  }
}

async function cacheNativeNotificationImage(url: string): Promise<string | undefined> {
  if (!isAllowedNativeNotificationImageUrl(url)) return undefined;

  const path = notificationMediaCachePath(url);
  if (!(await hasUsableCachedImage(path))) {
    await Filesystem.deleteFile({ path, directory: Directory.Data }).catch(() => undefined);
    await Filesystem.downloadFile({
      url,
      path,
      directory: Directory.Data,
      recursive: true,
      progress: false,
      connectTimeout: NATIVE_IMAGE_CONNECT_TIMEOUT_MS,
      readTimeout: NATIVE_IMAGE_READ_TIMEOUT_MS
    });

    if (!(await hasUsableCachedImage(path))) {
      await Filesystem.deleteFile({ path, directory: Directory.Data }).catch(() => undefined);
      return undefined;
    }
  }

  const result = await Filesystem.getUri({ path, directory: Directory.Data });
  return result.uri || undefined;
}

async function cacheNativeNotificationImageSafely(url?: string): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    return await cacheNativeNotificationImage(url);
  } catch (error) {
    console.warn('Notification media cache failed; keeping notification without this visual:', error);
    return undefined;
  }
}

/**
 * Prépare les visuels d'une notification sans jamais transporter les octets de
 * l'image dans le pont Capacitor. Sur Android, l'affiche compacte et l'image
 * riche sont téléchargées séparément dans Directory.Data et seuls leurs URI
 * locaux courts sont remis à LocalNotifications. Chaque téléchargement reste
 * indépendant : la panne du backdrop/still conserve l'affiche, et la panne de
 * l'affiche peut encore conserver l'image riche. Sur le Web, les URL restent
 * directement exploitables par l'API Notification/service worker.
 */
export async function resolveNotificationMediaVisual(
  nativePosterUrl?: string,
  richImageUrl?: string
): Promise<NotificationMediaVisual> {
  if (!Capacitor.isNativePlatform()) {
    return {
      icon: nativePosterUrl,
      image: richImageUrl || nativePosterUrl
    };
  }

  const richCandidate = richImageUrl && richImageUrl !== nativePosterUrl ? richImageUrl : undefined;
  const [localPoster, localRichImage] = await Promise.all([
    cacheNativeNotificationImageSafely(nativePosterUrl),
    cacheNativeNotificationImageSafely(richCandidate)
  ]);

  if (!localPoster && !localRichImage) {
    console.warn('Notification media unavailable; using text-only notification');
    return {};
  }

  return {
    icon: localPoster || localRichImage,
    image: localRichImage || localPoster
  };
}
