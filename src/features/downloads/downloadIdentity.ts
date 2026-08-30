export interface DownloadIdentityLike {
  id?: string | null;
  downloadId?: string | null;
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
