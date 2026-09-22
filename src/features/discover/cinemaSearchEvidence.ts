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

export async function enrichCinemaEvidenceForSearchResults<T>(
  results: T[],
  signal?: AbortSignal,
): Promise<T[]> {
  const keys = [...new Set(results.map(movieSearchEvidenceKey).filter((key): key is string => Boolean(key)))]
    .slice(0, CINEMA_SEARCH_BATCH_MAX_ITEMS);
  if (keys.length === 0 || signal?.aborted) return results;

  try {
    const response = await authenticatedFetch(
      `/api/media/parental-ratings?items=${encodeURIComponent(keys.join(','))}`,
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
