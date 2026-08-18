import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getMessaging, getToken, isSupported, type Messaging } from 'firebase/messaging';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

// Standard Firebase Auth automatically handles robust persistence (IndexedDB, localStorage) on Capacitor
export const auth = getAuth(app);

export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.setCustomParameters({
  prompt: 'select_account'
});

export const db = initializeFirestore(
  app,
  { 
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  },
  'default'
);

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

export async function sendNativeNotification(title: string, options?: NotificationOptions) {
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

export async function requestNotificationPermission(): Promise<string | null> {
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

    return token;
  } catch (error) {
    console.error('Error in requestNotificationPermission:', error);
    return null;
  }
}


