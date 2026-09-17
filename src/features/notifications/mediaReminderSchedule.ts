export interface MediaReminderSchedule {
  at: Date;
  allowWhileIdle: true;
}

/**
 * A due reminder must be delivered immediately by Capacitor rather than being
 * converted into a near-future AlarmManager job. Future reminders keep their
 * canonical schedule date unchanged.
 */
export function resolveMediaReminderSchedule(
  scheduleDate?: Date,
  nowMs: number = Date.now(),
): MediaReminderSchedule | undefined {
  if (!scheduleDate || scheduleDate.getTime() <= nowMs) return undefined;

  return {
    at: scheduleDate,
    allowWhileIdle: true,
  };
}
