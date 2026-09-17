import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { readUserScopedJson, writeUserScopedJson } from '../../lib/userIsolation';

export function normalizePreferredProviderIds(ids: readonly unknown[]): number[] {
  return Array.from(new Set(
    ids
      .map(Number)
      .filter((id) => Number.isFinite(id) && id > 0),
  )).sort((left, right) => left - right);
}

type ProviderPreferenceHydrationDependencies = {
  readLocal?: (uid: string) => number[];
  writeLocal?: (uid: string, ids: number[]) => void;
  readCloud?: (uid: string) => Promise<number[] | null>;
};

const completedUids = new Set<string>();
const inFlightByUid = new Map<string, Promise<number[]>>();

async function defaultReadCloud(uid: string): Promise<number[] | null> {
  const snap = await getDoc(doc(db, 'users', uid, 'settings', 'preferences'));
  if (!snap.exists() || !Array.isArray(snap.data()?.platforms)) return null;
  return normalizePreferredProviderIds(snap.data().platforms);
}

export async function hydratePreferredProviderIds(
  uid: string,
  dependencies: ProviderPreferenceHydrationDependencies = {},
): Promise<number[]> {
  if (!uid) return [];
  const readLocal = dependencies.readLocal || ((userId: string) => (
    normalizePreferredProviderIds(readUserScopedJson<unknown[]>(userId, 'platforms', []))
  ));
  const writeLocal = dependencies.writeLocal || ((userId: string, ids: number[]) => {
    writeUserScopedJson(userId, 'platforms', ids);
  });
  const readCloud = dependencies.readCloud || defaultReadCloud;

  if (completedUids.has(uid)) return readLocal(uid);
  const existing = inFlightByUid.get(uid);
  if (existing) return existing;

  const task = (async () => {
    const local = readLocal(uid);
    try {
      const cloud = await readCloud(uid);
      if (cloud !== null) {
        const normalized = normalizePreferredProviderIds(cloud);
        if (JSON.stringify(normalized) !== JSON.stringify(local)) writeLocal(uid, normalized);
        completedUids.add(uid);
        return normalized;
      }
      completedUids.add(uid);
      return local;
    } finally {
      inFlightByUid.delete(uid);
    }
  })();
  inFlightByUid.set(uid, task);
  return task;
}

export function resetProviderPreferenceHydrationForTests(): void {
  completedUids.clear();
  inFlightByUid.clear();
}
