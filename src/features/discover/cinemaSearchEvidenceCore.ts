export const CINEMA_SEARCH_EVIDENCE_SCHEMA = 2;

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? value as UnknownRecord : null;
}

function isMovieSearchResult(item: unknown): boolean {
  return asRecord(item)?.media_type === 'movie';
}

export function movieSearchEvidenceKey(item: unknown): string | null {
  if (!isMovieSearchResult(item)) return null;
  const record = asRecord(item);
  const id = Number(record?.id);
  return Number.isInteger(id) && id > 0 ? `movie:${id}` : null;
}

export function applyCinemaEvidenceToSearchResults<T>(
  results: T[],
  detailsByKey: Map<string, unknown | null>,
): T[] {
  return results.map(item => {
    const key = movieSearchEvidenceKey(item);
    if (!key) return item;

    const details = asRecord(detailsByKey.get(key));
    const releaseDates = asRecord(details?.release_dates);
    if (!details
      || Number(details.seenitParentalDetailsSchema) !== CINEMA_SEARCH_EVIDENCE_SCHEMA
      || !releaseDates
      || !Array.isArray(releaseDates.results)) return item;

    const media = asRecord(item);
    if (!media) return item;
    return {
      ...media,
      release_dates: releaseDates,
    } as T;
  });
}
