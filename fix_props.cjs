const fs = require('fs');
let c = fs.readFileSync('src/screens/ShowDetailScreen.tsx', 'utf8');

c = c.replace(
  /interface ShowDetailScreenProps \{\n  showId\?: string;\n  tmdbId\?: number;\n  onBack: \(\) => void;\n  onShowClick\?: \(tmdbId: number\) => void;\n\}/,
  `interface ShowDetailScreenProps {\n  showId?: string;\n  tmdbId?: number;\n  mediaType?: 'tv' | 'movie';\n  onBack: () => void;\n  onShowClick?: (tmdbId: number, mediaType?: 'tv' | 'movie') => void;\n}`
);

c = c.replace(
  /export function ShowDetailScreen\(\{ showId, tmdbId: externalTmdbId, onBack, onShowClick \}: ShowDetailScreenProps\) \{/,
  `export function ShowDetailScreen({ showId, tmdbId: externalTmdbId, mediaType: externalMediaType, onBack, onShowClick }: ShowDetailScreenProps) {`
);

// We need to use externalMediaType in the fetching logic if we don't have show.
c = c.replace(
  /const isSeries = show\?.mediaType === 'tv' \|\| \(!show && tmdbDetails\?.seasons\);/,
  `const isSeries = show?.mediaType === 'tv' || (!show && externalMediaType === 'tv') || (!show && !externalMediaType && tmdbDetails?.seasons) || (!show && !externalMediaType && !tmdbDetails); // Default to tv if unknown until loaded\n  const isMovie = show?.mediaType === 'movie' || (!show && externalMediaType === 'movie') || (!show && !externalMediaType && tmdbDetails && !tmdbDetails.seasons);`
);

c = c.replace(
  /tmdb\.getShowDetails\(effectiveTmdbId\)/,
  `tmdb.getMediaDetails(effectiveTmdbId, show?.mediaType || externalMediaType || 'tv')`
);

fs.writeFileSync('src/screens/ShowDetailScreen.tsx', c);
