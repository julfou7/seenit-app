import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveMediaReminderSchedule } from '../src/features/notifications/mediaReminderSchedule.ts';

const reminderSource = readFileSync('src/hooks/useRemindersNotifier.ts', 'utf8');
const nativeSource = readFileSync('src/features/notifications/mediaReminderNotification.ts', 'utf8');
const patchSource = readFileSync('scripts/patch-local-notifications.cjs', 'utf8');

test('issues #106, #623 et #625 gardent une seule révision active de chaque alarme future', () => {
  assert.match(reminderSource, /const REMINDER_SCHEDULE_SCHEMA = 'v7';/,
    'le payload v7 doit invalider les clés v6 afin de reprogrammer les rappels avec leur contexte détaillé');
  assert.doesNotMatch(reminderSource, /REMINDER_SCHEDULE_SCHEMA = 'v6'/,
    'l’ancien schéma ne doit plus figer une alarme future avec une copie générique');
  assert.match(
    reminderSource,
    /const scheduleKey = `scheduled_9am_\$\{REMINDER_SCHEDULE_SCHEMA\}_\$\{s\.id\}_\$\{tagPrefix\}_S\$\{sNum\}E\$\{eNum\}_\$\{targetStr\}`;/,
    'la clé série doit identifier l’alarme stable, pas une ancienne copie',
  );
  assert.doesNotMatch(reminderSource, /_c\$\{contentRevision\}/,
    'la révision ne doit plus créer des reçus booléens A/B concurrents');
  assert.match(
    reminderSource,
    /const activeContentRevision = readUserScopedJson<number \| null>\(uid, scheduleKey, null\);[\s\S]*?activeContentRevision !== contentRevision[\s\S]*?await cancelMediaReminderNotificationByTag\(notificationTag\);[\s\S]*?writeUserScopedJson\(uid, scheduleKey, contentRevision\);/,
    'A→B→A doit comparer puis remplacer la seule révision active',
  );
  assert.match(nativeSource, /LocalNotifications\.cancel\(\{[\s\S]*?getMediaReminderNotificationId\(tag\)/,
    'l’ancienne notification portant le même ID Android doit être annulable avant remplacement');
});

test('issue #106 livre les rappels dus immédiatement sans fausse alarme +100 ms', () => {
  const now = Date.UTC(2026, 8, 17, 17, 0, 0);

  assert.equal(resolveMediaReminderSchedule(undefined, now), undefined,
    'un rappel dû immédiatement ne doit pas être transformé en notification planifiée');
  assert.equal(resolveMediaReminderSchedule(new Date(now), now), undefined,
    'une date déjà atteinte doit rester une livraison immédiate');
  assert.doesNotMatch(nativeSource, /Date\.now\(\) \+ 100/,
    'le workaround +100 ms réintroduirait la course Android observée sur le visuel');
  assert.match(nativeSource, /\.\.\.\(schedule \? \{ schedule \} : \{\}\)/,
    'la clé schedule doit être absente du payload immédiat, pas seulement définie à undefined');
});

test('issue #106 conserve la vraie date des rappels futurs', () => {
  const now = Date.UTC(2026, 8, 17, 17, 0, 0);
  const future = new Date(now + 60_000);

  assert.deepEqual(resolveMediaReminderSchedule(future, now), {
    at: future,
    allowWhileIdle: true,
  }, 'un vrai rappel futur doit conserver exactement sa date canonique');
});

test('issues #106 et #621 migrent chaque révision Android déjà patchée de manière idempotente', () => {
  assert.match(patchSource, /LEGACY_FILE_PATCH_MARKER = 'SEENIT_LOCAL_NOTIFICATION_FILE_ICON_PATCH'/);
  assert.match(patchSource, /PREVIOUS_PATCH_MARKER = 'SEENIT_LOCAL_NOTIFICATION_PRIVATE_DATA_V2_PATCH'/);
  assert.match(patchSource, /PATCH_MARKER = 'SEENIT_LOCAL_NOTIFICATION_PRIVATE_DATA_V3_PATCH'/);
  assert.match(patchSource, /PREVIOUS_BIG_PICTURE_MARKER = 'SEENIT_LOCAL_NOTIFICATION_BOUNDED_BIG_PICTURE_PATCH'/);
  assert.match(patchSource, /BIG_PICTURE_MARKER = 'SEENIT_LOCAL_NOTIFICATION_BOUNDED_BIG_PICTURE_V2_PATCH'/);
  assert.match(patchSource, /PREVIOUS_DELIVERY_MEDIA_MARKER = 'SEENIT_LOCAL_NOTIFICATION_DELIVERY_MEDIA_V3_PATCH'/);
  assert.match(patchSource, /DELIVERY_MEDIA_MARKER = 'SEENIT_LOCAL_NOTIFICATION_DELIVERY_MEDIA_V4_PATCH'/);
  assert.match(
    patchSource,
    /localNotification\.includes\(PREVIOUS_PATCH_MARKER\)[\s\S]*?replace\(PREVIOUS_PATCH_MARKER, PATCH_MARKER\)[\s\S]*?replace\(PREVIOUS_BIG_PICTURE_MARKER, BIG_PICTURE_MARKER\)/,
    'un node_modules déjà patché V2 doit recevoir le nouveau contain avant de changer de marqueur',
  );
  assert.match(
    patchSource,
    /manager\.includes\(PREVIOUS_BIG_PICTURE_MARKER\)[\s\S]*?bigLargeIcon\(null as android\.graphics\.Bitmap\?\)[\s\S]*?replace\(PREVIOUS_BIG_PICTURE_MARKER, BIG_PICTURE_MARKER\)/,
    'le manager déjà patché doit masquer le largeIcon développé avant promotion du marqueur',
  );
  assert.match(
    patchSource,
    /publisher\.includes\(PREVIOUS_DELIVERY_MEDIA_MARKER\)[\s\S]*?bigLargeIcon\(null as android\.graphics\.Bitmap\?\)[\s\S]*?replace\(PREVIOUS_DELIVERY_MEDIA_MARKER, DELIVERY_MEDIA_MARKER\)/,
    'le publisher déjà patché doit recevoir la même migration',
  );
  assert.match(patchSource, /localNotification\.includes\(LEGACY_FILE_PATCH_MARKER\)/);
  assert.match(patchSource, /replace\(legacyFileSetter, stockSetter\)/);
  assert.match(patchSource, /replace\(legacyFileResolver, stockResolver\)/);
  assert.match(patchSource, /if \(!localNotification\.includes\(PATCH_MARKER\)\)/,
    'une deuxième exécution ne doit pas réappliquer la révision courante');
});

test('issue #106 purge les anciens rappels film dont la date n’est plus autoritative', () => {
  assert.match(reminderSource, /prunePendingMediaReminderNotifications\(s\.id, 'movie', allowedPendingMovieIds\)/);
  assert.match(nativeSource, /LocalNotifications\.getPending\(\)/);
  assert.match(nativeSource, /String\(notification\?\.extra\?\.showId/);
  assert.match(nativeSource, /String\(notification\?\.extra\?\.mediaType/);
  assert.match(nativeSource, /!allowed\.has\(Number\(notification\?\.id\)\)/);
});
