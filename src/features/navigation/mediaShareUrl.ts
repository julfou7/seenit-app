export const SEENIT_PUBLIC_APP_ORIGIN = 'https://seenit.ai.studio';

export type ShareableMediaType = 'movie' | 'tv';

export function buildMediaShareUrl({
  tmdbId,
  mediaType,
}: {
  tmdbId: number;
  mediaType: ShareableMediaType;
}): string | null {
  const normalizedTmdbId = Number(tmdbId);
  if (!Number.isInteger(normalizedTmdbId) || normalizedTmdbId <= 0) return null;

  const url = new URL('/', SEENIT_PUBLIC_APP_ORIGIN);
  url.searchParams.set('tmdbId', String(normalizedTmdbId));
  url.searchParams.set('mediaType', mediaType);
  return url.toString();
}
