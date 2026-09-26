export type DownloadHistorySection = 'completed' | 'cancelled' | 'error';

export interface DownloadStateLike {
  status?: string;
  progress?: number;
  errorMessage?: string | null;
}

export function hasExplicitDownloadError(item: DownloadStateLike): boolean {
  return item.status === 'error' || Boolean(item.errorMessage?.trim());
}

export function isDownloadCompleted(item: DownloadStateLike): boolean {
  return item.status !== 'cancelled'
    && !hasExplicitDownloadError(item)
    && (item.status === 'completed' || Number(item.progress || 0) >= 100);
}

export function isDownloadActiveOrAttention(item: DownloadStateLike): boolean {
  return hasExplicitDownloadError(item)
    || item.status === 'warning'
    || (
      item.status !== 'completed'
      && item.status !== 'cancelled'
      && Number(item.progress || 0) < 100
    );
}

export function isDownloadInHistorySection(
  item: DownloadStateLike,
  section: DownloadHistorySection
): boolean {
  if (section === 'error') return hasExplicitDownloadError(item);
  if (section === 'cancelled') return item.status === 'cancelled' && !hasExplicitDownloadError(item);
  return isDownloadCompleted(item);
}
