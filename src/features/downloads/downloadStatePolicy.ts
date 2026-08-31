export type DownloadHistorySection = 'completed' | 'cancelled' | 'error';

export interface DownloadStateLike {
  status?: string;
  progress?: number;
}

export function isDownloadActiveOrAttention(item: DownloadStateLike): boolean {
  return item.status === 'error'
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
  if (section === 'cancelled') return item.status === 'cancelled';
  if (section === 'error') return item.status === 'error';
  return item.status !== 'cancelled'
    && item.status !== 'error'
    && (item.status === 'completed' || Number(item.progress || 0) >= 100);
}
