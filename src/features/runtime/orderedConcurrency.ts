/**
 * SEENIT-PLEX-012 — Exécute `worker` sur chaque élément avec au plus `limit` tâches simultanées et
 * renvoie les résultats dans l'ordre d'entrée : la fusion reste identique à une boucle séquentielle.
 * Une erreur d'un worker est propagée (les workers de la synchro capturent leurs propres échecs).
 */
export async function mapOrderedWithConcurrency<T, R>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}
