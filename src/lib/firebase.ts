import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, persistentSingleTabManager } from 'firebase/firestore';
import { deleteToken, getMessaging, getToken, isSupported, type Messaging } from 'firebase/messaging';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';
import { useLogStore } from '../store/logStore';
import firebaseConfig from '../../firebase-applet-config.json';
import { resolveSeenItApiUrl } from './seenitApi';

const app = initializeApp(firebaseConfig);

// Standard Firebase Auth automatically handles robust persistence (IndexedDB, localStorage) on Capacitor
export const auth = getAuth(app);

export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.setCustomParameters({
  prompt: 'select_account'
});

const isNative = Capacitor.isNativePlatform();

export const FIRESTORE_DATABASE_ID = 'default';

export const db = initializeFirestore(
  app,
  { 
    localCache: isNative 
      ? persistentLocalCache({ tabManager: persistentSingleTabManager({}) }) 
      : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    experimentalForceLongPolling: isNative
  },
  FIRESTORE_DATABASE_ID
);

// Log diagnostic for Firestore initialization
try {
  const cacheType = isNative ? 'PERSISTANT (Mono-onglet natif)' : 'PERSISTANT (Multi-onglets PWA)';
  setTimeout(() => {
    useLogStore.getState().addLog(`[Système] Firestore initialisé avec cache ${cacheType} sur base 'default'`, 'info');
  }, 1000);
} catch (e) {}

export let messaging: Messaging | null = null;

if (typeof window !== 'undefined' && 'Notification' in window) {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/firebase-messaging-sw.js').then((reg) => {
      reg.update().catch(() => {});
    }).catch((swErr) => {
      console.warn('Could not auto-register firebase-messaging-sw.js:', swErr);
    });
  }

  isSupported().then((supported) => {
    if (supported) {
      try {
        messaging = getMessaging(app);
      } catch (e) {
        console.warn('FCM messaging init warning:', e);
      }
    }
  }).catch((err) => {
    console.warn('FCM isSupported check failed:', err);
  });
}

async function fetchImageAsDataUrl(url?: string): Promise<string | undefined> {
  if (!url || typeof window === 'undefined') return undefined;
  if (url.startsWith('data:')) return url;
  
  const fullUrl = normalizeImageUrl(url);
  if (!fullUrl) return undefined;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(fullUrl, { signal: controller.signal });
    clearTimeout(timer);
    
    if (!res.ok) return undefined;
    const blob = await res.blob();
    
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve(reader.result as string);
      };
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.warn('fetchImageAsDataUrl error for:', fullUrl, err);
    return undefined;
  }
}

// Register native notification click action listener on Capacitor Native platform
if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
  try {
    LocalNotifications.addListener('localNotificationActionPerformed', (notificationAction) => {
      const extra = notificationAction.notification?.extra || {};
      const payload = {
        type: notificationAction.actionId === 'mark_watched' ? 'QUICK_ACTION_MARK_WATCHED' : 'NAVIGATE_SHOW',
        showId: extra.showId,
        tmdbId: extra.tmdbId,
        mediaType: extra.mediaType || 'tv',
        season: extra.season,
        episode: extra.episode,
        url: extra.url
      };
      window.dispatchEvent(new CustomEvent('capacitor-notification-action', { detail: payload }));
    });
    PushNotifications.addListener('pushNotificationActionPerformed', action => {
      const data = action.notification?.data || {};
      window.dispatchEvent(new CustomEvent('capacitor-notification-action', {
        detail: { ...data, type: data.type || 'DOWNLOAD_EVENT' }
      }));
    });
  } catch (err) {
    console.warn('LocalNotifications listener setup warning:', err);
  }
}

function normalizeImageUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/')) {
    const origin = window.location.origin.includes('localhost') ? 'https://seenit.app' : window.location.origin;
    return origin + url;
  }
  return url;
}

export interface NativeNotificationOptions extends NotificationOptions {
  image?: string;
  icon?: string;
  badge?: string;
  data?: any;
  showId?: string | number;
  tmdbId?: number;
  mediaType?: string;
  season?: number;
  episode?: number;
  scheduleDate?: Date;
  notificationId?: number;
}

export function generateNotificationNumericId(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash) % 2000000000;
}

export async function cancelScheduledNotification(id: number) {
  if (Capacitor.isNativePlatform()) {
    try {
      await LocalNotifications.cancel({ notifications: [{ id }] });
    } catch (err) {
      console.warn('cancelScheduledNotification error:', err);
    }
  }
}

export async function sendNativeNotification(title: string, options?: NativeNotificationOptions) {
  const iconUrl = options?.icon || (options as any)?.image || 'https://seenit.app/icon-192.png';
  const imageUrl = (options as any)?.image || options?.icon;
  const extraData = (options as any)?.data || {
    showId: options?.showId,
    tmdbId: options?.tmdbId,
    mediaType: options?.mediaType,
    season: options?.season,
    episode: options?.episode
  };

  const notificationId = options?.notificationId ?? (
    options?.tag 
      ? generateNotificationNumericId(options.tag)
      : (options?.showId && options?.season !== undefined && options?.episode !== undefined
          ? generateNotificationNumericId(`ep_${options.showId}_S${options.season}E${options.episode}`)
          : Math.floor(Math.random() * 1000000))
  );

  const targetDate = options?.scheduleDate && options.scheduleDate.getTime() > Date.now()
    ? options.scheduleDate
    : new Date(Date.now() + 100);

  // On Native Capacitor Android App, use LocalNotifications plugin
  if (Capacitor.isNativePlatform()) {
    try {
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display !== 'granted') {
        const req = await LocalNotifications.requestPermissions();
        if (req.display !== 'granted') return;
      }

      const attachments: any[] = [];
      if (imageUrl) {
        attachments.push({ id: 'photo', url: imageUrl });
      }

      // Register action types for notification buttons
      try {
        await LocalNotifications.registerActionTypes({
          types: [
            {
              id: 'EPISODE_NOTIF_ACTIONS',
              actions: [
                {
                  id: 'mark_watched',
                  title: '✓ Marquer comme vu',
                  foreground: true
                }
              ]
            }
          ]
        });
      } catch (e) {}

      await LocalNotifications.schedule({
        notifications: [{
          title: title,
          body: options?.body || '',
          largeBody: options?.body || '',
          summaryText: 'Nouvel épisode',
          id: notificationId,
          schedule: { 
            at: targetDate,
            allowWhileIdle: true
          },
          smallIcon: 'ic_stat_seenit',
          iconColor: '#E5A93D',
          largeIcon: imageUrl || undefined,
          attachments: attachments.length > 0 ? attachments : undefined,
          actionTypeId: 'EPISODE_NOTIF_ACTIONS',
          extra: {
            showId: extraData.showId,
            tmdbId: extraData.tmdbId,
            mediaType: extraData.mediaType || 'tv',
            season: extraData.season,
            episode: extraData.episode,
            url: extraData.url
          }
        }]
      });
      return;
    } catch (err) {
      console.warn('LocalNotifications native schedule failed:', err);
    }
  }

  // If not future schedule on web, trigger web notification
  if (options?.scheduleDate && options.scheduleDate.getTime() > Date.now()) {
    // Web scheduled reminder in memory timer
    const delay = options.scheduleDate.getTime() - Date.now();
    if (delay < 24 * 60 * 60 * 1000) {
      setTimeout(() => {
        sendNativeNotification(title, { ...options, scheduleDate: undefined });
      }, delay);
    }
    return;
  }

  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  try {
    if ('serviceWorker' in navigator) {
      let reg = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
      if (!reg) {
        try {
          reg = await navigator.serviceWorker.ready;
        } catch {}
      }
      if (reg && reg.showNotification) {
        await reg.showNotification(title, options);
        return;
      }
    }
  } catch (err) {
    console.warn("SW showNotification failed, fallback to new Notification:", err);
  }

  try {
    new Notification(title, options);
  } catch (err) {
    console.warn("new Notification failed:", err);
  }
}

const DEVICE_INSTALLATION_KEY = 'seenit_notification_installation_id_v1';

function getNotificationInstallationId(): string {
  const existing = localStorage.getItem(DEVICE_INSTALLATION_KEY);
  if (existing && /^[a-zA-Z0-9_-]{16,128}$/.test(existing)) return existing;
  const created = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(36)}${crypto.getRandomValues(new Uint32Array(4)).join('')}`;
  localStorage.setItem(DEVICE_INSTALLATION_KEY, created);
  return created;
}

async function registerNotificationDevice(fcmToken: string, platform: 'web' | 'android') {
  const user = auth.currentUser;
  if (!user || fcmToken.length < 20) return false;
  const response = await fetch(resolveSeenItApiUrl('/api/devices/register'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await user.getIdToken()}`
    },
    body: JSON.stringify({
      installationId: getNotificationInstallationId(),
      fcmToken,
      platform
    })
  });
  return response.ok;
}

async function requestNativePushToken(): Promise<string | null> {
  const permission = await PushNotifications.checkPermissions();
  const granted = permission.receive === 'granted'
    ? permission
    : await PushNotifications.requestPermissions();
  if (granted.receive !== 'granted') return null;

  return new Promise<string | null>(async resolve => {
    let settled = false;
    const finish = (token: string | null) => {
      if (settled) return;
      settled = true;
      resolve(token);
    };
    const registrationListener = await PushNotifications.addListener('registration', token => finish(token.value || null));
    const errorListener = await PushNotifications.addListener('registrationError', () => finish(null));
    const timer = window.setTimeout(() => finish(null), 12_000);
    try {
      await PushNotifications.register();
    } catch {
      finish(null);
    }
    const cleanup = () => {
      window.clearTimeout(timer);
      void registrationListener.remove();
      void errorListener.remove();
    };
    window.setTimeout(cleanup, 12_100);
  });
}

export async function revokeCurrentDeviceNotifications(): Promise<void> {
  const user = auth.currentUser;
  const installationId = typeof localStorage !== 'undefined' ? localStorage.getItem(DEVICE_INSTALLATION_KEY) : null;
  if (user && installationId) {
    await fetch(resolveSeenItApiUrl(`/api/devices/${encodeURIComponent(installationId)}`), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${await user.getIdToken()}` }
    }).catch(() => undefined);
  }
  if (Capacitor.isNativePlatform()) {
    await PushNotifications.unregister().catch(() => undefined);
  } else if (messaging) {
    await deleteToken(messaging).catch(() => false);
  }
}

export async function requestNotificationPermission(): Promise<string | null> {
  if (Capacitor.isNativePlatform()) {
    try {
      const token = await requestNativePushToken();
      if (!token) return null;
      await registerNotificationDevice(token, 'android');
      return token;
    } catch (err) {
      console.warn('PushNotifications registration error:', err);
      return null;
    }
  }

  if (typeof window === 'undefined' || !('Notification' in window)) {
    console.warn('Notification API not supported in this browser.');
    return null;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('Notification permission not granted.');
      return null;
    }

    const supported = await isSupported();
    if (!supported) {
      console.warn('Firebase Messaging is not supported in this browser.');
      return null;
    }

    if (!messaging) {
      messaging = getMessaging(app);
    }

    let swRegistration: ServiceWorkerRegistration | undefined;
    if ('serviceWorker' in navigator) {
      try {
        swRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      } catch (swErr) {
        console.warn('Could not register firebase-messaging-sw.js:', swErr);
      }
    }

    const vapidKey = (firebaseConfig as any).vapidKey;
    const options: { vapidKey?: string; serviceWorkerRegistration?: ServiceWorkerRegistration } = {};
    if (vapidKey) options.vapidKey = vapidKey;
    if (swRegistration) options.serviceWorkerRegistration = swRegistration;

    let token: string | null = null;
    try {
      token = await getToken(messaging, Object.keys(options).length > 0 ? options : undefined);
    } catch (tokenErr) {
      console.warn('getToken with options failed, trying default getToken:', tokenErr);
      token = await getToken(messaging);
    }

    if (!token) return null;
    await registerNotificationDevice(token, 'web');
    return token;
  } catch (error) {
    console.error('Error in requestNotificationPermission:', error);
    return null;
  }
}

/**
 * Rafraîchit le token d'un appareil déjà autorisé sans jamais afficher une
 * demande de permission au démarrage. La première activation reste une action
 * explicite de l'utilisateur dans les réglages.
 */
export async function syncGrantedNotificationDevice(): Promise<void> {
  if (!auth.currentUser) return;
  if (Capacitor.isNativePlatform()) {
    const permission = await PushNotifications.checkPermissions().catch(() => null);
    if (permission?.receive !== 'granted') return;
  } else {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  }
  await requestNotificationPermission();
}


