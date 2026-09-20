import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

const serviceWorkerSource = readFileSync('public/firebase-messaging-sw.js', 'utf8');

type WaitEvent = {
  waitUntil: (value: Promise<unknown>) => void;
  promise?: Promise<unknown>;
};

function createHarness() {
  const listeners = new Map<string, (event: any) => void>();
  const cacheEntries = new Map<string, Map<string, any>>();
  const notifications: Array<{ title: string; options: any }> = [];
  const clientMessages: any[] = [];
  const openedWindows: string[] = [];
  let backgroundMessage: ((payload: any) => void) | null = null;
  let claimed = 0;
  let skipped = 0;
  let focused = 0;
  let fetchImpl: (request: any) => Promise<any> = async () => ({ ok: true, clone() { return this; } });

  const cacheFor = (name: string) => {
    let entries = cacheEntries.get(name);
    if (!entries) {
      entries = new Map();
      cacheEntries.set(name, entries);
    }
    return {
      addAll: async (urls: string[]) => {
        for (const url of urls) entries!.set(url, { cached: url, ok: true, clone() { return this; } });
      },
      put: async (request: any, response: any) => {
        const key = typeof request === 'string' ? request : request.url;
        entries!.set(key, response);
      },
      match: async (request: any) => {
        const key = typeof request === 'string' ? request : request.url;
        return entries!.get(key);
      },
    };
  };

  const client = {
    url: 'https://seenit.test/',
    postMessage: (message: any) => clientMessages.push(message),
    focus: async () => {
      focused += 1;
      return client;
    },
  };

  class FakeBroadcastChannel {
    static messages: any[] = [];
    constructor(_name: string) {}
    postMessage(message: any) { FakeBroadcastChannel.messages.push(message); }
    close() {}
  }

  const selfObject = {
    location: { origin: 'https://seenit.test' },
    addEventListener: (type: string, listener: (event: any) => void) => listeners.set(type, listener),
    skipWaiting: () => { skipped += 1; },
    clients: {
      claim: async () => { claimed += 1; },
      matchAll: async () => [client],
      openWindow: async (url: string) => {
        openedWindows.push(url);
        return { url };
      },
    },
    registration: {
      showNotification: async (title: string, options: any) => {
        notifications.push({ title, options });
      },
    },
  };

  const context = createContext({
    self: selfObject,
    caches: {
      open: async (name: string) => cacheFor(name),
      keys: async () => [...cacheEntries.keys()],
      delete: async (name: string) => cacheEntries.delete(name),
      match: async (request: any) => {
        for (const entries of cacheEntries.values()) {
          const key = typeof request === 'string' ? request : request.url;
          if (entries.has(key)) return entries.get(key);
        }
        return undefined;
      },
    },
    fetch: (request: any) => fetchImpl(request),
    firebase: {
      initializeApp: () => undefined,
      messaging: () => ({
        onBackgroundMessage: (listener: (payload: any) => void) => { backgroundMessage = listener; },
      }),
    },
    importScripts: () => undefined,
    BroadcastChannel: FakeBroadcastChannel,
    URL,
    Number,
    Date,
    Promise,
    isNaN,
    console,
  });
  runInContext(serviceWorkerSource, context, { filename: 'firebase-messaging-sw.js' });

  return {
    listeners,
    cacheEntries,
    notifications,
    clientMessages,
    openedWindows,
    FakeBroadcastChannel,
    setFetch: (impl: typeof fetchImpl) => { fetchImpl = impl; },
    backgroundMessage: () => backgroundMessage,
    claimed: () => claimed,
    skipped: () => skipped,
    focused: () => focused,
  };
}

function waitEvent(): WaitEvent {
  const event: WaitEvent = {
    waitUntil(value) {
      event.promise = Promise.resolve(value);
    },
  };
  return event;
}

test('SEENIT-QUALITY-001 installe et active le service worker en remplaçant le cache SeenIt obsolète', async () => {
  const harness = createHarness();
  harness.cacheEntries.set('seenit-static-v2.9.0', new Map([['/', { stale: true }]]));

  const install = waitEvent();
  harness.listeners.get('install')!(install);
  await install.promise;
  assert.equal(harness.skipped(), 1);
  assert.ok(harness.cacheEntries.has('seenit-static-v3.0.0'));
  assert.ok(harness.cacheEntries.get('seenit-static-v3.0.0')?.has('/'));

  const activate = waitEvent();
  harness.listeners.get('activate')!(activate);
  await activate.promise;
  assert.equal(harness.claimed(), 1);
  assert.equal(harness.cacheEntries.has('seenit-static-v2.9.0'), false);
  assert.equal(harness.cacheEntries.has('seenit-static-v3.0.0'), true);
});

test('SEENIT-QUALITY-001 ne met jamais une route API en cache et sert le shell hors-ligne', async () => {
  const harness = createHarness();
  const install = waitEvent();
  harness.listeners.get('install')!(install);
  await install.promise;

  let apiResponded = false;
  harness.listeners.get('fetch')!({
    request: { method: 'GET', url: 'https://seenit.test/api/shows', mode: 'cors' },
    respondWith: () => { apiResponded = true; },
  });
  assert.equal(apiResponded, false, 'une route /api doit rester entièrement au réseau/navigateur');

  harness.setFetch(async () => { throw new Error('offline'); });
  let offlineResponse: any;
  harness.listeners.get('fetch')!({
    request: { method: 'GET', url: 'https://seenit.test/watchlist', mode: 'navigate' },
    respondWith: (value: Promise<any>) => { offlineResponse = awaitable(value); },
  });
  const response = await offlineResponse;
  assert.equal(response.cached, '/');
});

function awaitable<T>(value: Promise<T> | T): Promise<T> {
  return Promise.resolve(value);
}

test('SEENIT-QUALITY-001 conserve image et destination lors d’une notification PWA en arrière-plan', async () => {
  const harness = createHarness();
  const backgroundMessage = harness.backgroundMessage();
  assert.ok(backgroundMessage, 'le handler Firebase background doit être enregistré');

  backgroundMessage!({
    notification: { title: 'Nouvel épisode', body: 'Disponible', image: 'https://image.test/backdrop.jpg' },
    data: { showId: '42', tmdbId: '42', mediaType: 'tv', season: '2', episode: '3', tag: 'ep-42-2-3' },
  });
  await Promise.resolve();

  assert.equal(harness.notifications.length, 1);
  const notification = harness.notifications[0];
  assert.equal(notification.title, 'Nouvel épisode');
  assert.equal(notification.options.image, 'https://image.test/backdrop.jpg');
  assert.match(notification.options.data.url, /showId=42/);
  assert.match(notification.options.data.url, /season=2/);
  assert.match(notification.options.data.url, /episode=3/);
});

test('SEENIT-QUALITY-001 route un clic de notification vers la fiche exacte sans réseau personnel', async () => {
  const harness = createHarness();
  const event = waitEvent() as WaitEvent & { notification: any; action: string };
  event.action = '';
  event.notification = {
    data: {
      url: '/?showId=42&tmdbId=42&mediaType=tv&season=2&episode=3&tab=watchlist',
      showId: '42',
      tmdbId: '42',
      mediaType: 'tv',
      season: '2',
      episode: '3',
    },
    close: () => undefined,
  };

  harness.listeners.get('notificationclick')!(event);
  await event.promise;

  assert.equal(harness.focused(), 1);
  assert.ok(harness.clientMessages.some(message =>
    message.type === 'NAVIGATE_SHOW' &&
    message.showId === '42' &&
    message.tmdbId === '42' &&
    message.season === '2' &&
    message.episode === '3'
  ));
  assert.ok(harness.FakeBroadcastChannel.messages.some(message => message.type === 'NAVIGATE_SHOW'));
  assert.equal(harness.openedWindows.length, 0);
});
