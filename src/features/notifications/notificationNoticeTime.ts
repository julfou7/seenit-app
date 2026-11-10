/** Horodatages de la boîte interne, distincts des dates métier (diffusion, import, disponibilité Plex). */
export const NOTICE_FIRST_SEEN_FIELD = 'home_notice_first_seen_v1';

export function isValidNoticeTime(value: unknown, now = Date.now()): value is number {
  return typeof value === 'number' && Number.isFinite(value)
    && value >= Date.UTC(2020, 0, 1) && value <= now + 60_000;
}

export function reconcileFirstSeen(
  previous: Record<string, number>,
  ids: readonly string[],
  now: number,
  limit = 500,
): { times: Record<string, number>; changed: boolean } {
  const stored = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {};
  const entries = Object.entries(stored).filter(([, value]) => isValidNoticeTime(value, now));
  const times = new Map(entries);
  for (const id of new Set(ids)) if (id && !times.has(id)) times.set(id, now);
  const retained = [...times.entries()].slice(-Math.max(limit, ids.length));
  const result = Object.fromEntries(retained);
  const original = Object.entries(stored);
  const changed = original.length !== retained.length || retained.some(([key, value], index) =>
    original[index]?.[0] !== key || original[index]?.[1] !== value);
  return { times: result, changed };
}

export function formatNoticeTime(
  value: unknown,
  provenance: 'received' | 'first-seen',
  timeZone?: string,
): string | null {
  if (!isValidNoticeTime(value)) return null;
  const date = new Date(value);
  const day = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone }).format(date);
  const hour = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(date);
  return `${provenance === 'received' ? 'Reçue' : 'Repérée'} le ${day} · ${hour}`;
}
