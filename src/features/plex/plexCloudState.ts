import { db } from '../../lib/firebase';
import { doc, getDocFromServer, runTransaction } from 'firebase/firestore';
import { mergePlexResolutionCaches } from './plexStorage';

export async function loadPlexCloudState(userId: string): Promise<Record<string, unknown>> {
  const snapshot = await getDocFromServer(doc(db, 'users', userId, 'settings', 'plex'));
  return snapshot.exists() ? snapshot.data() : {};
}

export async function persistPlexCloudState(
  userId: string,
  values: { lastSyncTimestamp?: number; resolutionCache?: Record<string, unknown> }
): Promise<void> {
  const plexRef = doc(db, 'users', userId, 'settings', 'plex');
  await runTransaction(db, async (transaction) => {
    const currentSnapshot = await transaction.get(plexRef);
    const current = currentSnapshot.exists() ? currentSnapshot.data() : {};
    const next: Record<string, unknown> = {};

    if (values.lastSyncTimestamp !== undefined) {
      next.lastSyncTimestamp = Math.max(
        Number(current.lastSyncTimestamp) || 0,
        values.lastSyncTimestamp
      );
    }
    if (values.resolutionCache) {
      next.resolutionCache = mergePlexResolutionCaches(
        current.resolutionCache || {},
        values.resolutionCache
      );
    }

    transaction.set(plexRef, next, { merge: true });
  });
}
