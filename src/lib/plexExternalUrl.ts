const PLEX_WEB_MEDIA_ROUTE = /^https:\/\/app\.plex\.tv\/desktop\/#!\/server\/([^/]+)\/details\?key=([^&#]+)(?:&.*)?$/i;
const PLEX_METADATA_PREFIX = '/library/metadata/';

/**
 * Convertit uniquement une route Web PMS exacte en deep link Plex Android.
 * Une URL Discover/universelle ne doit jamais être transformée en locator personnel.
 */
export function buildPlexAndroidPmsDeepLinkFromWebUrl(rawUrl: string): string | null {
  const value = String(rawUrl || '').trim();
  const match = value.match(PLEX_WEB_MEDIA_ROUTE);
  if (!match) return null;

  try {
    const serverId = decodeURIComponent(match[1]).trim();
    const metadataKey = decodeURIComponent(match[2]).trim();
    if (!serverId || !metadataKey.startsWith(PLEX_METADATA_PREFIX)) return null;

    const ratingKey = metadataKey.slice(PLEX_METADATA_PREFIX.length).trim();
    if (!ratingKey) return null;

    return `plex://server://${encodeURIComponent(serverId)}/com.plexapp.plugins.library/library/metadata/${encodeURIComponent(ratingKey)}`;
  } catch {
    return null;
  }
}
