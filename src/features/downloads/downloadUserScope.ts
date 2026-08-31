export function buildLiveDownloadStorageKey(uid: string): string {
  return `seenit_live_downloads_v4:${uid}`;
}

export function isDownloadRequestScopeCurrent(
  request: { uid: string | null; epoch: number },
  current: { uid: string | null; epoch: number }
): boolean {
  return request.uid === current.uid && request.epoch === current.epoch;
}
