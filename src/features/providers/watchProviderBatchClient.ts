import { tryCatch } from '../../core/Result';
import { authenticatedFetch } from '../../lib/apiAuth';

/** #853 : fenêtre de regroupement des diffuseurs des cartes et taille d'un lot (borne de la route backend). */
export const WATCH_PROVIDER_BATCH_WINDOW_MS = 24;
export const WATCH_PROVIDER_BATCH_MAX_ITEMS = 40;

/**
 * Regroupe les demandes de diffuseurs (`movie:ID` / `tv:ID`) arrivées dans la même fenêtre en une requête
 * `/api/media/watch-providers`. Une entrée absente du lot (route indisponible, panne fournisseur) se résout
 * à `null` : l'appelant redemande alors ce titre seul.
 */
export function createWatchProviderBatcher<T>() {
  const queue = new Map<string, Array<(providers: T | null) => void>>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    const queued = [...queue.entries()];
    queue.clear();
    for (let offset = 0; offset < queued.length; offset += WATCH_PROVIDER_BATCH_MAX_ITEMS) {
      const chunk = queued.slice(offset, offset + WATCH_PROVIDER_BATCH_MAX_ITEMS);
      void (async () => {
        const byKey = new Map<string, T>();
        const response = await tryCatch(authenticatedFetch(`/api/media/watch-providers?items=${encodeURIComponent(chunk.map(([key]) => key).join(','))}`));
        if ('value' in response && response.value.ok) {
          const payload = await tryCatch(response.value.json() as Promise<{ results?: Array<{ key?: unknown; providers?: unknown }> }>);
          const entries = 'value' in payload && Array.isArray(payload.value?.results) ? payload.value.results : [];
          for (const entry of entries) {
            if (typeof entry?.key === 'string' && entry.providers && typeof entry.providers === 'object') byKey.set(entry.key, entry.providers as T);
          }
        }
        for (const [key, waiters] of chunk) for (const resolve of waiters) resolve(byKey.get(key) ?? null);
      })();
    }
  };

  return {
    request(key: string): Promise<T | null> {
      return new Promise(resolve => {
        const waiters = queue.get(key) || [];
        waiters.push(resolve);
        queue.set(key, waiters);
        if (timer === null) timer = setTimeout(flush, WATCH_PROVIDER_BATCH_WINDOW_MS);
      });
    },
  };
}
