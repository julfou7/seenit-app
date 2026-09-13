import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const reminderSource = readFileSync('src/hooks/useRemindersNotifier.ts', 'utf8');
const nativeSource = readFileSync('src/features/notifications/mediaReminderNotification.ts', 'utf8');
const patchSource = readFileSync('scripts/patch-local-notifications.cjs', 'utf8');

test('issue #106 remplace les alarmes V4 par le transport sans bitmap V5 sans doublon', () => {
  assert.match(reminderSource, /const REMINDER_SCHEDULE_SCHEMA = 'v5';/,
    'le payload v5 doit invalider les clés v4 afin de rematérialiser les rappels sans bitmap AlarmManager');
  assert.doesNotMatch(reminderSource, /REMINDER_SCHEDULE_SCHEMA = 'v4'/,
    'l’ancien schéma ne doit plus empêcher la reprogrammation du transport corrigé');
  assert.match(reminderSource, /await cancelMediaReminderNotificationByTag\(notificationTag\);[\s\S]*?if \(await send\(targetDate\)\) writeUserScopedJson\(uid, scheduleKey, true\);/,
    'la clé v5 ne doit être persistée qu’après une planification réussie');
  assert.match(reminderSource, /scheduled_9am_\$\{REMINDER_SCHEDULE_SCHEMA\}/,
    'les rappels film et série doivent rester versionnés par le schéma de payload');
  assert.match(nativeSource, /LocalNotifications\.cancel\(\{[\s\S]*?getMediaReminderNotificationId\(tag\)/,
    'l’ancienne notification portant le même ID Android doit être annulable avant remplacement');
});

test('issue #106 migre le patch Android V1 vers V2 de manière idempotente', () => {
  assert.match(patchSource, /LEGACY_FILE_PATCH_MARKER = 'SEENIT_LOCAL_NOTIFICATION_FILE_ICON_PATCH'/);
  assert.match(patchSource, /PATCH_MARKER = 'SEENIT_LOCAL_NOTIFICATION_PRIVATE_DATA_V2_PATCH'/);
  assert.match(patchSource, /localNotification\.includes\(LEGACY_FILE_PATCH_MARKER\)/);
  assert.match(patchSource, /replace\(legacyFileSetter, stockSetter\)/);
  assert.match(patchSource, /replace\(legacyFileResolver, stockResolver\)/);
  assert.match(patchSource, /if \(!localNotification\.includes\(PATCH_MARKER\)\)/,
    'une deuxième exécution ne doit pas réappliquer V2');
});

test('issue #106 purge les anciens rappels film dont la date n’est plus autoritative', () => {
  assert.match(reminderSource, /prunePendingMediaReminderNotifications\(s\.id, 'movie', allowedPendingMovieIds\)/);
  assert.match(nativeSource, /LocalNotifications\.getPending\(\)/);
  assert.match(nativeSource, /String\(notification\?\.extra\?\.showId/);
  assert.match(nativeSource, /String\(notification\?\.extra\?\.mediaType/);
  assert.match(nativeSource, /!allowed\.has\(Number\(notification\?\.id\)\)/);
});
