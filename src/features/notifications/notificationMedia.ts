import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';

const NOTIFICATION_MEDIA_DIR = 'notification-media';
const SEENIT_DATA_SCHEME = 'seenit-data://';
const NATIVE_IMAGE_CONNECT_TIMEOUT_MS = 2_500;
const NATIVE_IMAGE_READ_TIMEOUT_MS = 2_500;
const MAX_NATIVE_IMAGE_FILE_BYTES = 512 * 1024;
const NATIVE_IMAGE_DOWNLOAD_ATTEMPTS = 3;
const NATIVE_IMAGE_RETRY_DELAYS_MS = [300, 1_000] as const;
const ALLOWED_NATIVE_IMAGE_HOSTS = new Set(['image.tmdb.org', 'seenit.app']);

interface NotificationMediaFilesystem {
  mkdir(options: any): Promise<any>;
  stat(options: any): Promise<{ type?: string; size?: number }>;
  deleteFile(options: any): Promise<any>;
  downloadFile(options: any): Promise<any>;
}

export interface NotificationMediaDependencies {
  isNativePlatform: () => boolean;
  filesystem: NotificationMediaFilesystem;
  sleep: (ms: number) => Promise<void>;
}

const defaultDependencies: NotificationMediaDependencies = {
  isNativePlatform: () => Capacitor.isNativePlatform(),
  filesystem: Filesystem,
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
};

const directoryReadyByFilesystem = new WeakMap<object, Promise<void>>();
const downloadsInFlightByFilesystem = new WeakMap<object, Map<string, Promise<string | undefined>>>();

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

export function notificationMediaPrivateRef(url: string): string {
  return `${SEENIT_DATA_SCHEME}${notificationMediaCachePath(url)}`;
}

type NativeNotificationImageSize = 'w342' | 'w500';

/**
 * Les données suivies peuvent contenir soit un chemin TMDB brut, soit une URL
 * TMDB déjà matérialisée par une ancienne synchro/Plex (w500, w1280, original).
 * Le cache notification applique son propre budget : toute image TMDB est donc
 * ramenée à la taille requise avant de calculer la clé locale ou de télécharger.
 */
export function normalizeNativeNotificationImageUrl(
  url: string | undefined,
  size: NativeNotificationImageSize,
): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('/')) return `https://image.tmdb.org/t/p/${size}${url}`;

  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'image.tmdb.org') return url;
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return url;

    const imagePath = parsed.pathname.match(/^\/t\/p\/[^/]+(\/.+)$/)?.[1];
    if (!imagePath) return url;

    parsed.protocol = 'https:';
    parsed.pathname = `/t/p/${size}${imagePath}`;
    return parsed.toString();
  } catch {
    return url;
  }
}

function dependencyKey(dependencies: NotificationMediaDependencies): object {
  return dependencies.filesystem as unknown as object;
}

async function ensureNotificationMediaDirectory(dependencies: NotificationMediaDependencies): Promise<void> {
  const key = dependencyKey(dependencies);
  let ready = directoryReadyByFilesystem.get(key);
  if (!ready) {
    ready = dependencies.filesystem.mkdir({
      path: NOTIFICATION_MEDIA_DIR,
      directory: Directory.Data,
      recursive: true
    }).then(() => undefined).catch(error => {
      directoryReadyByFilesystem.delete(key);
      throw error;
    });
    directoryReadyByFilesystem.set(key, ready);
  }
  await ready;
}

async function hasUsableCachedImage(
  path: string,
  dependencies: NotificationMediaDependencies,
): Promise<boolean> {
  try {
    const stat = await dependencies.filesystem.stat({ path, directory: Directory.Data });
    return stat.type === 'file'
      && typeof stat.size === 'number'
      && stat.size > 0
      && stat.size <= MAX_NATIVE_IMAGE_FILE_BYTES;
  } catch {
    return false;
  }
}

function getDownloadsInFlight(dependencies: NotificationMediaDependencies): Map<string, Promise<string | undefined>> {
  const key = dependencyKey(dependencies);
  let map = downloadsInFlightByFilesystem.get(key);
  if (!map) {
    map = new Map();
    downloadsInFlightByFilesystem.set(key, map);
  }
  return map;
}

async function downloadNotificationImageWithRetries(
  url: string,
  path: string,
  dependencies: NotificationMediaDependencies,
): Promise<string | undefined> {
  await ensureNotificationMediaDirectory(dependencies);
  let lastError: unknown;

  for (let attempt = 0; attempt < NATIVE_IMAGE_DOWNLOAD_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await dependencies.sleep(NATIVE_IMAGE_RETRY_DELAYS_MS[attempt - 1] ?? 0);
    }

    try {
      await dependencies.filesystem.deleteFile({ path, directory: Directory.Data }).catch(() => undefined);
      await dependencies.filesystem.downloadFile({
        url,
        path,
        directory: Directory.Data,
        recursive: true,
        progress: false,
        connectTimeout: NATIVE_IMAGE_CONNECT_TIMEOUT_MS,
        readTimeout: NATIVE_IMAGE_READ_TIMEOUT_MS
      });

      if (await hasUsableCachedImage(path, dependencies)) {
        return notificationMediaPrivateRef(url);
      }

      await dependencies.filesystem.deleteFile({ path, directory: Directory.Data }).catch(() => undefined);
      lastError = new Error('NOTIFICATION_MEDIA_INVALID_DOWNLOAD');
    } catch (error) {
      lastError = error;
      await dependencies.filesystem.deleteFile({ path, directory: Directory.Data }).catch(() => undefined);
    }
  }

  if (lastError) throw lastError;
  return undefined;
}

async function cacheNativeNotificationImage(
  url: string,
  dependencies: NotificationMediaDependencies,
): Promise<string | undefined> {
  if (!isAllowedNativeNotificationImageUrl(url)) return undefined;

  const path = notificationMediaCachePath(url);
  // Directory.Data est persistant : une image déjà matérialisée est réutilisée
  // telle quelle, sans nouvel appel réseau ni refetch de métadonnées TMDB.
  if (await hasUsableCachedImage(path, dependencies)) {
    return notificationMediaPrivateRef(url);
  }

  const inFlight = getDownloadsInFlight(dependencies);
  const existing = inFlight.get(path);
  if (existing) return existing;

  const request = downloadNotificationImageWithRetries(url, path, dependencies);
  inFlight.set(path, request);
  try {
    return await request;
  } finally {
    if (inFlight.get(path) === request) inFlight.delete(path);
  }
}

async function cacheNativeNotificationImageSafely(
  url: string | undefined,
  dependencies: NotificationMediaDependencies,
): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    return await cacheNativeNotificationImage(url, dependencies);
  } catch (error) {
    console.warn('Notification media cache failed after bounded retries; keeping notification without this visual:', error);
    return undefined;
  }
}

/**
 * Prépare les visuels d'une notification sans jamais transporter les octets de
 * l'image dans le pont Capacitor. Sur Android, les fichiers sont téléchargés
 * une seule fois dans Directory.Data puis réutilisés par URI privée stable.
 * Un cache miss est retenté de façon bornée et les demandes concurrentes pour
 * la même image sont coalescées. Sur le Web, les URL restent directement
 * exploitables par l'API Notification/service worker.
 */
export async function resolveNotificationMediaVisual(
  nativePosterUrl?: string,
  richImageUrl?: string,
  dependencyOverrides: Partial<NotificationMediaDependencies> = {},
): Promise<NotificationMediaVisual> {
  const dependencies: NotificationMediaDependencies = {
    ...defaultDependencies,
    ...dependencyOverrides,
  };

  if (!dependencies.isNativePlatform()) {
    return {
      icon: nativePosterUrl,
      image: richImageUrl || nativePosterUrl
    };
  }

  const boundedPosterUrl = normalizeNativeNotificationImageUrl(nativePosterUrl, 'w342');
  const boundedRichImageUrl = richImageUrl && richImageUrl !== nativePosterUrl
    ? normalizeNativeNotificationImageUrl(richImageUrl, 'w500')
    : undefined;

  const [localPoster, localRichImage] = await Promise.all([
    cacheNativeNotificationImageSafely(boundedPosterUrl, dependencies),
    cacheNativeNotificationImageSafely(boundedRichImageUrl, dependencies)
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
