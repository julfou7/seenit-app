import { authenticatedFetch } from '../../lib/apiAuth';

export const CINEMA_SEARCH_EVIDENCE_SCHEMA = 2;
const CINEMA_SEARCH_BATCH_MAX_ITEMS = 40;

interface BatchCinemaEntry {
  key?: string;
  details?: {
    seenitParentalDetailsSchema?: number;
    release_dates?: unknown;
  } | null;
}

function isMovieSearchResult(item: any): boolean {
  return item?.media_type === 'movie';
}

function movieKey(item: any): string | null {
  if (!isMovieSearchResult(item)) return null;
  const id = Number(item?.id);
  return Number.isInteger(id) && id > 0 ? `movie:${id}` : null;
}

export function applyCinemaEvidenceToSearchResults(
  results: any[],
  detailsByKey: Map<string, any | null>,
): any[] {
  return results.map(item => {
    const key = movieKey(item);
    if (!key) return item;
    const details = detailsByKey.get(key);
    if (!details
      || Number(details.seenitParentalDetailsSchema) !== CINEMA_SEARCH_EVIDENCE_SCHEMA
      || !details.release_dates
      || !Array.isArray(details.release_dates.results)) return item;

    return {
      ...item,
      release_dates: details.release_dates,
    };
  });
}

export async function enrichCinemaEvidenceForSearchResults(
  results: any[],
  signal?: AbortSignal,
): Promise<any[]> {
  const keys = [...new Set(results.map(movieKey).filter((key): key is string => Boolean(key)))]
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

    const detailsByKey = new Map<string, any | null>();
    for (const entry of payload.results) {
      if (typeof entry?.key !== 'string') continue;
      detailsByKey.set(entry.key, entry.details ?? null);
    }
    return applyCinemaEvidenceToSearchResults(results, detailsByKey);
  } catch {
    return results;
  }
}
