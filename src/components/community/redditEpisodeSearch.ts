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

  const parts: string[] = [];
  if (titles.length === 1) {
    parts.push(quoted(titles[0]));
  } else if (titles.length > 1) {
    parts.push(`(${titles.map(quoted).join(' OR ')})`);
  }

  parts.push(`(${identifiers.map(quoted).join(' OR ')})`);
  parts.push(
    `(${['discussion', 'post episode discussion', 'episode discussion', 'reactions']
      .map(quoted)
      .join(' OR ')})`,
  );

  return parts.join(' ');
}

export function buildRedditEpisodeAiQuestion(searchQuery: string): string {
  const episodeContext = searchQuery.replace(/\s+/g, ' ').trim();

  return [
    'Réponds en français, même si les publications et commentaires sources sont en anglais.',
    `À partir des discussions Reddit correspondant à ${episodeContext},`,
    'résume uniquement les réactions à cet épisode : avis dominants, points de consensus, désaccords, détails remarqués et principales théories.',
    'N’inclus aucun spoiler sur les épisodes suivants.',
  ].join(' ');
}

export function buildRedditSearchUrl(query: string): string {
  return `https://www.reddit.com/search/?q=${encodeURIComponent(query)}&sort=relevance`;
}
