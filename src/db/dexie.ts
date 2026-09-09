const LEGACY_OMDB_DATABASE = 'ShowTrackerDB';
let cleanupStarted = false;

/**
 * Supprime une fois l'ancienne base locale qui ne contenait que les caches OMDb.
 * L'échec est non bloquant : aucun état métier SeenIt n'est stocké dans cette base.
 */
export async function cleanOldCache(): Promise<void> {
  if (cleanupStarted || typeof indexedDB === 'undefined') return;
  cleanupStarted = true;

  await new Promise<void>((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(LEGACY_OMDB_DATABASE);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}
