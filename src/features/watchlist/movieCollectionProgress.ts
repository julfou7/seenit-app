import type { Show } from '../../types';
import type { SeriesSeasonProgress } from './seriesCardPresentation';

export interface CollectionPart { id: number; release_date?: string; adult?: boolean }

/** Only the explicit TMDB collection supplies members; title numerals carry no evidence. */
export function buildMovieCollectionProgress(parts: CollectionPart[], targetId: number, shows: Pick<Show, 'tmdbId' | 'mediaType' | 'seenEpisodes'>[], today: string): SeriesSeasonProgress | undefined {
  const unique = [...new Map(parts.filter(part => Number.isInteger(part.id) && part.id > 0 && !part.adult).map(part => [part.id, part])).values()]
    .sort((a, b) => (a.release_date || '9999').localeCompare(b.release_date || '9999') || a.id - b.id);
  if (unique.length < 2 || !unique.some(part => part.id === targetId)) return undefined;
  const seen = new Set(shows.filter(show => show.mediaType === 'movie' && show.seenEpisodes.includes('movie')).map(show => show.tmdbId));
  return { label: 'Saga', description: `${unique.length} films dans la collection`, continuous: false, totalUnknown: false, unknownTail: false, knownEpisodes: unique.length,
    availableUnseen: unique.filter(part => !seen.has(part.id) && part.release_date && part.release_date <= today).length,
    segments: unique.map((part, index) => ({ count: 1, episode: index + 1, state: seen.has(part.id) ? 'seen' : part.id === targetId ? 'current' : part.release_date && part.release_date <= today ? 'unseen' : 'future' })) };
}
