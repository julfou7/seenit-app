const fs = require('fs');

let c = fs.readFileSync('src/screens/DiscoverScreen.tsx', 'utf8');
c = c.replace(/media\.media_type \|\| \(activeCategory === 'Films' \? 'movie' : 'tv'\)/g, "media.media_type as 'tv' | 'movie'");
fs.writeFileSync('src/screens/DiscoverScreen.tsx', c);
