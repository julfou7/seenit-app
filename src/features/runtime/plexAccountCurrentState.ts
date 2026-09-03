/**
 * Lit uniquement un état vu/non-vu EXPLICITE renvoyé par Plex.
 * L'appartenance au Watch History n'est jamais convertie implicitement en "vu".
 */
export function readExplicitPlexCurrentWatchState(payload: any): boolean | null {
  if (!payload || typeof payload !== 'object') return null;

  const candidates = [
    payload,
    payload?.MediaContainer,
    payload?.mediaContainer,
    payload?.MediaContainer?.Metadata?.[0],
    payload?.MediaContainer?.metadata?.[0],
    payload?.mediaContainer?.Metadata?.[0],
    payload?.mediaContainer?.metadata?.[0],
    payload?.Metadata?.[0],
    payload?.metadata?.[0],
    payload?.userState,
    payload?.UserState
  ].filter(Boolean);

  for (const candidate of candidates) {
    const raw = candidate?.viewCount ?? candidate?.view_count;
    if (raw === undefined || raw === null || raw === '') continue;
    if (typeof raw !== 'number' && typeof raw !== 'string') continue;
    const viewCount = Number(raw);
    if (Number.isFinite(viewCount) && viewCount >= 0) return viewCount > 0;
  }

  return null;
}
