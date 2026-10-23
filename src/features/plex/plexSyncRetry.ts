import { readUserScopedJson, writeUserScopedJson } from '../../lib/userIsolation.ts';

const RETRY_FIELD = 'plex_sync_retry_at';

export function getPlexSyncRetryAt(uid: string | null | undefined, now = Date.now()): number {
  const stored = readUserScopedJson<unknown>(uid, RETRY_FIELD, 0);
  return typeof stored === 'number' && Number.isFinite(stored) && stored > now ? stored : 0;
}

export function rememberPlexSyncRetry(uid: string | null | undefined, retryAt: number): void {
  if (Number.isFinite(retryAt) && retryAt > Date.now()) {
    writeUserScopedJson(uid, RETRY_FIELD, Math.max(getPlexSyncRetryAt(uid), retryAt));
  }
}

export function plexRetryAfter(value?: string | null, now = Date.now()): number {
  const seconds = value?.trim() && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  const target = Number.isFinite(seconds) ? now + seconds * 1000 : value ? Date.parse(value) : NaN;
  return Number.isFinite(target) ? Math.max(now + 1000, target) : now + 60_000;
}

export class PlexSyncHttpError extends Error {
  constructor(readonly status: number, readonly retryAt = 0) {
    super(retryAt > 0
      ? `Synchronisation Plex temporairement en pause. Réessayez dans ${Math.max(1, Math.ceil((retryAt - Date.now()) / 1000))} secondes.`
      : `Service de synchronisation Plex indisponible (HTTP ${status}). Réessayez plus tard.`);
    this.name = 'PlexSyncHttpError';
  }
}
