/** Le rappel explicite est local : aucune heure/fin n'est déduite d'une durée inconnue. */
export function nextTonightReminder(now = new Date()): Date {
  const at = new Date(now);
  at.setHours(20, 30, 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at;
}
