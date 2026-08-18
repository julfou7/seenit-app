const fs = require('fs');

function replaceAll(file, search, replace) {
  let c = fs.readFileSync(file, 'utf8');
  c = c.split(search).join(replace);
  fs.writeFileSync(file, c);
}

replaceAll('src/screens/DiscoverScreen.tsx', 'onShowClick: (tmdbId: number) => void;', "onShowClick: (tmdbId: number, mediaType?: 'tv' | 'movie') => void;");
replaceAll('src/screens/DiscoverScreen.tsx', 'onShowClick: (id: any) => void', "onShowClick: (id: any, mediaType?: 'tv' | 'movie') => void");
replaceAll('src/screens/LibraryScreen.tsx', 'onShowClick?: (id: string) => void;', "onShowClick?: (id: string, mediaType?: 'tv' | 'movie') => void;");
replaceAll('src/screens/WatchListScreen.tsx', 'onShowClick?: (id: string) => void;', "onShowClick?: (id: string, mediaType?: 'tv' | 'movie') => void;");

// In DiscoverScreen, activeCategory doesn't exist anymore maybe?
// Let's replace `activeCategory === 'movies'` with `activeFilter === 'movies'` or something?
// Let's check DiscoverScreen.
