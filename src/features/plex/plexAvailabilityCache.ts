export function replacePlexUserCache<T>(
  currentCache: Record<string, T>,
  uid: string,
  replacementCache: Record<string, T>
): Record<string, T> {
  const prefix = `v3:${uid}:`;
  const nextCache: Record<string, T> = {};

  for (const [key, value] of Object.entries(currentCache)) {
    if (!key.startsWith(prefix)) nextCache[key] = value;
  }

  for (const [key, value] of Object.entries(replacementCache)) {
    if (key.startsWith(prefix)) nextCache[key] = value;
  }

  return nextCache;
}

export function buildPlexMediaUrl(serverId: string, ratingKey: string): string {
  return `https://app.plex.tv/desktop/#!/server/${serverId}/details?key=${encodeURIComponent(`/library/metadata/${ratingKey}`)}`;
}
