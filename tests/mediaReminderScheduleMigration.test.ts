import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const reminderSource = readFileSync('src/hooks/useRemindersNotifier.ts', 'utf8');
const nativeSource = readFileSync('src/features/notifications/mediaReminderNotification.ts', 'utf8');

test('issue #106 remplace une ancienne alarme par le payload visuel courant sans doublon', () => {
  assert.match(reminderSource, /const REMINDER_SCHEDULE_SCHEMA = 'v3';/,
    'le payload v3 doit invalider les clés v2 afin de rematérialiser les rappels existants');
  assert.doesNotMatch(reminderSource, /REMINDER_SCHEDULE_SCHEMA = 'v2'/,
    'l’ancien schéma ne doit plus empêcher la reprogrammation du payload corrigé');
  assert.match(reminderSource, /await cancelMediaReminderNotificationByTag\(notificationTag\);[\s\S]*?if \(await send\(targetDate\)\) writeUserScopedJson\(uid, scheduleKey, true\);/,
    'la clé v3 ne doit être persistée qu’après une planification réussie');
  assert.match(reminderSource, /scheduled_9am_\$\{REMINDER_SCHEDULE_SCHEMA\}/,
    'les rappels film et série doivent rester versionnés par le schéma de payload');
  assert.match(nativeSource, /LocalNotifications\.cancel\(\{[\s\S]*?getMediaReminderNotificationId\(tag\)/,
    'l’ancienne notification portant le même ID Android doit être annulable avant remplacement');
});

test('issue #106 purge les anciens rappels film dont la date n’est plus autoritative', () => {
  assert.match(reminderSource, /prunePendingMediaReminderNotifications\(s\.id, 'movie', allowedPendingMovieIds\)/);
  assert.match(nativeSource, /LocalNotifications\.getPending\(\)/);
  assert.match(nativeSource, /String\(notification\?\.extra\?\.showId/);
  assert.match(nativeSource, /String\(notification\?\.extra\?\.mediaType/);
  assert.match(nativeSource, /!allowed\.has\(Number\(notification\?\.id\)\)/);
});
