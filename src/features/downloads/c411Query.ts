export function buildC411SearchParams(
  query: string,
  mediaType?: 'movie' | 'tv',
  year?: string
): URLSearchParams {
  const cleanQuery = query.replace(/[:’']/g, ' ').replace(/\s+/g, ' ').trim();
  const normalizedYear = /^\d{4}$/.test(String(year || '')) ? String(year) : undefined;
  const effectiveQuery = normalizedYear && !new RegExp(`\\b${normalizedYear}\\b`).test(cleanQuery)
    ? `${cleanQuery} ${normalizedYear}`
    : cleanQuery;
  const params = new URLSearchParams({ name: effectiveQuery, category: '1', page: '1', perPage: '100', viewMode: 'flat' });
  if (mediaType === 'tv') params.set('subcat', '7');
  if (mediaType === 'movie') params.set('subcat', '6');
  return params;
}
