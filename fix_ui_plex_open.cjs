const fs = require('fs');

// 1. Fix ShowDetailScreen.tsx
let file = 'src/screens/ShowDetailScreen.tsx';
let content = fs.readFileSync(file, 'utf8');
content = content.replace(
  /openPlexWatchUrl\(String\(effectiveTmdbId\), isSeries \? 'show' : 'movie'\);/g,
  `openPlexWatchUrl(show || { tmdbId: effectiveTmdbId, mediaType: isSeries ? 'tv' : 'movie' });`
);
fs.writeFileSync(file, content);

// 2. Fix EpisodeDetailModal.tsx
file = 'src/screens/EpisodeDetailModal.tsx';
content = fs.readFileSync(file, 'utf8');
content = content.replace(
  /openPlexWatchUrl\(String\(show\.tmdbId\), 'show'\);/g,
  `openPlexWatchUrl(show);`
);
fs.writeFileSync(file, content);
