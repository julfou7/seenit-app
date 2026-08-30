export interface DownloadIdentityLike {
  id?: string | null;
  downloadId?: string | null;
  releaseTitle?: string | null;
  title?: string | null;
  size?: number | null;
  mediaType?: string | null;
}

export function normalizeDownloadClientId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  let normalized = String(value).trim().toLowerCase();
  if (!normalized) return null;

  if (normalized.startsWith('qbit_')) normalized = normalized.slice('qbit_'.length);
  if (normalized.startsWith('urn:btih:')) normalized = normalized.slice('urn:btih:'.length);

  return normalized.trim() || null;
}

export function getPhysicalDownloadId(item?: DownloadIdentityLike | null): string | null {
  if (!item) return null;

  const explicit = normalizeDownloadClientId(item.downloadId);
  if (explicit) return explicit;

  const rawId = typeof item.id === 'string' ? item.id.trim() : '';
  if (rawId.toLowerCase().startsWith('qbit_')) {
    return normalizeDownloadClientId(rawId.slice('qbit_'.length));
  }

  return null;
}

export function samePhysicalDownload(
  a?: DownloadIdentityLike | null,
  b?: DownloadIdentityLike | null
): boolean {
  const aId = getPhysicalDownloadId(a);
  const bId = getPhysicalDownloadId(b);
  return Boolean(aId && bId && aId === bId);
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

  const aSize = Number(a.size || 0);
  const bSize = Number(b.size || 0);
  if (aSize <= 0 || bSize <= 0) return false;
  const sizeDelta = Math.abs(aSize - bSize) / Math.max(aSize, bSize);
  if (sizeDelta > 0.015) return false;

  const aRelease = normalizeDownloadRelease(a.releaseTitle || a.title);
  const bRelease = normalizeDownloadRelease(b.releaseTitle || b.title);
  if (!aRelease || !bRelease) return false;

  return aRelease === bRelease || aRelease.includes(bRelease) || bRelease.includes(aRelease);
}
