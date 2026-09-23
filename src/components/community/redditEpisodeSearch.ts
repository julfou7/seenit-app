export interface RedditEpisodeSearchInput {
  seriesTitle: string;
  originalSeriesTitle?: string | null;
  seasonNumber: number;
  episodeNumber: number;
  episodeTitle?: string | null;
}

function normalizeSearchTerm(value?: string | null): string {
  return (value ?? '').replace(/"/g, ' ').replace(/\s+/g, ' ').trim();
}

export function buildRedditEpisodeSearchQuery({
  seriesTitle,
  originalSeriesTitle,
  seasonNumber,
  episodeNumber,
}: RedditEpisodeSearchInput): string {
  const title = normalizeSearchTerm(seriesTitle) || normalizeSearchTerm(originalSeriesTitle);
  const season = Math.max(0, Math.trunc(seasonNumber));
  const episode = Math.max(0, Math.trunc(episodeNumber));
  const seasonPadded = String(season).padStart(2, '0');
  const episodePadded = String(episode).padStart(2, '0');

  return [title, `S${seasonPadded}`, `E${episodePadded}`].filter(Boolean).join(' ');
}

export function buildRedditSearchUrl(query: string): string {
  return `https://www.reddit.com/search/?q=${encodeURIComponent(query)}`;
}
