export function buildQbitSessionScopeKey(
  uid: string | null | undefined,
  url: string,
  username?: string
): string {
  return `${uid || 'signed-out'}|${url.trim().replace(/\/+$/, '').toLowerCase()}|${String(username || '').trim().toLowerCase()}`;
}
