import type { LiveDownloadItem } from '../../services/sonarrRadarr';

function resolutionBucket(item: Partial<LiveDownloadItem>): '4k' | '1080p' | '720p' | null {
  const value = `${item.quality || ''} ${item.releaseTitle || ''} ${item.title || ''}`.toLowerCase();
  if (/2160|4k|uhd/.test(value)) return '4k';
  if (/1080/.test(value)) return '1080p';
  if (/720/.test(value)) return '720p';
  return null;
}

export function inferTechnicalTvScope(value: unknown): { seasonNumber?: number; episodeNumber?: number } | null {
  const raw = String(value || '');
  const se = raw.match(/(?:^|[^a-z0-9])s(\d{1,2})(?:[ ._\-]*e(\d{1,3}))?(?:[^a-z0-9]|$)/i);
  if (se) {
    return {
      seasonNumber: Number(se[1]),
      episodeNumber: se[2] ? Number(se[2]) : undefined
    };
  }

  const xe = raw.match(/(?:^|[^0-9])(\d{1,2})x(\d{1,3})(?:[^0-9]|$)/i);
  if (xe) {
    return { seasonNumber: Number(xe[1]), episodeNumber: Number(xe[2]) };
  }

  return null;
}

/**
 * qBittorrent peut apparaître avant Sonarr et ne fournir alors aucun ID média.
 * On n'utilise jamais le titre pour identifier la série : seuls les marqueurs
 * techniques Sxx/Eyy servent à corriger le scope TV transitoire.
 */
export function normalizeUnresolvedQbitScope(item: LiveDownloadItem): LiveDownloadItem {
  const isQbit = item.id.startsWith('qbit_') || String(item.downloadClient || '').toLowerCase().includes('qbittorrent');
  if (!isQbit || item.tmdbId || item.tvdbId || item.imdbId) return item;

  const scope = inferTechnicalTvScope(item.releaseTitle || item.title);
  if (!scope) return item;

  return {
    ...item,
    mediaType: 'tv',
    seasonNumber: item.seasonNumber ?? scope.seasonNumber,
    episodeNumber: item.episodeNumber ?? scope.episodeNumber
  };
}

function compatiblePendingRequests(
  remote: LiveDownloadItem,
  pendingRequests: LiveDownloadItem[],
  now: number,
  windowMs: number
): LiveDownloadItem[] {
  const remoteAt = Number(remote.addedAt || 0);
  if (!remoteAt || remoteAt > now + 5_000) return [];
  const remoteResolution = resolutionBucket(remote);

  return pendingRequests.filter(request => {
    if (!request.isOptimistic) return false;
    if (request.status === 'completed' || request.status === 'cancelled' || request.status === 'error') return false;
    if (request.mediaType !== remote.mediaType) return false;

    const requestAt = Number(request.addedAt || 0);
    if (!requestAt || requestAt > now + 5_000) return false;
    const delta = remoteAt - requestAt;
    if (delta < -5_000 || delta > windowMs) return false;

    const requestResolution = resolutionBucket(request);
    if (requestResolution && remoteResolution && requestResolution !== remoteResolution) return false;

    if (remote.mediaType === 'tv') {
      if (request.seasonNumber != null && remote.seasonNumber != null
          && Number(request.seasonNumber) !== Number(remote.seasonNumber)) return false;
      if (request.episodeNumber != null && remote.episodeNumber != null
          && Number(request.episodeNumber) !== Number(remote.episodeNumber)) return false;
    }

    return true;
  });
}

/**
 * Un seul candidat reste visible : le handshake existant peut alors l'enrichir et
 * conserver sa télémétrie qBit. Avec plusieurs demandes compatibles simultanées,
 * choisir serait arbitraire ; le torrent brut est donc masqué jusqu'à l'arrivée
 * d'un hash/ID *Arr exact, sans aucun rapprochement par titre.
 */
export function shouldSuppressUnresolvedQbit(
  remote: LiveDownloadItem,
  pendingRequests: LiveDownloadItem[],
  now = Date.now(),
  windowMs = 120_000
): boolean {
  const isQbit = remote.id.startsWith('qbit_') || String(remote.downloadClient || '').toLowerCase().includes('qbittorrent');
  if (!isQbit || remote.tmdbId || remote.tvdbId || remote.imdbId) return false;
  if (remote.status === 'completed' || remote.status === 'cancelled' || remote.status === 'error' || Number(remote.progress || 0) >= 100) return false;

  return compatiblePendingRequests(remote, pendingRequests, now, windowMs).length > 1;
}
