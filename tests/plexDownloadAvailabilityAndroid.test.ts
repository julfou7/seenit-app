import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const server = readFileSync('server.ts', 'utf8');
const delivery = readFileSync('src/features/downloads/downloadWebhookDelivery.ts', 'utf8');
const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
const appGradle = readFileSync('android/app/build.gradle', 'utf8');
const androidVariables = readFileSync('android/variables.gradle', 'utf8');
const worker = readFileSync('android/app/src/main/java/com/seenit/app/PlexAvailabilityWorker.java', 'utf8');
const service = readFileSync('android/app/src/main/java/com/seenit/app/SeenItMessagingService.java', 'utf8');
const store = readFileSync('android/app/src/main/java/com/seenit/app/PlexBackgroundCredentialStore.java', 'utf8');
const plugin = readFileSync('android/app/src/main/java/com/seenit/app/SeenItPlexBackgroundPlugin.kt', 'utf8');
const diagnosticStore = readFileSync(
  'android/app/src/main/java/com/seenit/app/PlexAvailabilityDiagnosticStore.java',
  'utf8'
);
const app = readFileSync('src/App.tsx', 'utf8');
const showDetail = readFileSync('src/screens/ShowDetailScreenCore.tsx', 'utf8');
const plexStorage = readFileSync('src/features/plex/plexStorage.ts', 'utf8');

test('SEENIT-NOTIFICATION-003 vérifie Plex en arrière-plan sans exposer le token', () => {
  assert.ok(server.includes('deliverDownloadWebhookPresentation'));
  assert.ok(delivery.includes("platform: 'android'"));
  assert.ok(delivery.includes('androidHighPriority: true'));
  assert.ok(delivery.includes('ownerUidHash'));
  assert.ok(delivery.includes('sendPush(uid, null'));
  assert.ok(delivery.includes('sendPush(uid, presentation.notification, presentation.data)'));
  assert.ok(service.includes('PlexAvailabilityWorker.enqueue'));
  assert.ok(service.includes('com.google.firebase.messaging.RemoteMessage'));
  assert.ok(service.includes('extends MessagingService'));
  assert.ok(androidVariables.includes("firebaseMessagingVersion = '25.0.1'"));
  assert.ok(appGradle.includes('com.google.firebase:firebase-messaging:$firebaseMessagingVersion'));
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
  assert.ok(store.includes('new Scanner(file, StandardCharsets.UTF_8.name())'));
  assert.ok(!store.includes('.isBlank()'));
  assert.ok(!store.includes('new Scanner(file, StandardCharsets.UTF_8)'));
  assert.ok(worker.includes('nonNegativeInt(message.get("season"))'));
  assert.ok(worker.includes('season < 0 || episode <= 0'));
  assert.ok(worker.includes('season >= 0 && episode > 0'));
  assert.ok(plugin.includes('clearForUid'));
  assert.ok(plexStorage.includes('syncNativePlexBackgroundCredentials'));
  assert.ok(worker.includes('boolean canRetry = attempt < MAX_ATTEMPTS;'));
  assert.ok(worker.includes('return canRetry ? Result.retry() : Result.success();'));
  assert.ok(worker.includes('if (!expectedUidHash.equals(credentials.uidHash))'));
  assert.ok(worker.includes('showPlexAvailableNotification()'));
  assert.ok(!worker.includes('showNotification(false)'));
  assert.ok(manifest.includes('com.capacitorjs.plugins.pushnotifications.MessagingService'));
  assert.ok(manifest.includes('tools:node="remove"'));
  assert.ok(manifest.includes('android:name=".SeenItMessagingService"'));
  assert.ok(!server.includes('est prêt et disponible !'));
});

test('SEENIT-NOTIFICATION-003 reste compatible minSdk 24 et distingue la saison 0', () => {
  assert.ok(store.includes('new Scanner(file, StandardCharsets.UTF_8.name())'));
  assert.ok(!store.includes('.isBlank()'));
  assert.ok(!store.includes('new Scanner(file, StandardCharsets.UTF_8)'));
  assert.ok(worker.includes('nonNegativeInt(message.get("season"))'));
  assert.ok(worker.includes('season < 0 || episode <= 0'));
  assert.ok(worker.includes('season >= 0 && episode > 0'));
});

test('SEENIT-NOTIFICATION-003 ouvre la fiche exacte depuis la notification Plex', () => {
  assert.ok(worker.includes('.scheme("com.seenit.app")'));
  assert.ok(worker.includes('.authority("media")'));
  assert.ok(worker.includes('.appendQueryParameter("tmdbId"'));
  assert.ok(app.includes("rawUrl.startsWith('com.seenit.app://media')"));
  assert.ok(app.includes("'tmdb'"));
});

test('SEENIT-NOTIFICATION-003 préserve S0E1 du deep-link jusqu’à la fiche épisode', () => {
  assert.ok(app.includes("const seasonParam = parsed.searchParams.get('season')"));
  assert.ok(app.includes("seasonParam !== null && seasonParam.trim() ? Number(seasonParam) : NaN"));
  assert.ok(app.includes('Number.isInteger(season) && season >= 0 ? season : undefined'));
  assert.doesNotMatch(app, /season > 0 \? season : undefined/);

  assert.ok(showDetail.includes('initialSeason ?? getSmartDefaultSeason(show, tmdbDetails)'));
  assert.ok(showDetail.includes('initialSeason !== undefined && initialSeason !== null && initialEpisode'));
  assert.doesNotMatch(showDetail, /initialSeason \|\| getSmartDefaultSeason/);
  assert.doesNotMatch(showDetail, /if \(initialSeason && initialEpisode/);
});


test('SEENIT-NOTIFICATION-003 trace le pipeline natif sans média ni secret', () => {
  assert.ok(server.includes("normalizePlexAvailabilityTraceBatch"));
  assert.ok(server.includes("'/api/diagnostics/plex-availability'"));
  assert.ok(delivery.includes('traceId'));
  assert.ok(service.includes('"fcm_received"'));
  assert.ok(worker.includes('recordDiagnostic("worker", "started"'));
  assert.ok(worker.includes('"missing_retry"'));
  assert.ok(worker.includes('"not_available_exhausted"'));
  assert.ok(worker.includes('"security_error"'));
  assert.ok(worker.includes('areNotificationsEnabled()'));
  assert.ok(diagnosticStore.includes('MAX_EVENTS = 120'));
  assert.ok(diagnosticStore.includes('getNoBackupFilesDir'));
  assert.ok(diagnosticStore.includes('clearForUidBefore'));
  assert.doesNotMatch(diagnosticStore, /tmdbId|eventKey|title|X-Plex-Token/);
  assert.ok(plugin.includes('readDiagnostics'));
  assert.ok(plugin.includes('clearDiagnostics'));
  assert.ok(plexStorage.includes("/api/diagnostics/plex-availability"));
  assert.ok(plexStorage.includes('clearDiagnostics({ uid, beforeTimestamp })'));
  assert.ok(app.includes('flushNativePlexAvailabilityDiagnostics'));
  assert.ok(app.includes('[Plex disponibilité] trace='));
});
