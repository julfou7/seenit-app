import { onAuthStateChanged } from 'firebase/auth';
import { getMessaging, isSupported, onMessage } from 'firebase/messaging';
import { Capacitor } from '@capacitor/core';
import { auth } from '../../lib/firebase';
import { authenticatedFetch } from '../../lib/apiAuth';
import { createDownloadFailureOutbox, type DownloadFailureReceipt } from './downloadFailureNotification';

const STORAGE_KEY = 'seenit-download-failure-outbox-v1';
let memory: DownloadFailureReceipt[] = [];
let storageUnavailable = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
const outbox = createDownloadFailureOutbox({
  read: () => {
    if (storageUnavailable) return memory;
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { storageUnavailable = true; return memory; }
  },
  write: items => {
    memory = items;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch { storageUnavailable = true; }
  },
  currentUid: () => auth.currentUser?.uid || null,
  send: async item => {
    if (auth.currentUser?.uid !== item.ownerUid) return false;
    const response = await authenticatedFetch('/api/downloads/failure-notification', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item), signal: AbortSignal.timeout(10_000)
    });
    return response.ok && (await response.json()).accepted === true;
  }
});

export function enqueueDownloadFailureNotification(receipt: DownloadFailureReceipt): void {
  outbox.enqueue(receipt);
  void outbox.flush();
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { void outbox.flush(); }, 30_000);
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { void outbox.flush(); });
  window.addEventListener('focus', () => { void outbox.flush(); });
  onAuthStateChanged(auth, () => { void outbox.flush(); });
  if (!Capacitor.isNativePlatform()) {
    void isSupported().then(supported => {
      if (!supported) return;
      onMessage(getMessaging(), payload => {
        const data = payload.data;
        if (data?.notificationKind !== 'download_failure' || Notification.permission !== 'granted') return;
        void navigator.serviceWorker.ready.then(registration => registration.showNotification(data.title, {
          body: data.body, tag: data.tag, icon: '/icon-192.png', data
        })).catch(() => undefined);
      });
    }).catch(() => undefined);
  }
}
