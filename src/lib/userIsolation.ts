const USER_STORAGE_PREFIX = 'seenit_user';

export const LEGACY_UNSCOPED_USER_KEYS = [
  'cached_shows_v1',
  'user_platforms',
  'user_notifications',
  'favorite-people-storage',
  'read_news_ids',
  'dismissed_news'
] as const;

export function getUserScopedStorageKey(uid: string, field: string): string {
  if (!uid) throw new Error('UID requis pour accéder à un cache utilisateur');
  return `${USER_STORAGE_PREFIX}:${uid}:${field}`;
}

export function readUserScopedJson<T>(uid: string | null | undefined, field: string, fallback: T): T {
  if (!uid) return fallback;
  try {
    const raw = localStorage.getItem(getUserScopedStorageKey(uid, field));
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

export function writeUserScopedJson(uid: string | null | undefined, field: string, value: unknown): void {
  if (!uid) return;
  try {
    localStorage.setItem(getUserScopedStorageKey(uid, field), JSON.stringify(value));
  } catch {
    // Le cache local est une optimisation : Firestore reste la source de vérité.
  }
}

export function removeUserScopedValue(uid: string | null | undefined, field: string): void {
  if (!uid) return;
  try {
    localStorage.removeItem(getUserScopedStorageKey(uid, field));
  } catch {
    // Aucun impact sur la donnée Cloud.
  }
}

function migrateLegacyValue(uid: string, legacyKey: string, field: string, transform?: (value: any) => any): void {
  const destination = getUserScopedStorageKey(uid, field);
  if (localStorage.getItem(destination) !== null) return;
  const raw = localStorage.getItem(legacyKey);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    const value = transform ? transform(parsed) : parsed;
    if (value !== undefined && value !== null) localStorage.setItem(destination, JSON.stringify(value));
  } catch {
    // Une ancienne valeur invalide est simplement abandonnée.
  }
}

export function purgeLegacyUnscopedUserData(uid?: string | null): void {
  try {
    // Migration uniquement si l’ancien cache prouve son propriétaire. La
    // bibliothèque reste exclue : elle sera toujours reconstruite depuis Firestore.
    if (uid && localStorage.getItem('last_active_uid') === uid) {
      migrateLegacyValue(uid, 'user_platforms', 'platforms');
      migrateLegacyValue(uid, 'user_notifications', 'notifications');
      migrateLegacyValue(uid, 'favorite-people-storage', 'favorite_people', (value) => value?.state?.people);
      const news = localStorage.getItem('read_news_ids') !== null ? 'read_news_ids' : 'dismissed_news';
      migrateLegacyValue(uid, news, 'read_news_ids');
    }
    for (const key of LEGACY_UNSCOPED_USER_KEYS) localStorage.removeItem(key);
  } catch {
    // Certains WebView peuvent refuser localStorage au tout premier démarrage.
  }
}

function stableSerialize(value: unknown, parentKey = ''): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    const items = value.map((item) => stableSerialize(item));
    if (parentKey === 'seenEpisodes') items.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return `[${items.join(',')}]`;
  }
  const objectValue = value as Record<string, unknown>;
  const entries = Object.keys(objectValue)
    .filter((key) => objectValue[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(objectValue[key], key)}`);
  return `{${entries.join(',')}}`;
}

/**
 * Empreinte déterministe de l'état fonctionnel de la bibliothèque.
 * Elle sert à comparer PWA et APK sans exposer le contenu de la bibliothèque.
 */
export function buildLibraryStateSignature(shows: Array<Record<string, any>>): string {
  const canonical = shows
    .map((show) => stableSerialize(show))
    .sort()
    .join('\n');

  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${shows.length}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
