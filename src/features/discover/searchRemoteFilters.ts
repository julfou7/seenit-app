import type { TMDBMedia } from '../shows/tmdbClient';
import { matchesMaxRecommendedAge, parseMaxAgeFilter, resolveParentalRating } from '../shows/parentalRating.ts';
import { DISCOVER_PLATFORM_ID_MAP } from './filterPolicy.ts';
import { searchMediaKey } from './searchPresentation.ts';

interface SearchFilterPorts {
  ratings: (items: TMDBMedia[], signal?: AbortSignal) => Promise<Map<string, unknown>>;
  providerIds: (item: TMDBMedia) => Promise<number[]>;
  ratingOverride?: (type: 'tv' | 'movie', id: number) => Parameters<typeof resolveParentalRating>[2];
}
/** Only remote media pass here. Local library results never depend on these requests. */
export async function filterRemoteSearch(items: TMDBMedia[], age: string, platforms: string[], ports: SearchFilterPorts, signal?: AbortSignal): Promise<TMDBMedia[]> {
  const maxAge = parseMaxAgeFilter(age);
  const media = items.filter(item => item.media_type !== 'person');
  const ratings = maxAge === null ? new Map() : await ports.ratings(media, signal);
  const wanted = new Set(platforms.map(platform => Number(DISCOVER_PLATFORM_ID_MAP[platform])).filter(Boolean));
  if (platforms.includes('max')) wanted.add(1825);
  const accepted = new Set<string>();
  // Shared provider transport also bounds requests; do not fan out a result page in the UI.
  let cursor = 0;
  const worker = async () => {
    while (cursor < media.length && !signal?.aborted) {
      const item = media[cursor++];
      const type = item.media_type === 'movie' ? 'movie' : 'tv';
      const key = searchMediaKey(item.id, type);
      if (maxAge !== null && !matchesMaxRecommendedAge(resolveParentalRating(type, ratings.get(key), ports.ratingOverride?.(type, Number(item.id))), maxAge)) continue;
      if (wanted.size) {
        const ids = await ports.providerIds(item);
        if (!ids.some(id => wanted.has(id))) continue;
      }
      accepted.add(key);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, media.length) }, worker));
  return signal?.aborted ? [] : items.filter(item => item.media_type === 'person' || accepted.has(searchMediaKey(item.id, item.media_type)));
}
