const fs = require('fs');

function updateFile(file, replacer) {
  let c = fs.readFileSync(file, 'utf8');
  c = replacer(c);
  fs.writeFileSync(file, c);
}

// DiscoverScreen.tsx
updateFile('src/screens/DiscoverScreen.tsx', c => {
  return c.replace(/onShowClick: \(tmdbId: number\) => void;/g, `onShowClick: (tmdbId: number, mediaType?: 'tv' | 'movie') => void;`)
          .replace(/onShowClick\(media\.id\)/g, `onShowClick(media.id, media.media_type || (activeCategory === 'movies' ? 'movie' : 'tv'))`);
});

// LibraryScreen.tsx
updateFile('src/screens/LibraryScreen.tsx', c => {
  return c.replace(/onShowClick\?: \(id: string\) => void;/g, `onShowClick?: (id: string, mediaType?: 'tv' | 'movie') => void;`)
          .replace(/onShowClick\(show\.id\)/g, `onShowClick(show.id, show.mediaType)`);
});

// WatchListScreen.tsx
updateFile('src/screens/WatchListScreen.tsx', c => {
  return c.replace(/onShowClick\?: \(id: string\) => void;/g, `onShowClick?: (id: string, mediaType?: 'tv' | 'movie') => void;`)
          .replace(/onShowClick\(show\.id\)/g, `onShowClick(show.id, show.mediaType)`)
          .replace(/onShowClick\(tmdbId\.toString\(\)\)/g, `onShowClick(tmdbId.toString(), selectedEpisodeModal.show.mediaType)`);
});

// EpisodeDetailModal.tsx
updateFile('src/screens/EpisodeDetailModal.tsx', c => {
  return c.replace(/onShowClick\?: \(tmdbId: number\) => void;/g, `onShowClick?: (tmdbId: number, mediaType?: 'tv' | 'movie') => void;`)
          .replace(/onShowClick\(targetTmdbId\)/g, `onShowClick(targetTmdbId, show?.mediaType || 'tv')`);
});

// PersonDetailModal.tsx
updateFile('src/screens/PersonDetailModal.tsx', c => {
  return c.replace(/onShowClick: \(tmdbId: number\) => void;/g, `onShowClick: (tmdbId: number, mediaType?: 'tv' | 'movie') => void;`)
          .replace(/onShowClick\(credit\.id\)/g, `onShowClick(credit.id, credit.media_type)`);
});
