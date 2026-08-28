const fs = require('fs');
const file = 'src/screens/ShowDetailScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /isPlex: true,\n        serverName: plexMediaInfo\.serverName,\n      \}\);/g,
  `isPlex: true,
        serverName: plexMediaInfo.serverName,
        plexUrl: plexMediaInfo.plexUrl,
        watchUrl: plexMediaInfo.watchUrl,
      });`
);

content = content.replace(
  /openPlexWatchUrl\(String\(effectiveTmdbId\), isSeries \? 'show' : 'movie'\);/g,
  `if (provider && provider.plexUrl) {
                                  openExternalUrl(provider.plexUrl);
                                } else {
                                  openPlexWatchUrl(String(effectiveTmdbId), isSeries ? 'show' : 'movie');
                                }`
);

fs.writeFileSync(file, content);
