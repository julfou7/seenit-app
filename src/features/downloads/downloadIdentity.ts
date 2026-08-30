export interface DownloadIdentityLike {
  id?: string | null;
  downloadId?: string | null;
  downloadIdAliases?: Array<string | null | undefined> | null;
  releaseTitle?: string | null;
  title?: string | null;
  size?: number | null;
  mediaType?: string | null;
}

export function normalizeDownloadClientId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  let normalized = String(value).trim().toLowerCase();
  if (!normalized) return null;

  try { normalized = decodeURIComponent(normalized); } catch {}

  // Magnet v1 : magnet:?xt=urn:btih:<hash>
  const btih = normalized.match(/urn:btih:([a-z0-9]+)/i);
  if (btih?.[1]) normalized = btih[1];

  // Magnet v2 : urn:btmh:1220<sha256>. Le préfixe multihash 1220 ne fait
  // pas partie de l'infohash v2 exposé par qBittorrent.
  const btmh = normalized.match(/urn:btmh:(?:1220)?([a-f0-9]{64})/i);
  if (btmh?.[1]) normalized = btmh[1];

  if (normalized.startsWith('qbit_')) normalized = normalized.slice('qbit_'.length);
  if (normalized.startsWith('urn:btih:')) normalized = normalized.slice('urn:btih:'.length);

  return normalized.trim() || null;
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

export function normalizeDownloadRelease(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function sameLegacyPhysicalTransfer(
  a?: DownloadIdentityLike | null,
  b?: DownloadIdentityLike | null
): boolean {
  if (!a || !b) return false;
  if (a.mediaType && b.mediaType && a.mediaType !== b.mediaType) return false;

  // Deux vrais infohash incompatibles restent deux torrents distincts.
  if (hasConflictingStrongPhysicalIds(a, b)) return false;

  const aSize = Number(a.size || 0);
  const bSize = Number(b.size || 0);
  if (aSize <= 0 || bSize <= 0) return false;
  const sizeDelta = Math.abs(aSize - bSize) / Math.max(aSize, bSize);
  if (sizeDelta > 0.03) return false;

  const aRelease = normalizeDownloadRelease(a.releaseTitle || a.title);
  const bRelease = normalizeDownloadRelease(b.releaseTitle || b.title);
  if (!aRelease || !bRelease) return false;

  return aRelease === bRelease || aRelease.includes(bRelease) || bRelease.includes(aRelease);
}
