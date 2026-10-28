export const DEFAULT_NOTIFICATION_PREFS = {
  release_today_tv: true,
  season_d7: true,
  movie_theater: true,
  movie_dvd_vod: true,
  news: false,
};

export function mergeNotificationPreferences(raw: unknown): typeof DEFAULT_NOTIFICATION_PREFS {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown> : {};
  // Les comptes qui recevaient déjà les actualités les gardent après migration.
  const result = { ...DEFAULT_NOTIFICATION_PREFS, news: Object.keys(record).length > 0 };
  for (const key of Object.keys(result) as Array<keyof typeof result>) {
    if (typeof record[key] === 'boolean') result[key] = record[key];
  }
  return result;
}
