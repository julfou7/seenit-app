import { authenticatedFetch } from '../../lib/apiAuth';
import {
  applyCinemaEvidenceToSearchResults,
  movieSearchEvidenceKey,
} from './cinemaSearchEvidenceCore';

export { CINEMA_SEARCH_EVIDENCE_SCHEMA, applyCinemaEvidenceToSearchResults } from './cinemaSearchEvidenceCore';

const CINEMA_SEARCH_BATCH_MAX_ITEMS = 40;

interface BatchCinemaEntry {
  key?: string;
  details?: unknown;
}

export async function enrichCinemaEvidenceForMediaResults<T>(
  results: T[],
  signal?: AbortSignal,
): Promise<T[]> {
  const keys = [...new Set(results.map(movieSearchEvidenceKey).filter((key): key is string => Boolean(key)))]
    .slice(0, CINEMA_SEARCH_BATCH_MAX_ITEMS);
  if (keys.length === 0 || signal?.aborted) return results;

  try {
    const response = await authenticatedFetch(
      `/api/media/parental-ratings?items=${encodeURIComponent(keys.join(','))}&cinema=1`,
      { signal },
    );
    if (!response.ok) return results;
    const payload = await response.json() as { results?: BatchCinemaEntry[] };
    if (!Array.isArray(payload?.results)) return results;

    const detailsByKey = new Map<string, unknown | null>();
    for (const entry of payload.results) {
      if (typeof entry?.key !== 'string') continue;
      detailsByKey.set(entry.key, entry.details ?? null);
    }
    return applyCinemaEvidenceToSearchResults(results, detailsByKey);
  } catch {
    return results;
  }
}

export async function enrichCinemaEvidenceForExplorerLists<T>(
  results: T[],
  featured: T[] | null,
  signal?: AbortSignal,
): Promise<[T[], T[] | null]> {
  const enriched = await enrichCinemaEvidenceForMediaResults(results, signal);
  if (!featured) return [enriched, featured];

  const enrichedByKey = new Map<string, T>();
  for (const item of enriched) {
    const key = movieSearchEvidenceKey(item);
    if (key) enrichedByKey.set(key, item);
  }
  return [enriched, featured.map(item => {
    const key = movieSearchEvidenceKey(item);
    return key ? enrichedByKey.get(key) ?? item : item;
  })];
}

// Compatibilité du chemin de recherche historique : la même preuve batch est désormais
// réutilisée par toutes les listes Explorer, pas seulement par smartSearchMulti.
export const enrichCinemaEvidenceForSearchResults = enrichCinemaEvidenceForMediaResults;
