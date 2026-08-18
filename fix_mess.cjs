const fs = require('fs');
let lines = fs.readFileSync('src/screens/ShowDetailScreen.tsx', 'utf8').split('\n');

// 931 to 943 should be deleted
lines.splice(930, 13); // Removing the trailing garbage

fs.writeFileSync('src/screens/ShowDetailScreen.tsx', lines.join('\n'));
