export const CINEMA_SEARCH_EVIDENCE_SCHEMA = 2;

function isMovieSearchResult(item: any): boolean {
  return item?.media_type === 'movie';
}

export function movieSearchEvidenceKey(item: any): string | null {
  if (!isMovieSearchResult(item)) return null;
  const id = Number(item?.id);
  return Number.isInteger(id) && id > 0 ? `movie:${id}` : null;
}

export function applyCinemaEvidenceToSearchResults(
  results: any[],
  detailsByKey: Map<string, any | null>,
): any[] {
  return results.map(item => {
    const key = movieSearchEvidenceKey(item);
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
