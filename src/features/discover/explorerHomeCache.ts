/**
 * Retour terrain du 17/11 (Explorer : « afficher direct quelque chose, genre le top 1 puis les 3 premiers dessous ») :
 * la première sélection d'Explorer (à la une + premières cartes) est retenue sur l'appareil. À l'ouverture suivante elle
 * s'affiche aussitôt, puis la réponse TMDB la remplace. Confort local : absente ou illisible, le chargement normal a lieu.
 */
const KEY = 'seenit.explorer.home.v1';
/** À la une + premières lignes de la grille (tranche critique d'Explorer). */
export const EXPLORER_HOME_CACHE_SIZE = 13;
const MAX_AGE_MS = 7 * 24 * 3600_000;

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
const storageOf = (): Storage | undefined => { try { return globalThis.localStorage; } catch { return undefined; } };

export function readExplorerHomeCache<T extends { id: number }>(now = Date.now(), storage: Storage | undefined = storageOf()): T[] {
  try {
    const saved = JSON.parse(storage?.getItem(KEY) || 'null') as { at?: number; items?: T[] } | null;
    if (!saved || !Array.isArray(saved.items) || !(Number(saved.at) > 0) || now - Number(saved.at) > MAX_AGE_MS) return [];
    return saved.items.filter(item => item && Number.isFinite(Number(item.id))).slice(0, EXPLORER_HOME_CACHE_SIZE);
  } catch { return []; }
}

export function writeExplorerHomeCache<T extends { id: number }>(items: readonly T[], now = Date.now(), storage: Storage | undefined = storageOf()): void {
  if (!items.length) return;
  try { storage?.setItem(KEY, JSON.stringify({ at: now, items: items.slice(0, EXPLORER_HOME_CACHE_SIZE) })); } catch { /* stockage plein ou bloqué */ }
}
