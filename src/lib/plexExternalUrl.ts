const PLEX_WEB_MEDIA_ROUTE = /^https:\/\/app\.plex\.tv\/desktop\/#!\/server\/([^/]+)\/details\?key=([^&#]+)(?:&.*)?$/i;
const PLEX_METADATA_PREFIX = '/library/metadata/';

/**
 * Reconnaît uniquement une route Web PMS exacte contenant le serveur et le ratingKey.
 * Une URL Discover/universelle ne doit jamais être traitée comme un locator personnel.
 */
export function isExactPlexPmsWebUrl(rawUrl: string): boolean {
  const value = String(rawUrl || '').trim();
  const match = value.match(PLEX_WEB_MEDIA_ROUTE);
  if (!match) return false;

  try {
    const serverId = decodeURIComponent(match[1]).trim();
    const metadataKey = decodeURIComponent(match[2]).trim();
    if (!serverId || !metadataKey.startsWith(PLEX_METADATA_PREFIX)) return false;

    const ratingKey = metadataKey.slice(PLEX_METADATA_PREFIX.length).trim();
    return Boolean(ratingKey);
  } catch {
    return false;
  }
}
