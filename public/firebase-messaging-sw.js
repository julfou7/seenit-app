importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  projectId: "gen-lang-client-0201895414",
  appId: "1:799043440232:web:154f4f27f8e1493c9275dd",
  apiKey: "AIzaSyCfrB6vxS5DsgwGYKgFnFwy67Ik2_1ZiBs",
  authDomain: "gen-lang-client-0201895414.firebaseapp.com",
  storageBucket: "gen-lang-client-0201895414.firebasestorage.app",
  messagingSenderId: "799043440232"
});

const messaging = firebase.messaging();

// Service Worker - Gestionnaire de Notifications & Clics Natifs
const SW_VERSION = 'v2.5.0';

self.addEventListener('install', (event) => {
  console.log(`[SW ${SW_VERSION}] Install & skipWaiting`);
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log(`[SW ${SW_VERSION}] Activate & claim clients`);
  event.waitUntil(self.clients.claim());
});

// Gérer les notifications en arrière-plan Firebase Cloud Messaging
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Message d\'arrière-plan reçu :', payload);
  
  const notificationTitle = payload.notification?.title || payload.data?.title || 'Nouvel épisode';
  const notificationBody = payload.notification?.body || payload.data?.body || 'Un nouvel épisode arrive aujourd\'hui !';
  const icon = payload.notification?.icon || payload.data?.icon || '/icon-192.png';
  const image = payload.notification?.image || payload.data?.image || payload.data?.backdrop || undefined;
  const tag = payload.data?.tag || payload.notification?.tag || `notif_${Date.now()}`;
  
  const showId = payload.data?.showId || null;
  const tmdbId = payload.data?.tmdbId || null;
  const mediaType = payload.data?.mediaType || 'tv';
  const season = payload.data?.season || null;
  const episode = payload.data?.episode || null;

  const notificationOptions = {
    body: notificationBody,
    icon: icon,
    badge: '/icon-192.png',
    image: image,
    tag: tag,
    renotify: true,
    vibrate: [150, 80, 150, 80, 250],
    data: {
      url: `/?showId=${showId || ''}&tmdbId=${tmdbId || ''}&mediaType=${mediaType}&season=${season || ''}&episode=${episode || ''}&tab=watchlist`,
      showId: showId,
      tmdbId: tmdbId,
      mediaType: mediaType,
      season: season,
      episode: episode
    },
    actions: [
      {
        action: 'mark_watched',
        title: '✓ Marquer comme vu'
      }
    ]
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Écouteur d'actions sur la notification native (Clic sur la notification ou sur un bouton d'action)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const action = event.action;
  const data = event.notification.data || {};
  
  const showId = data.showId || data.tmdbId || '';
  const tmdbId = data.tmdbId || (showId && !isNaN(Number(showId)) ? Number(showId) : undefined);
  const mediaType = data.mediaType || 'tv';
  const season = data.season;
  const episode = data.episode;
  
  const rawUrl = data.url || (showId || tmdbId ? `/?showId=${showId}&tmdbId=${tmdbId || ''}&mediaType=${mediaType}&season=${season || ''}&episode=${episode || ''}&tab=watchlist` : '/');
  const targetUrl = new URL(rawUrl, self.location.origin).href;

  if (action === 'mark_watched') {
    // Si l'utilisateur clique sur "Marquer comme vu" directement depuis l'écran de verrouillage
    event.waitUntil(
      (async () => {
        // Envoi via BroadcastChannel
        try {
          const bc = new BroadcastChannel('app_notifications');
          bc.postMessage({
            type: 'QUICK_ACTION_MARK_WATCHED',
            showId: showId,
            tmdbId: tmdbId,
            season: season,
            episode: episode,
            timestamp: Date.now()
          });
          bc.close();
        } catch (e) {}

        const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clientList) {
          if (client.url && 'focus' in client) {
            client.postMessage({
              type: 'QUICK_ACTION_MARK_WATCHED',
              showId: showId,
              tmdbId: tmdbId,
              season: season,
              episode: episode
            });
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          const actionUrl = new URL(`${rawUrl}${rawUrl.includes('?') ? '&' : '?'}action=mark_watched&season=${season || ''}&episode=${episode || ''}`, self.location.origin).href;
          return self.clients.openWindow(actionUrl);
        }
      })()
    );
    return;
  }

  // Clic standard ou action "open_show" : Ouvrir ou focaliser l'application
  event.waitUntil(
    (async () => {
      // 1. Émettre sur le BroadcastChannel pour avertir l'application React
      try {
        const bc = new BroadcastChannel('app_notifications');
        bc.postMessage({
          type: 'NAVIGATE_SHOW',
          showId: showId,
          tmdbId: tmdbId,
          mediaType: mediaType,
          season: season,
          episode: episode,
          url: targetUrl,
          timestamp: Date.now()
        });
        bc.close();
      } catch (e) {}

      // 2. Transmettre à tous les clients fenêtres existants
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientList) {
        try {
          client.postMessage({
            type: 'NAVIGATE_SHOW',
            showId: showId,
            tmdbId: tmdbId,
            mediaType: mediaType,
            season: season,
            episode: episode,
            url: targetUrl
          });
        } catch (e) {}
      }

      // 3. Focaliser la première fenêtre disponible ou en ouvrir une nouvelle
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })()
  );
});
