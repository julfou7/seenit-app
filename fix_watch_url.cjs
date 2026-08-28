const fs = require('fs');

function fixFile(file, isServer) {
  let content = fs.readFileSync(file, 'utf8');

  // Regex for server.ts
  if (isServer) {
    content = content.replace(
      /let watchUrl = '';\n\s*if \(it\.slug\) \{[\s\S]*?watchUrl = `https:\/\/watch\.plex\.tv\/\$\{isShow \? 'show' : 'movie'\}\/\$\{slug\}`;\n\s*\}/g,
      `let watchUrl = 'https://watch.plex.tv';
                    const plexGuidMatch = typeof it.guid === 'string' ? it.guid.match(/plex:\\/\\/(movie|show)\\/([a-f0-9]+)/i) : null;
                    const hash = plexGuidMatch ? plexGuidMatch[2] : null;
                    const slugOrHash = it.slug || hash;
                    if (slugOrHash) {
                      watchUrl = \`https://watch.plex.tv/\${isShow ? 'show' : 'movie'}/\${slugOrHash}\`;
                    }`
    );
  } else {
    // Regex for plexAvailability.ts
    content = content.replace(
      /const itemWatchUrl = it\.slug\n\s*\? `https:\/\/watch\.plex\.tv\/\$\{isShowType \? 'show' : 'movie'\}\/\$\{it\.slug\}`\n\s*: 'https:\/\/watch\.plex\.tv';/g,
      `const plexGuidMatch = typeof it.guid === 'string' ? it.guid.match(/plex:\\/\\/(movie|show)\\/([a-f0-9]+)/i) : null;
                  const hash = plexGuidMatch ? plexGuidMatch[2] : null;
                  const slugOrHash = it.slug || hash;
                  const itemWatchUrl = slugOrHash
                    ? \`https://watch.plex.tv/\${isShowType ? 'show' : 'movie'}/\${slugOrHash}\`
                    : 'https://watch.plex.tv';`
    );
  }
  
  fs.writeFileSync(file, content);
}

fixFile('server.ts', true);
fixFile('src/features/plex/plexAvailability.ts', false);
