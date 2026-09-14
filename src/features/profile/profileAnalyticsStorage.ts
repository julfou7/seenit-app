import Dexie, { type Table } from 'dexie';
import {
  isValidProfileAnalyticsSnapshot,
  type ProfileAnalyticsSnapshot,
} from './profileAnalyticsSnapshot.ts';

const PROFILE_ANALYTICS_DATABASE = 'SeenItProfileAnalytics';

class ProfileAnalyticsDatabase extends Dexie {
  snapshots!: Table<ProfileAnalyticsSnapshot, string>;

  constructor() {
    super(PROFILE_ANALYTICS_DATABASE);
    this.version(1).stores({ snapshots: '&uid, updatedAt' });
  }
}

let database: ProfileAnalyticsDatabase | null | undefined;

const getDatabase = (): ProfileAnalyticsDatabase | null => {
  if (database !== undefined) return database;
  if (typeof indexedDB === 'undefined') {
    database = null;
    return database;
  }
  database = new ProfileAnalyticsDatabase();
  return database;
};

export async function readProfileAnalyticsWorkingSnapshot(
  uid: string,
): Promise<ProfileAnalyticsSnapshot | null> {
  const currentDatabase = getDatabase();
  if (!currentDatabase) return null;

  try {
    const stored = await currentDatabase.snapshots.get(uid);
    if (!stored) return null;
    if (isValidProfileAnalyticsSnapshot(stored, uid)) return stored;
    await currentDatabase.snapshots.delete(uid);
  } catch {
    // IndexedDB peut être indisponible en navigation privée : la baseline compacte
    // garde malgré tout le dernier résultat affichable dans localStorage.
  }
  return null;
}

export async function writeProfileAnalyticsWorkingSnapshot(
  snapshot: ProfileAnalyticsSnapshot,
): Promise<boolean> {
  const currentDatabase = getDatabase();
  if (!currentDatabase || !isValidProfileAnalyticsSnapshot(snapshot, snapshot.uid)) return false;

  try {
    await currentDatabase.transaction('rw', currentDatabase.snapshots, async () => {
      const current = await currentDatabase.snapshots.get(snapshot.uid);
      if (current && current.updatedAt > snapshot.updatedAt) return;
      await currentDatabase.snapshots.put(snapshot);
    });
    return true;
  } catch {
    return false;
  }
}
