import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const server = readFileSync('server.ts', 'utf8');
const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
const worker = readFileSync('android/app/src/main/java/com/seenit/app/PlexAvailabilityWorker.java', 'utf8');
const service = readFileSync('android/app/src/main/java/com/seenit/app/SeenItMessagingService.java', 'utf8');
const store = readFileSync('android/app/src/main/java/com/seenit/app/PlexBackgroundCredentialStore.java', 'utf8');
const plugin = readFileSync('android/app/src/main/java/com/seenit/app/SeenItPlexBackgroundPlugin.kt', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const plexStorage = readFileSync('src/features/plex/plexStorage.ts', 'utf8');

test('SEENIT-NOTIFICATION-003 vérifie Plex en arrière-plan sans exposer le token', () => {
  assert.ok(server.includes("platform: 'android'"));
  assert.ok(server.includes('androidHighPriority: true'));
  assert.ok(server.includes('ownerUidHash'));
  assert.ok(server.includes('sendPushToUserDevices(uid, null'));
  assert.ok(service.includes('PlexAvailabilityWorker.enqueue'));
  assert.ok(worker.includes('WorkManager.getInstance'));
  assert.ok(worker.includes('BackoffPolicy.LINEAR'));
  assert.ok(worker.includes('/library/all?guid='));
  assert.ok(worker.includes('/hubs/search?query='));
  assert.ok(worker.includes('themoviedb://'));
  assert.ok(worker.includes('hasExactTmdbGuid'));
  assert.ok(worker.includes('parentIndex'));
  assert.ok(worker.includes('index'));
  assert.ok(!worker.includes('title.equals'));
  assert.ok(store.includes('getNoBackupFilesDir'));
  assert.ok(store.includes('hashUid'));
  assert.ok(plugin.includes('clearForUid'));
  assert.ok(plexStorage.includes('syncNativePlexBackgroundCredentials'));
  assert.ok(worker.includes('Fail closed: un signal ancien'));
  assert.ok(!worker.includes('showNotification(false);\n            return Result.success();'));
  assert.ok(manifest.includes('com.capacitorjs.plugins.pushnotifications.MessagingService'));
  assert.ok(manifest.includes('tools:node="remove"'));
  assert.ok(manifest.includes('android:name=".SeenItMessagingService"'));
  assert.ok(!server.includes('est prêt et disponible !'));
});

test('SEENIT-NOTIFICATION-003 ouvre la fiche exacte depuis la notification Plex', () => {
  assert.ok(worker.includes('.scheme("com.seenit.app")'));
  assert.ok(worker.includes('.authority("media")'));
  assert.ok(worker.includes('.appendQueryParameter("tmdbId"'));
  assert.ok(app.includes("rawUrl.startsWith('com.seenit.app://media')"));
  assert.ok(app.includes("'tmdb'"));
});
