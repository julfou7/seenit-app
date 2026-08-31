export function nextDownloadSourceBackoffMs(failures: number): number {
  const boundedFailures = Math.max(1, Math.min(8, Math.trunc(failures)));
  return Math.min(5 * 60_000, 5_000 * (2 ** (boundedFailures - 1)));
}

export function shouldFetchNextArrQueuePage(
  pageRecordCount: number,
  totalRecords: number,
  collectedRecords: number,
  pageSize = 100
): boolean {
  if (pageRecordCount < pageSize) return false;
  if (totalRecords > 0 && collectedRecords >= totalRecords) return false;
  return true;
}
