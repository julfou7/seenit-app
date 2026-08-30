export interface DownloadIdentityLike {
  id?: string | null;
  downloadId?: string | null;
  downloadIdAliases?: Array<string | null | undefined> | null;
  releaseTitle?: string | null;
  title?: string | null;
  size?: number | null;
  mediaType?: string | null;
  transferPath?: string | null;
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
