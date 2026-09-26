import { Capacitor, registerPlugin } from '@capacitor/core';

interface SeenItPlexBackgroundPlugin {
  setCredentials(options: { uid: string; token: string }): Promise<void>;
  clearCredentials(options: { uid: string }): Promise<void>;
}

const SeenItPlexBackground = registerPlugin<SeenItPlexBackgroundPlugin>('SeenItPlexBackground');

function persistNativePlexBackgroundCredentials(uid: string, token: string): void {
  if (!Capacitor.isNativePlatform() || !uid || !token) return;
  void SeenItPlexBackground.setCredentials({ uid, token }).catch(() => undefined);
}

function clearNativePlexBackgroundCredentials(uid: string): void {
  if (!Capacitor.isNativePlatform() || !uid) return;
  void SeenItPlexBackground.clearCredentials({ uid }).catch(() => undefined);
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

export function syncNativePlexBackgroundCredentials(uid?: string | null): void {
  if (!uid) return;
  const token = getStoredPlexToken(uid);
  if (token) persistNativePlexBackgroundCredentials(uid, token);
  else clearNativePlexBackgroundCredentials(uid);
}

export function getStoredPlexUsername(uid?: string | null): string {
  if (!uid) return '';
  return localStorage.getItem(getPlexUserStorageKey(uid, 'username')) || '';
}

export function storePlexCredentials(uid: string, token: string, username = ''): void {
  localStorage.setItem(getPlexUserStorageKey(uid, 'token'), token);
  persistNativePlexBackgroundCredentials(uid, token);
  if (username) {
    localStorage.setItem(getPlexUserStorageKey(uid, 'username'), username);
  } else {
    localStorage.removeItem(getPlexUserStorageKey(uid, 'username'));
  }
}

export function clearPlexCredentials(uid?: string | null): void {
  if (!uid) return;
  clearNativePlexBackgroundCredentials(uid);
  localStorage.removeItem(getPlexUserStorageKey(uid, 'token'));
  localStorage.removeItem(getPlexUserStorageKey(uid, 'username'));
  localStorage.removeItem(getPlexUserStorageKey(uid, 'lastSyncTimestamp'));
  localStorage.removeItem(getPlexUserStorageKey(uid, 'resolutionCache'));
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
