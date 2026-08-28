const fs = require('fs');
const file = 'src/screens/EpisodeDetailModal.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /openPlexWatchUrl\(String\(show\.tmdbId\), 'show'\);/g,
  `if (presence.plexInfo?.plexUrl) {
                                  openExternalUrl(presence.plexInfo.plexUrl);
                                } else {
                                  openPlexWatchUrl(String(show.tmdbId), 'show');
                                }`
);

fs.writeFileSync(file, content);
