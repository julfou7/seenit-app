export const DEFAULT_NOTIFICATION_PREFS = {
  release_today_tv: true,
  season_d7: true,
  movie_theater: true,
  movie_dvd_vod: true,
  news: false,
};

/**
 * #402 — Sur l'APK Android, les canaux système (« Épisodes et saisons », « Films ») sont la seule autorité
 * pour les rappels locaux : les quatre interrupteurs SeenIt ne filtrent plus rien, sinon un ancien « non »
 * deviendrait invisible et impossible à rétablir. Les actualités restent un choix SeenIt : le serveur
 * décide de leur envoi.
 */
export function effectiveNotificationPreferences(
  prefs: typeof DEFAULT_NOTIFICATION_PREFS,
  androidChannels: boolean,
): typeof DEFAULT_NOTIFICATION_PREFS {
  if (!androidChannels) return prefs;
  return { ...prefs, release_today_tv: true, season_d7: true, movie_theater: true, movie_dvd_vod: true };
}

/** Préférences effectives de l'appareil courant (#402). */
export function readEffectiveNotificationPreferences(raw: unknown, platform: string): typeof DEFAULT_NOTIFICATION_PREFS {
  return effectiveNotificationPreferences(mergeNotificationPreferences(raw), platform === 'android');
}

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
