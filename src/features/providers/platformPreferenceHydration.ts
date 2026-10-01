import { readUserScopedJson, writeUserScopedJson, subscribeUserScopedStorageField } from '../../lib/userIsolation.ts';

interface PlatformPreferenceCloud {
  read: () => Promise<unknown>;
  save: (platforms: number[]) => Promise<unknown>;
}

const pendingHydrations = new Map<string, Promise<void>>();

export function normalizePlatformPreferenceIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter(id => Number.isFinite(id) && id > 0))].sort((a, b) => a - b);
}

/** Lecture session partagée : une réponse retardée ne remplace jamais un nouveau choix local. */
export function hydratePlatformPreferences(uid: string, cloud: PlatformPreferenceCloud): Promise<void> {
  const pending = pendingHydrations.get(uid);
  if (pending) return pending;
  const readLocal = () => normalizePlatformPreferenceIds(readUserScopedJson<unknown>(uid, 'platforms', []));
  const before = JSON.stringify(readLocal());
  let locallyChanged = false;
  const unsubscribe = subscribeUserScopedStorageField(uid, 'platforms', () => { locallyChanged = true; });
  const hydration = Promise.resolve().then(async () => {
    const remote = await cloud.read();
    const local = readLocal();
    if (locallyChanged || JSON.stringify(local) !== before) {
      await cloud.save(local);
    } else if (Array.isArray(remote)) {
      writeUserScopedJson(uid, 'platforms', normalizePlatformPreferenceIds(remote));
    } else if (local.length > 0) {
      await cloud.save(local);
    }
  }).finally(() => {
    unsubscribe();
    pendingHydrations.delete(uid);
  });
  pendingHydrations.set(uid, hydration);
  return hydration;
}
