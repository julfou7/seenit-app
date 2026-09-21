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

function quoted(value: string): string {
  return `"${value}"`;
}

export function buildRedditEpisodeSearchQuery({
  seriesTitle,
  originalSeriesTitle,
  seasonNumber,
  episodeNumber,
  episodeTitle,
}: RedditEpisodeSearchInput): string {
  const localizedTitle = normalizeSearchTerm(seriesTitle);
  const originalTitle = normalizeSearchTerm(originalSeriesTitle);
  const titles = [localizedTitle, originalTitle].filter(
    (value, index, values) => value && values.indexOf(value) === index,
  );

  const season = Math.max(0, Math.trunc(seasonNumber));
  const episode = Math.max(0, Math.trunc(episodeNumber));
  const seasonPadded = String(season).padStart(2, '0');
  const episodePadded = String(episode).padStart(2, '0');
  const episodeName = normalizeSearchTerm(episodeTitle);

  const identifiers = [
    `S${seasonPadded}E${episodePadded}`,
    `S${season}E${episode}`,
    `Season ${season} Episode ${episode}`,
    `${season}x${episodePadded}`,
    `Episode ${episode}`,
  ];
  if (episodeName) identifiers.push(episodeName);

  const contextTerms = [...titles, episodeName].filter(
    (value, index, values) => value && values.indexOf(value) === index,
  );
  const contextGroup =
    contextTerms.length === 1
      ? quoted(contextTerms[0])
      : `(${contextTerms.map(quoted).join(' OR ')})`;
  const episodeTitleGroup = `(${identifiers
    .map(identifier => `title:${quoted(identifier)}`)
    .join(' OR ')})`;

  return [contextGroup, 'AND', episodeTitleGroup].filter(Boolean).join(' ');
}

export function buildRedditSearchUrl(query: string): string {
  return `https://www.reddit.com/search/?q=${encodeURIComponent(query)}&sort=relevance`;
}
