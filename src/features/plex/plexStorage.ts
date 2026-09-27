import { Capacitor, registerPlugin } from '@capacitor/core';
import { resolveSeenItApiUrl } from '../../lib/seenitApi.ts';

interface SeenItPlexBackgroundPlugin {
  setCredentials(options: { uid: string; token: string }): Promise<void>;
  clearCredentials(options: { uid: string }): Promise<void>;
  readDiagnostics(options: { uid: string }): Promise<{ events?: unknown[]; beforeTimestamp?: string }>;
  clearDiagnostics(options: { uid: string; beforeTimestamp: string }): Promise<void>;
}

const SeenItPlexBackground = registerPlugin<SeenItPlexBackgroundPlugin>('SeenItPlexBackground');

export const PLEX_BACKGROUND_CAPABILITY_CHANGED_EVENT = 'seenit-plex-background-capability-changed';

export interface NativePlexAvailabilityDiagnosticEvent {
  traceId: string;
  stage: string;
  outcome: string;
  attempt: number;
  timestamp: number;
}

export interface NativePlexAvailabilityDiagnosticFlush {
  events: NativePlexAvailabilityDiagnosticEvent[];
  uploaded: boolean;
}

const TRACE_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const TRACE_WORD_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

function normalizeNativePlexAvailabilityEvents(value: unknown): NativePlexAvailabilityDiagnosticEvent[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 120).flatMap(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const event = raw as Record<string, unknown>;
    const traceId = String(event.traceId || '').trim();
    const stage = String(event.stage || '').trim();
    const outcome = String(event.outcome || '').trim();
    const attempt = Number(event.attempt);
    const timestamp = Number(event.timestamp);
    if (
      !TRACE_ID_PATTERN.test(traceId)
      || !TRACE_WORD_PATTERN.test(stage)
      || !TRACE_WORD_PATTERN.test(outcome)
      || !Number.isInteger(attempt)
      || attempt < 0
      || attempt > 12
      || !Number.isFinite(timestamp)
      || timestamp < 1
    ) return [];
    return [{ traceId, stage, outcome, attempt, timestamp: Math.floor(timestamp) }];
  });
}

export async function flushNativePlexAvailabilityDiagnostics(
  uid: string,
  idToken: string,
  options: { fetchImpl?: typeof fetch } = {}
): Promise<NativePlexAvailabilityDiagnosticFlush> {
  if (!Capacitor.isNativePlatform() || !uid || idToken.length < 20) {
    return { events: [], uploaded: false };
  }
  const snapshot = await SeenItPlexBackground.readDiagnostics({ uid }).catch(() => null);
  const events = normalizeNativePlexAvailabilityEvents(snapshot?.events);
  const beforeTimestamp = String(snapshot?.beforeTimestamp || '');
  if (events.length === 0) return { events, uploaded: false };

  try {
    const response = await (options.fetchImpl || fetch)(resolveSeenItApiUrl('/api/diagnostics/plex-availability'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ schemaVersion: 1, events }),
    });
    if (!response.ok) return { events, uploaded: false };
    if (/^[1-9]\d{0,15}$/.test(beforeTimestamp)) {
      await SeenItPlexBackground.clearDiagnostics({ uid, beforeTimestamp }).catch(() => undefined);
    }
    return { events, uploaded: true };
  } catch {
    return { events, uploaded: false };
  }
}

function notifyPlexBackgroundCapabilityChanged(): void {
  if (typeof window === 'undefined' || !Capacitor.isNativePlatform()) return;
  window.dispatchEvent(new Event(PLEX_BACKGROUND_CAPABILITY_CHANGED_EVENT));
}

async function persistNativePlexBackgroundCredentials(uid: string, token: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || !uid || !token) return false;
  try {
    await SeenItPlexBackground.setCredentials({ uid, token });
    return true;
  } catch {
    return false;
  }
}

async function clearNativePlexBackgroundCredentials(uid: string): Promise<void> {
  if (!Capacitor.isNativePlatform() || !uid) return;
  await SeenItPlexBackground.clearCredentials({ uid }).catch(() => undefined);
}

export type PlexUserStorageField =
  | 'token'
  | 'username'
  | 'lastSyncTimestamp'
  | 'resolutionCache'
  | 'slugPurgeVersion';

export type PlexResolutionCache = Record<string, unknown>;

const ACTIVE_UID_KEY = 'seenit_plex_active_uid';
const LEGACY_KEYS = [
  'plex_auth_token',
  'plex_token',
  'plex_username',
  'plex_last_sync_timestamp',
  'plex_resolution_cache',
  'seenit_plex_slugs_purged_v1.4.17'
];

export function getPlexUserStorageKey(uid: string, field: PlexUserStorageField): string {
  return `seenit_plex:${uid}:${field}`;
}

export function getStoredPlexToken(uid?: string | null): string | null {
  if (!uid) return null;
  return localStorage.getItem(getPlexUserStorageKey(uid, 'token'));
}

export async function syncNativePlexBackgroundCredentials(uid?: string | null): Promise<boolean> {
  if (!uid || !Capacitor.isNativePlatform()) return false;
  const token = getStoredPlexToken(uid);
  if (token) return persistNativePlexBackgroundCredentials(uid, token);
  await clearNativePlexBackgroundCredentials(uid);
  return false;
}

export function getStoredPlexUsername(uid?: string | null): string {
  if (!uid) return '';
  return localStorage.getItem(getPlexUserStorageKey(uid, 'username')) || '';
}

export function storePlexCredentials(uid: string, token: string, username = ''): void {
  localStorage.setItem(getPlexUserStorageKey(uid, 'token'), token);
  void persistNativePlexBackgroundCredentials(uid, token).then(ready => {
    if (ready) notifyPlexBackgroundCapabilityChanged();
  });
  if (username) {
    localStorage.setItem(getPlexUserStorageKey(uid, 'username'), username);
  } else {
    localStorage.removeItem(getPlexUserStorageKey(uid, 'username'));
  }
}

export function clearPlexCredentials(uid?: string | null): void {
  if (!uid) return;
  localStorage.removeItem(getPlexUserStorageKey(uid, 'token'));
  localStorage.removeItem(getPlexUserStorageKey(uid, 'username'));
  localStorage.removeItem(getPlexUserStorageKey(uid, 'lastSyncTimestamp'));
  localStorage.removeItem(getPlexUserStorageKey(uid, 'resolutionCache'));
  void clearNativePlexBackgroundCredentials(uid).finally(() => {
    // Le serveur doit cesser les vérifications silencieuses même si le plugin
    // natif refuse le nettoyage : annoncer "non capable" reste fail-closed.
    notifyPlexBackgroundCapabilityChanged();
  });
}

export function getPlexLastSyncTimestamp(uid?: string | null): number | undefined {
  if (!uid) return undefined;
  const raw = localStorage.getItem(getPlexUserStorageKey(uid, 'lastSyncTimestamp'));
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) ? value : undefined;
}

export function setPlexLastSyncTimestamp(uid: string, timestamp: number): void {
  localStorage.setItem(getPlexUserStorageKey(uid, 'lastSyncTimestamp'), String(timestamp));
}

export function getPlexResolutionCache(uid: string): PlexResolutionCache {
  try {
    const raw = localStorage.getItem(getPlexUserStorageKey(uid, 'resolutionCache'));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const PLEX_RESOLUTION_CACHE_MAX_ITEMS = 400;
const PLEX_RESOLUTION_FIELDS = [
  'id',
  'title',
  'name',
  'original_title',
  'original_name',
  'poster_path',
  'backdrop_path',
  'release_date',
  'first_air_date'
] as const;

export function compactPlexResolutionCache(cache: PlexResolutionCache): PlexResolutionCache {
  const keys = Object.keys(cache);
  const retainedKeys = keys.slice(-PLEX_RESOLUTION_CACHE_MAX_ITEMS);
  return Object.fromEntries(retainedKeys.flatMap((key) => {
    const source = cache[key];
    if (!source || typeof source !== 'object' || Array.isArray(source)) return [];
    const entry = source as Record<string, unknown>;
    if (!Number.isFinite(Number(entry.id))) return [];
    const compact = Object.fromEntries(
      PLEX_RESOLUTION_FIELDS
        .filter((field) => entry[field] !== undefined && entry[field] !== null)
        .map((field) => [field, entry[field]])
    );
    return [[key, compact]];
  }));
}

export function mergePlexResolutionCaches(
  localCache: PlexResolutionCache,
  cloudCache: PlexResolutionCache
): PlexResolutionCache {
  return compactPlexResolutionCache({ ...localCache, ...cloudCache });
}

export function setPlexResolutionCache(uid: string, cache: PlexResolutionCache): void {
  const value = compactPlexResolutionCache(cache);
  localStorage.setItem(getPlexUserStorageKey(uid, 'resolutionCache'), JSON.stringify(value));
}

export function activatePlexUserScope(uid?: string | null): boolean {
  const previousUid = localStorage.getItem(ACTIVE_UID_KEY);
  const changed = previousUid !== (uid || null);

  if (previousUid && previousUid !== uid) {
    clearPlexCredentials(previousUid);
  }

  for (const key of LEGACY_KEYS) localStorage.removeItem(key);

  if (uid) {
    localStorage.setItem(ACTIVE_UID_KEY, uid);
  } else {
    localStorage.removeItem(ACTIVE_UID_KEY);
  }

  return changed;
}
