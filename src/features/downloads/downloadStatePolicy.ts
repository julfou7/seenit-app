export type DownloadHistorySection = 'completed' | 'cancelled' | 'error';

export interface DownloadStateLike {
  status?: string;
  progress?: number;
  errorMessage?: string | null;
  importState?: 'pending' | 'confirmed';
}

export function hasExplicitDownloadError(item: DownloadStateLike): boolean {
  return item.status === 'error' || Boolean(item.errorMessage?.trim());
}

export function isDownloadCompleted(item: DownloadStateLike): boolean {
  return item.status !== 'cancelled'
    && item.status !== 'warning'
    && item.importState !== 'pending'
    && !hasExplicitDownloadError(item)
    && (item.status === 'completed' || Number(item.progress || 0) >= 100);
}

export function isDownloadActiveOrAttention(item: DownloadStateLike): boolean {
  return hasExplicitDownloadError(item)
    || item.status === 'warning'
    || (item.status !== 'cancelled' && !isDownloadCompleted(item));
}

export function isDownloadInHistorySection(
  item: DownloadStateLike,
  section: DownloadHistorySection
): boolean {
  if (section === 'error') return hasExplicitDownloadError(item) || item.status === 'warning';
  if (section === 'cancelled') return item.status === 'cancelled' && !hasExplicitDownloadError(item);
  return isDownloadCompleted(item);
}
