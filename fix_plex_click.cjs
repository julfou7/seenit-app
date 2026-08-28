const fs = require('fs');

// 1. Fix ShowDetailScreen.tsx
let file = 'src/screens/ShowDetailScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /if \(provider && provider\.plexUrl\) \{\n\s*openExternalUrl\(provider\.plexUrl\);\n\s*\} else \{\n\s*openPlexWatchUrl\(String\(effectiveTmdbId\), isSeries \? 'show' : 'movie'\);\n\s*\}/g,
  `if (provider && (provider.plexUrl || provider.watchUrl)) {
                                  const urlToOpen = Capacitor.isNativePlatform() && provider.watchUrl && provider.watchUrl.includes('/slug') === false
                                    ? provider.watchUrl 
                                    : (provider.plexUrl || provider.watchUrl);
                                  openExternalUrl(urlToOpen);
                                } else {
                                  openPlexWatchUrl(String(effectiveTmdbId), isSeries ? 'show' : 'movie');
                                }`
);

fs.writeFileSync(file, content);

// 2. Fix EpisodeDetailModal.tsx
file = 'src/screens/EpisodeDetailModal.tsx';
content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /if \(presence\.plexInfo\?\.plexUrl\) \{\n\s*openExternalUrl\(presence\.plexInfo\.plexUrl\);\n\s*\} else \{\n\s*openPlexWatchUrl\(String\(show\.tmdbId\), 'show'\);\n\s*\}/g,
  `if (presence.plexInfo?.plexUrl || presence.plexInfo?.watchUrl) {
                                  const urlToOpen = Capacitor.isNativePlatform() && presence.plexInfo.watchUrl && presence.plexInfo.watchUrl.includes('/slug') === false
                                    ? presence.plexInfo.watchUrl 
                                    : (presence.plexInfo.plexUrl || presence.plexInfo.watchUrl);
                                  openExternalUrl(urlToOpen);
                                } else {
                                  openPlexWatchUrl(String(show.tmdbId), 'show');
                                }`
);

fs.writeFileSync(file, content);
