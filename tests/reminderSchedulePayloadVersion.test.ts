import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const reminderSource = readFileSync('src/hooks/useRemindersNotifier.ts', 'utf8');

test('SEENIT-NOTIFICATION-002 rematérialise les rappels planifiés après changement de payload', () => {
  assert.match(reminderSource, /const REMINDER_SCHEDULE_SCHEMA = 'v3'/,
    'le nouveau rendu Android doit invalider les clés de planification v2');
  assert.doesNotMatch(reminderSource, /REMINDER_SCHEDULE_SCHEMA = 'v2'/,
    'l’ancien schéma ne doit plus empêcher la reprogrammation du payload corrigé');
  assert.match(reminderSource, /cancelMediaReminderNotificationByTag\(notificationTag\)/,
    'l’alarme existante doit être remplacée avant d’enregistrer le nouveau payload');
  assert.match(reminderSource, /scheduled_9am_\$\{REMINDER_SCHEDULE_SCHEMA\}/,
    'les rappels film et série doivent rester versionnés par le schéma de payload');
});
