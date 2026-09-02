export interface DownloadIdentityLike {
  id?: string | null;
  downloadId?: string | null;
  downloadIdAliases?: Array<string | null | undefined> | null;
  releaseTitle?: string | null;
  title?: string | null;
  seriesTitle?: string | null;
  movieTitle?: string | null;
  size?: number | null;
  mediaType?: string | null;
  transferPath?: string | null;
  addedAt?: number | null;
  tmdbId?: number | string | null;
  tvdbId?: number | string | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  quality?: string | null;
  isOptimistic?: boolean | null;
  /** Identifiant interne de la demande SeenIt ayant créé ce transfert. */
  requestId?: string | null;
}

export function normalizeDownloadClientId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  let normalized = String(value).trim().toLowerCase();
  if (!normalized) return null;

  try { normalized = decodeURIComponent(normalized); } catch {}

  const btih = normalized.match(/urn:btih:([a-z0-9]+)/i);
  if (btih?.[1]) normalized = btih[1];

  const btmh = normalized.match(/urn:btmh:(?:1220)?([a-f0-9]{64})/i);
  if (btmh?.[1]) normalized = btmh[1];

  if (normalized.startsWith('qbit_')) normalized = normalized.slice('qbit_'.length);
  if (normalized.startsWith('urn:btih:')) normalized = normalized.slice('urn:btih:'.length);

  return normalized.trim() || null;
}

export function normalizeQualityLabel(rawTitle?: unknown, fallbackQuality?: unknown): string | undefined {
  const raw = [fallbackQuality, rawTitle]
    .filter(value => value !== null && value !== undefined && String(value).trim())
    .map(value => String(value))
    .join(' ')
    .toUpperCase();

  if (!raw || raw === 'UNKNOWN') return undefined;

  const tokens: string[] = [];
  if (/2160P|\b4K\b|\bUHD\b/.test(raw)) tokens.push('4K');
  else if (/1080P|\bFHD\b/.test(raw)) tokens.push('1080p');
  else if (/720P/.test(raw)) tokens.push('720p');

  if (/\bREMUX\b/.test(raw)) tokens.push('REMUX');
  else if (/BLU[- .]?RAY|BLURAY|BDRIP/.test(raw)) tokens.push('BluRay');
  else if (/WEB[- .]?DL|WEBDL|WEBRIP/.test(raw)) tokens.push('WEB-DL');
  else if (/HDTV/.test(raw)) tokens.push('HDTV');
  else if (/DVDRIP|\bDVD\b/.test(raw)) tokens.push('DVD');

  if (/DOLBY[ ._-]?VISION|\bDOVI\b|(?:^|[^A-Z])DV(?:[^A-Z]|$)/.test(raw)) tokens.push('DV');
  if (/HDR10\+|HDR10|(?:^|[^A-Z])HDR(?:[^A-Z]|$)/.test(raw)) tokens.push('HDR');

  return tokens.length ? Array.from(new Set(tokens)).join(' ') : undefined;
}

export function isStrongTorrentHash(value: unknown): boolean {
  const normalized = normalizeDownloadClientId(value);
  if (!normalized) return false;
  return /^[a-f0-9]{40}$/i.test(normalized)
    || /^[a-f0-9]{64}$/i.test(normalized)
    || /^[a-z2-7]{32}$/i.test(normalized);
}

export function getPhysicalDownloadIds(item?: DownloadIdentityLike | null): string[] {
  if (!item) return [];
  const ids = new Set<string>();
  const add = (value: unknown) => {
    const normalized = normalizeDownloadClientId(value);
    if (normalized) ids.add(normalized);
  };

  add(item.downloadId);
  for (const alias of item.downloadIdAliases || []) add(alias);

  const rawId = typeof item.id === 'string' ? item.id.trim() : '';
  if (rawId.toLowerCase().startsWith('qbit_')) add(rawId.slice('qbit_'.length));

  return Array.from(ids);
}

export function getStrongPhysicalDownloadIds(item?: DownloadIdentityLike | null): string[] {
  return getPhysicalDownloadIds(item).filter(isStrongTorrentHash);
}

export function getPhysicalDownloadId(item?: DownloadIdentityLike | null): string | null {
  return getPhysicalDownloadIds(item)[0] || null;
}

export function mergeDownloadIdAliases(...items: Array<DownloadIdentityLike | null | undefined>): string[] {
  const aliases = new Set<string>();
  for (const item of items) {
    for (const id of getPhysicalDownloadIds(item)) aliases.add(id);
  }
  return Array.from(aliases);
}

/**
 * Corrélation interne sûre : le requestId n'est attribué qu'à la demande créée
 * par SeenIt et aux représentations distantes qui lui ont été rattachées.
 */
export function sameDownloadRequest(
  a?: DownloadIdentityLike | null,
  b?: DownloadIdentityLike | null
): boolean {
  const aRequestId = typeof a?.requestId === 'string' ? a.requestId.trim() : '';
  const bRequestId = typeof b?.requestId === 'string' ? b.requestId.trim() : '';
  return Boolean(aRequestId && bRequestId && aRequestId === bRequestId);
}

export function samePhysicalDownload(
  a?: DownloadIdentityLike | null,
  b?: DownloadIdentityLike | null
): boolean {
  const aIds = new Set(getPhysicalDownloadIds(a));
  if (!aIds.size) return false;
  return getPhysicalDownloadIds(b).some(id => aIds.has(id));
}

export function hasConflictingStrongPhysicalIds(
  a?: DownloadIdentityLike | null,
  b?: DownloadIdentityLike | null
): boolean {
  const aIds = getStrongPhysicalDownloadIds(a);
  const bIds = getStrongPhysicalDownloadIds(b);
  if (!aIds.length || !bIds.length) return false;
  const aSet = new Set(aIds);
  return !bIds.some(id => aSet.has(id));
}

export function normalizeTransferPath(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/g, '')
    .toLowerCase();
}

function transferBasename(value: unknown): string {
  const normalized = normalizeTransferPath(value);
  if (!normalized) return '';
  return normalized.split('/').filter(Boolean).pop() || '';
}

export function sameTransferPath(
  a?: DownloadIdentityLike | null,
  b?: DownloadIdentityLike | null
): boolean {
  if (!a || !b) return false;
  const aPath = normalizeTransferPath(a.transferPath);
  const bPath = normalizeTransferPath(b.transferPath);
  if (!aPath || !bPath) return false;
  if (aPath === bPath) return true;

  const aBase = transferBasename(aPath);
  const bBase = transferBasename(bPath);
  if (!aBase || aBase !== bBase) return false;

  const aSize = Number(a.size || 0);
  const bSize = Number(b.size || 0);
  if (aSize <= 0 || bSize <= 0) return false;
  return Math.abs(aSize - bSize) / Math.max(aSize, bSize) <= 0.03;
}


function identityResolutionBucket(item?: DownloadIdentityLike | null): '4k' | '1080p' | '720p' | null {
  const value = `${item?.quality || ''} ${item?.releaseTitle || ''}`.toLowerCase();
  if (/2160|4k|uhd/.test(value)) return '4k';
  if (/1080/.test(value)) return '1080p';
  if (/720/.test(value)) return '720p';
  return null;
}

/**
 * Rattache temporairement une demande SeenIt au transfert qui vient juste
 * d'apparaître avant que *Arr/qBittorrent ne partagent un hash commun.
 * Aucun titre n'est utilisé : uniquement temps, type, IDs canoniques s'ils
 * existent, scope épisode/saison et résolution.
 */
export function canAttachRecentOptimisticRequest(
  request?: DownloadIdentityLike | null,
  remote?: DownloadIdentityLike | null,
  now = Date.now(),
  windowMs = 60_000
): boolean {
  if (!request?.isOptimistic || !remote) return false;
  if (request.mediaType && remote.mediaType && request.mediaType !== remote.mediaType) return false;

  const requestedAt = Number(request.addedAt || 0);
  const remoteAddedAt = Number(remote.addedAt || 0);
  if (!requestedAt || !remoteAddedAt) return false;
  if (requestedAt > now + 5_000 || remoteAddedAt > now + 5_000) return false;

  const delta = remoteAddedAt - requestedAt;
  if (delta < -5_000 || delta > windowMs) return false;

  if (request.tmdbId && remote.tmdbId && Number(request.tmdbId) !== Number(remote.tmdbId)) return false;
  if (request.tvdbId && remote.tvdbId && Number(request.tvdbId) !== Number(remote.tvdbId)) {
    const reqTitle = normalizeDownloadRelease(request.seriesTitle || request.movieTitle || request.title);
    const remTitle = normalizeDownloadRelease(remote.seriesTitle || remote.movieTitle || remote.title);
    if (!reqTitle || !remTitle || reqTitle !== remTitle) {
      return false;
    }
  }

  if (request.mediaType === 'tv') {
    if (request.seriesTitle && remote.seriesTitle) {
      const reqSeries = normalizeDownloadRelease(request.seriesTitle);
      const remSeries = normalizeDownloadRelease(remote.seriesTitle);
      if (reqSeries && remSeries && reqSeries !== remSeries && !reqSeries.includes(remSeries) && !remSeries.includes(reqSeries)) {
        return false;
      }
    }
    if (request.seasonNumber != null && remote.seasonNumber != null
        && Number(request.seasonNumber) !== Number(remote.seasonNumber)) return false;
    if (request.episodeNumber != null && remote.episodeNumber != null
        && Number(request.episodeNumber) !== Number(remote.episodeNumber)) return false;
  }

  if (request.mediaType === 'movie' && request.movieTitle && remote.movieTitle) {
    const reqMovie = normalizeDownloadRelease(request.movieTitle);
    const remMovie = normalizeDownloadRelease(remote.movieTitle);
    if (reqMovie && remMovie && reqMovie !== remMovie && !reqMovie.includes(remMovie) && !remMovie.includes(reqMovie)) {
      return false;
    }
  }

  const requestResolution = identityResolutionBucket(request);
  const remoteResolution = identityResolutionBucket(remote);
  if (requestResolution && remoteResolution && requestResolution !== remoteResolution) return false;

  return true;
}

export function normalizeDownloadRelease(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function normalizeMediaReleaseKey(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.(mkv|mp4|avi|iso)$/i, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\b(2160p?|1080p?|720p?|4k|uhd|fhd)\b/g, ' ')
    .replace(/\b(web[ ._-]?dl|webrip|bluray|blu[ ._-]?ray|bdrip|remux|hdtv|dvdrip)\b/g, ' ')
    .replace(/\b(x26[45]|h26[45]|hevc|av1|hdr10\+?|hdr|dovi|dolby[ ._-]?vision)\b/g, ' ')
    .replace(/\b(multi\d*|truefrench|french|vostfr|vff|vf\d*)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '');
}

export function sameLegacyPhysicalTransfer(
  a?: DownloadIdentityLike | null,
  b?: DownloadIdentityLike | null
): boolean {
  if (!a || !b) return false;
  if (a.mediaType && b.mediaType && a.mediaType !== b.mediaType) return false;

  if (hasConflictingStrongPhysicalIds(a, b)) return false;

  const aSize = Number(a.size || 0);
  const bSize = Number(b.size || 0);
  if (aSize <= 0 || bSize <= 0) return false;
  const sizeDelta = Math.abs(aSize - bSize) / Math.max(aSize, bSize);
  if (sizeDelta > 0.03) return false;

  const aRelease = normalizeDownloadRelease(a.releaseTitle || a.title);
  const bRelease = normalizeDownloadRelease(b.releaseTitle || b.title);
  if (!aRelease || !bRelease) return false;

  if (aRelease === bRelease || aRelease.includes(bRelease) || bRelease.includes(aRelease)) {
    return true;
  }

  // Certains clients reformattent le même nom de release. Ce fallback n'est utilisé
  // que lorsque la taille est pratiquement identique, et jamais entre deux vrais
  // infohash incompatibles.
  if (sizeDelta > 0.005) return false;
  const aMedia = normalizeMediaReleaseKey(a.releaseTitle || a.title);
  const bMedia = normalizeMediaReleaseKey(b.releaseTitle || b.title);
  return Boolean(aMedia && bMedia && aMedia === bMedia);
}

export interface ShowLike {
  mediaType: 'tv' | 'movie';
  tmdbId?: number | string;
  tvdbId?: number | string;
  imdbId?: string;
  title: string;
  originalTitle?: string;
  posterPath?: string;
  backdropPath?: string;
}

/**
 * Recherche la fiche média correspondante dans la bibliothèque SeenIt de l'utilisateur.
 * Priorités : tmdbId, tvdbId, imdbId, puis titre normalisé.
 * Permet de garantir que l'affiche et les métadonnées affichées proviennent toujours
 * de la fiche série/film SeenIt choisie par l'utilisateur.
 */
export function findMatchingShowForDownload<T extends ShowLike>(
  item?: {
    mediaType?: 'tv' | 'movie' | string;
    tmdbId?: number | string;
    tvdbId?: number | string;
    imdbId?: string;
    seriesTitle?: string;
    movieTitle?: string;
    title?: string;
    releaseTitle?: string;
  } | null,
  shows?: T[] | null
): T | undefined {
  if (!item || !shows || shows.length === 0) return undefined;
  const mediaType = item.mediaType === 'movie' ? 'movie' : 'tv';

  // 1. Match par tmdbId
  if (item.tmdbId) {
    const match = shows.find(s => s.mediaType === mediaType && Number(s.tmdbId) === Number(item.tmdbId));
    if (match) return match;
  }

  // 2. Match par tvdbId
  if (item.tvdbId) {
    const match = shows.find(s => s.mediaType === mediaType && s.tvdbId && Number(s.tvdbId) === Number(item.tvdbId));
    if (match) return match;
  }

  // 3. Match par imdbId
  if (item.imdbId) {
    const cleanImdb = String(item.imdbId).trim().toLowerCase();
    const match = shows.find(s => s.mediaType === mediaType && s.imdbId && String(s.imdbId).trim().toLowerCase() === cleanImdb);
    if (match) return match;
  }

  // 4. Match par titre normalisé
  const candidateTitle = item.seriesTitle || item.movieTitle || item.title;
  let normalized = normalizeDownloadRelease(candidateTitle);
  // Nettoyer d'éventuels suffixes d'épisode / saison
  normalized = normalized.replace(/(?:s\d{1,2}[e._-]?\d{1,2}|\d{1,2}x\d{1,2}|saison\d+|season\d+)$/i, '');
  if (normalized && normalized.length >= 2) {
    const match = shows.find(s => {
      if (s.mediaType !== mediaType) return false;
      const sTitle = normalizeDownloadRelease(s.title);
      if (sTitle && sTitle === normalized) return true;
      const sOriginal = s.originalTitle ? normalizeDownloadRelease(s.originalTitle) : '';
      if (sOriginal && sOriginal === normalized) return true;
      return false;
    });
    if (match) return match;
  }

  return undefined;
}

